// Spawns the traced command with its interceptor injected and forwards signals to it.

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

const FORWARDED_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];

const PIPE_DRAIN_GRACE_MS = 1000;

const SIGINT_FORWARD_DELAY_MS = 3000;

export interface SpawnHandle {
  outputFile: string;
  // stdout and stderr are only set when output is piped.
  child: ChildProcess;
  // Resolves with the exit code, or 128 plus the signal number if the child was killed.
  done: Promise<number>;
  dispose(): void;
  failedToStart(): boolean;
}

export interface SpawnOptions {
  pipeChildOutput: boolean;
  maxBodyBytes?: number;
  maxTraceBytes?: number;
}

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
      "This usually means the package was built incorrectly. Try reinstalling costcatch. " +
      `Looked in:\n  ${candidates.join("\n  ")}`,
  );
}

// mkdtemp creates a private 0700 directory, which keeps captured prompts away from other users.
function createCaptureDir(): { dir: string; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "costcatch-"));
  const file = path.join(dir, "calls.ndjson");
  fs.writeFileSync(file, "", { encoding: "utf-8", mode: 0o600 });
  return { dir, file };
}

// existsSync misses the Microsoft Store python.exe, a zero-length reparse point, so use lstat.
function pathEntryExists(candidate: string): boolean {
  try {
    fs.lstatSync(candidate);
    return true;
  } catch {
    return false;
  }
}

// Resolve the command ourselves so Windows never needs shell: true, which passes argv to cmd.exe unescaped.
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

  if (command.includes("/") || command.includes("\\")) return probe(command);

  for (const dir of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    const hit = probe(path.join(dir, command));
    if (hit) return hit;
  }
  return null;
}

// cmd.exe /c needs both CommandLineToArgvW quoting and caret escapes for its own special characters.
function quoteForCmd(arg: string): string {
  const quoted = `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`;
  return quoted.replace(/[()\][%!^"`<>&|;, *?]/g, "^$&");
}

function captureLimit(name: string, fromOptions: number | undefined, fallback: number): string {
  if (fromOptions !== undefined) return String(fromOptions);
  const fromEnv = process.env[name]?.trim();
  return fromEnv ? fromEnv : String(fallback);
}

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
    [ENV_MAX_BODY_BYTES]: captureLimit(ENV_MAX_BODY_BYTES, opts.maxBodyBytes, DEFAULT_MAX_BODY_BYTES),
    [ENV_MAX_TRACE_BYTES]: captureLimit(ENV_MAX_TRACE_BYTES, opts.maxTraceBytes, DEFAULT_MAX_TRACE_BYTES),
  };

  let command: string;
  let args: string[];

  if (runtime === "node") {
    const preload = path.join(interceptorsDir, "node", "preload.cjs");
    if (!fs.existsSync(preload)) {
      throw new Error(`costcatch: Node interceptor missing at ${preload}`);
    }
    command = userCommand[0];

    // NODE_OPTIONS also reaches child node processes, and preload.cjs guards against loading twice.
    const existing = process.env.NODE_OPTIONS || "";
    const flag = `--require ${JSON.stringify(preload)}`;
    env.NODE_OPTIONS = existing ? `${existing} ${flag}` : flag;
    const bare = path.basename(command).replace(/\.(exe|cmd|bat)$/i, "").toLowerCase();
    args = bare === "node" || bare === "nodejs" ? ["--require", preload, ...userCommand.slice(1)] : userCommand.slice(1);
  } else {
    const pyDir = path.join(interceptorsDir, "python");
    if (!fs.existsSync(path.join(pyDir, "sitecustomize.py"))) {
      throw new Error(`costcatch: Python interceptor missing at ${pyDir}`);
    }
    const existing = process.env.PYTHONPATH || "";
    env.PYTHONPATH = existing ? `${pyDir}${path.delimiter}${existing}` : pyDir;

    // Python buffers prints when stdout isn't a TTY, so turn that off while piping.
    if (opts.pipeChildOutput) env.PYTHONUNBUFFERED = "1";

    command = userCommand[0];
    args = userCommand.slice(1);
  }

  return { command, args, env };
}

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
    try {
      fs.rmSync(captureDir, { recursive: true, force: true });
    } catch {}
    throw err;
  }

  let spawnFile = command;
  let spawnArgs = args;
  let verbatim = false;

  if (process.platform === "win32") {
    const resolved = resolveWindowsExecutable(command);
    if (resolved?.isBatch) {
      // Since CVE-2024-27980, Node won't spawn .cmd or .bat shims like npx directly.
      const line = [resolved.file, ...args].map(quoteForCmd).join(" ");
      spawnFile = process.env.ComSpec || "cmd.exe";
      spawnArgs = ["/d", "/s", "/c", `"${line}"`];
      verbatim = true;
    } else if (resolved) {
      spawnFile = resolved.file;
    }
  }

  const child = spawn(spawnFile, spawnArgs, {
    env,
    stdio: opts.pipeChildOutput ? ["inherit", "pipe", "pipe"] : "inherit",
    shell: false,
    windowsHide: true,
    windowsVerbatimArguments: verbatim,
  });

  // Forward signals so the child isn't orphaned. On a terminal, Ctrl+C already reached the program
  // and a second SIGINT force-quits many programs, so we wait and only forward it if still running.
  const interactive = Boolean(process.stdin.isTTY || process.stdout.isTTY || process.stderr.isTTY);
  const send = (signal: NodeJS.Signals) => {
    try {
      if (!child.killed && child.exitCode === null && child.signalCode === null) child.kill(signal);
    } catch {}
  };
  const forward = (signal: NodeJS.Signals) => () => {
    if (signal === "SIGINT" && interactive) {
      setTimeout(() => send(signal), SIGINT_FORWARD_DELAY_MS).unref();
      return;
    }
    send(signal);
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
    } catch {}
  };

  let startFailed = false;
  const done = new Promise<number>((resolve) => {
    child.on("error", (err) => {
      startFailed = true;
      process.stderr.write(`costcatch: ${describeStartFailure(command, err)}\n`);
      resolve(127); // the shell's code for command not found
    });
    // Settle on exit, not close, because a server the program left running can hold the pipes open forever.
    child.on("exit", (code, signal) => {
      const status = code ?? (signal ? 128 + (os.constants.signals[signal] ?? 0) : 0);
      if (!child.stdout && !child.stderr) {
        resolve(status);
        return;
      }
      const grace = setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        resolve(status);
      }, PIPE_DRAIN_GRACE_MS);
      child.once("close", () => {
        clearTimeout(grace);
        resolve(status);
      });
    });
  });

  return { outputFile, child, done, dispose, failedToStart: () => startFailed };
}

export function describeStartFailure(command: string, err: NodeJS.ErrnoException): string {
  if (err.code === "ENOENT") {
    const hint = path.basename(command) === "python" ? " On macOS and many Linux systems it is called python3." : "";
    return `failed to start "${command}": not found on PATH.${hint}`;
  }
  if (err.code === "EACCES") return `failed to start "${command}": not executable (permission denied).`;
  return `failed to start "${command}": ${err.message}`;
}

export function readCapturedRecords(outputFile: string): RawRecord[] {
  return createNdjsonTail(outputFile).poll();
}

// Returns completed calls only. Use readCapturedRecords with closeUnfinishedCalls to include the rest.
export function readCapturedCalls(outputFile: string): RawHttpCall[] {
  return readCapturedRecords(outputFile).filter((r): r is RawHttpCall => !isStartRecord(r));
}

export function cleanupOutputFile(outputFile: string): void {
  try {
    const dir = path.dirname(outputFile);
    if (path.basename(dir).startsWith("costcatch-")) {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    }
    if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
  } catch {}
}
