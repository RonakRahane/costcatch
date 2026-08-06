/**
 * Tracer — process orchestration only.
 *
 * Responsibilities (deliberately narrow):
 *   1. Resolve the bundled interceptor directory.
 *   2. Build the child environment with the interceptor injected.
 *   3. Spawn the user's command and forward signals to it.
 *   4. Expose the NDJSON output path + child streams + an exit promise.
 *
 * It does NO file tailing and NO console output — those belong to the live
 * controller (src/ui/live-controller.ts) and the ndjson tail (ndjson-tail.ts).
 *
 * CRITICAL: the child MUST run correctly even if tracing fails. The interceptor
 * is purely observational; if it can't load, the user's script still runs.
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { RawHttpCall, RawRecord } from "../types/trace.js";
import { isStartRecord } from "../types/trace.js";
import type { Runtime } from "../types/config.js";
import { createNdjsonTail } from "./ndjson-tail.js";
import {
  ENV_OUTPUT,
  ENV_MAX_BODY_BYTES,
  ENV_MAX_TRACE_BYTES,
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_MAX_TRACE_BYTES,
} from "./constants.js";

/** Signals we forward to the child and then mirror in our own exit code. */
const FORWARDED_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];

/** A handle to a spawned, traced child process. */
export interface SpawnHandle {
  /** Absolute path to the NDJSON file the interceptor writes to. */
  outputFile: string;
  /** The spawned child. `.stdout`/`.stderr` are present only when piped. */
  child: ChildProcess;
  /** Resolves with the child's exit code (128+n when killed by signal n). */
  done: Promise<number>;
  /** Remove the temp capture directory and detach signal handlers. */
  dispose(): void;
}

/** Options accepted by {@link spawnTraced}. */
export interface SpawnOptions {
  /** Pipe the child's stdout/stderr instead of inheriting our own. */
  pipeChildOutput: boolean;
  /** Per-response capture ceiling in bytes. */
  maxBodyBytes?: number;
  /** Whole-run capture ceiling in bytes. */
  maxTraceBytes?: number;
}

/**
 * Locate the interceptors directory.
 *
 * Resolution order:
 *   1. `<dist>/interceptors`   — the published + built layout (tsup copies here)
 *   2. `<dist>/../src/interceptors` — running unbuilt (tsx) or `tsup --watch`
 */
export function getInterceptorsDir(): string {
  const thisDir = path.dirname(fileURLToPath(import.meta.url));

  const candidates = [
    path.join(thisDir, "interceptors"),
    path.join(thisDir, "..", "interceptors"),
    path.join(thisDir, "..", "src", "interceptors"),
    path.join(thisDir, "..", "..", "src", "interceptors"),
  ];

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "node", "preload.cjs"))) return dir;
  }

  throw new Error(
    "costcatch: could not locate the interceptor directory. " +
      "This usually means the package was built incorrectly — try reinstalling costcatch. " +
      `Looked in:\n  ${candidates.join("\n  ")}`,
  );
}

/**
 * Create a private directory holding this run's NDJSON file.
 *
 * `mkdtemp` gives us a 0700 directory, which matters: captured prompts and model
 * output land in this file, and a predictable world-readable path in a shared
 * /tmp would let any local user read another user's conversation content
 * (CWE-377). The whole directory is removed by {@link SpawnHandle.dispose}.
 */
function createCaptureDir(): { dir: string; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "costcatch-"));
  const file = path.join(dir, "calls.ndjson");
  fs.writeFileSync(file, "", { encoding: "utf-8", mode: 0o600 });
  return { dir, file };
}

/**
 * Existence check that sees Windows app-execution aliases.
 *
 * The Store-installed `python.exe`/`python3.exe` under
 * `%LOCALAPPDATA%\Microsoft\WindowsApps` are zero-length reparse points.
 * `existsSync` follows the reparse and reports false, so a PATH scan built on it
 * silently fails to find the Python most Windows users actually have.
 * `lstatSync` does not follow, and any successful stat means "there is an entry
 * here to execute".
 */
function pathEntryExists(candidate: string): boolean {
  try {
    fs.lstatSync(candidate);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a bare executable name against PATH on Windows.
 *
 * Why bother: `spawn(cmd, args, { shell: true })` concatenates argv into one
 * `cmd.exe` command line without escaping (Node's own DEP0190 warns about
 * exactly this), so `^`, `&`, `%VAR%` and a path like `C:\my & agents\run.py`
 * are reinterpreted as shell syntax. Resolving the executable ourselves lets us
 * spawn directly in the overwhelmingly common case.
 *
 * Returns null when nothing matches; the caller then spawns the bare name and
 * lets `CreateProcess` do its own lookup.
 */
function resolveWindowsExecutable(command: string): { file: string; isBatch: boolean } | null {
  const pathExt = (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  const isBatch = (p: string) => /\.(cmd|bat)$/i.test(p);

  const probe = (base: string): { file: string; isBatch: boolean } | null => {
    if (path.extname(base) && pathEntryExists(base)) return { file: base, isBatch: isBatch(base) };
    for (const ext of pathExt) {
      const candidate = base + ext;
      if (pathEntryExists(candidate)) return { file: candidate, isBatch: isBatch(candidate) };
    }
    return null;
  };

  // An explicit path: probe it directly, don't search PATH.
  if (command.includes("/") || command.includes("\\")) return probe(command);

  for (const dir of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    const hit = probe(path.join(dir, command));
    if (hit) return hit;
  }
  return null;
}

/**
 * Quote one argument for a `cmd.exe /c` command line.
 *
 * Two layers, both required:
 *   1. `CommandLineToArgvW` rules — double-quote the argument and double any
 *      backslashes that immediately precede a quote.
 *   2. `cmd.exe` metacharacters — caret-escape them so the shell hands the
 *      quoted token through instead of interpreting `&`, `|`, `%`, `^`, … .
 *
 * This is what lets us keep `.cmd` launchers working (`npx`, `tsx`, `ts-node`
 * are all `.cmd` shims on Windows, and Node refuses to spawn those directly
 * after the CVE-2024-27980 fix) without handing the user's argv to a shell
 * unescaped.
 */
function quoteForCmd(arg: string): string {
  const quoted = `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`;
  return quoted.replace(/[()\][%!^"`<>&|;, *?]/g, "^$&");
}

/**
 * Build the child environment and the exact command/args to spawn.
 *
 * Node:   inject `--require <preload.cjs>` before the user's args.
 * Python: prepend our interceptor dir to PYTHONPATH so `sitecustomize.py`
 *         auto-loads before any user code runs.
 */
function buildInvocation(
  userCommand: string[],
  runtime: Runtime,
  outputFile: string,
  opts: SpawnOptions,
): { command: string; args: string[]; env: NodeJS.ProcessEnv } {
  const interceptorsDir = getInterceptorsDir();

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    [ENV_OUTPUT]: outputFile,
    [ENV_MAX_BODY_BYTES]: String(opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES),
    [ENV_MAX_TRACE_BYTES]: String(opts.maxTraceBytes ?? DEFAULT_MAX_TRACE_BYTES),
  };

  let command: string;
  let args: string[];

  if (runtime === "node") {
    const preload = path.join(interceptorsDir, "node", "preload.cjs");
    if (!fs.existsSync(preload)) {
      throw new Error(`costcatch: Node interceptor missing at ${preload}`);
    }
    command = userCommand[0];
    args = ["--require", preload, ...userCommand.slice(1)];
  } else {
    const pyDir = path.join(interceptorsDir, "python");
    if (!fs.existsSync(path.join(pyDir, "sitecustomize.py"))) {
      throw new Error(`costcatch: Python interceptor missing at ${pyDir}`);
    }
    const existing = process.env.PYTHONPATH || "";
    env.PYTHONPATH = existing ? `${pyDir}${path.delimiter}${existing}` : pyDir;

    // When we pipe the child's stdout, Python block-buffers it (non-TTY).
    // Force line-buffered output so the user's prints appear promptly.
    if (opts.pipeChildOutput) env.PYTHONUNBUFFERED = "1";

    command = userCommand[0];
    args = userCommand.slice(1);
  }

  return { command, args, env };
}

/**
 * Spawn the user's command with the interceptor injected.
 *
 * We spawn with `shell: false` wherever possible. An earlier implementation used
 * `shell: true`, which re-parsed argv through the shell — so an interceptor path
 * containing shell metacharacters (a directory literally named `$25000`) got
 * mangled by `$`-expansion and the interceptor failed to load. With
 * `shell: false` the argv vector is passed verbatim, and `spawn` still resolves
 * bare executables (`python`, `node`, pyenv/venv shims) via PATH. On Windows we
 * resolve the executable ourselves and only fall back to the shell for
 * `.cmd`/`.bat` launchers, which cannot be spawned directly.
 */
export function spawnTraced(
  userCommand: string[],
  runtime: Runtime,
  opts: SpawnOptions,
): SpawnHandle {
  const { dir: captureDir, file: outputFile } = createCaptureDir();

  let command: string;
  let args: string[];
  let env: NodeJS.ProcessEnv;
  try {
    ({ command, args, env } = buildInvocation(userCommand, runtime, outputFile, opts));
  } catch (err) {
    // Clean up the temp dir before surfacing a setup failure.
    try {
      fs.rmSync(captureDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    throw err;
  }

  let spawnFile = command;
  let spawnArgs = args;
  let verbatim = false;

  if (process.platform === "win32") {
    const resolved = resolveWindowsExecutable(command);
    if (resolved?.isBatch) {
      // `.cmd`/`.bat` cannot be spawned directly. Build the cmd.exe command
      // line ourselves with proper per-argument quoting instead of setting
      // `shell: true`, which concatenates argv unescaped.
      const line = [resolved.file, ...args].map(quoteForCmd).join(" ");
      spawnFile = process.env.ComSpec || "cmd.exe";
      spawnArgs = ["/d", "/s", "/c", `"${line}"`];
      verbatim = true;
    } else if (resolved) {
      spawnFile = resolved.file;
    }
    // Unresolved: fall through and let CreateProcess do its own PATH lookup,
    // which produces a clean ENOENT we surface below.
  }

  const child = spawn(spawnFile, spawnArgs, {
    env,
    stdio: opts.pipeChildOutput ? ["inherit", "pipe", "pipe"] : "inherit",
    shell: false,
    windowsHide: true,
    windowsVerbatimArguments: verbatim,
  });

  // Forward terminal signals so Ctrl+C reaches the traced program instead of
  // orphaning it. Node's default SIGINT handling is replaced the moment any
  // listener is attached, so the CLI is responsible for the exit code too —
  // `runCommand` maps the resolved 128+n back onto process.exit.
  const forward = (signal: NodeJS.Signals) => () => {
    try {
      if (!child.killed && child.exitCode === null) child.kill(signal);
    } catch {
      /* the child is already gone */
    }
  };
  const handlers = FORWARDED_SIGNALS.map((signal) => {
    const handler = forward(signal);
    process.on(signal, handler);
    return { signal, handler };
  });

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const { signal, handler } of handlers) process.removeListener(signal, handler);
    try {
      fs.rmSync(captureDir, { recursive: true, force: true });
    } catch {
      // Non-critical: an OS temp sweeper will get it.
    }
  };

  const done = new Promise<number>((resolve) => {
    child.on("error", (err) => {
      process.stderr.write(`costcatch: failed to start "${command}": ${err.message}\n`);
      resolve(127); // POSIX convention: command not found / not executable
    });
    // POSIX convention: a process killed by signal N reports 128+N.
    child.on("close", (code, signal) =>
      resolve(code ?? (signal ? 128 + (os.constants.signals[signal] ?? 0) : 0)),
    );
  });

  return { outputFile, child, done, dispose };
}

/**
 * Read all COMPLETED calls from a finished trace file.
 * Skips "start" markers (they are live-UI hints, not part of the final trace).
 */
export function readCapturedCalls(outputFile: string): RawHttpCall[] {
  const tail = createNdjsonTail(outputFile);
  const records: RawRecord[] = tail.poll();
  const calls: RawHttpCall[] = [];
  for (const r of records) {
    if (isStartRecord(r)) continue;
    calls.push(r);
  }
  return calls;
}

/**
 * Best-effort removal of the capture directory holding `outputFile`.
 *
 * Prefer {@link SpawnHandle.dispose}; this exists for callers that only kept the
 * path (and for tests that drive the tracer directly).
 */
export function cleanupOutputFile(outputFile: string): void {
  try {
    const dir = path.dirname(outputFile);
    if (path.basename(dir).startsWith("costcatch-")) {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    }
    if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
  } catch {
    // non-critical
  }
}
