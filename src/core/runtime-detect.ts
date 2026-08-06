/**
 * Runtime detection.
 *
 * Decides whether the user's command is a Python or Node.js program, which
 * selects the interceptor to inject. Also used to find where costcatch's own
 * flags end and the user's command begins.
 */

import * as path from "node:path";
import type { Runtime } from "../types/config.js";

/** Executables that indicate a Python runtime. */
const PYTHON_EXECUTABLES = new Set([
  "python",
  "python2",
  "python3",
  "pythonw",
  "py", // the Windows Python launcher
]);

/**
 * Executables that indicate a Node.js runtime.
 *
 * Deliberately excludes `bun` and `deno`: neither honours `--require`, so
 * injecting the CommonJS preload would silently capture nothing while implying
 * that it worked. Better to report "could not detect runtime" than to produce
 * an empty trace the user has to debug.
 */
const NODE_EXECUTABLES = new Set(["node", "nodejs", "npx", "tsx", "ts-node"]);

/** Strip directory and Windows executable extension: `C:\bin\python3.exe` → `python3`. */
function baseName(executable: string): string {
  const normalized = executable.replace(/\\/g, "/");
  const base = path.basename(normalized.split("/").pop() ?? normalized);
  return base.replace(/\.(exe|cmd|bat|com)$/i, "").toLowerCase();
}

/** Version-suffixed Python: python3.12, python3.13, … */
const PYTHON_VERSIONED = /^python\d+(\.\d+)*$/;

/**
 * Classify a single executable name.
 * Returns null when the name is not a runtime costcatch can instrument.
 */
export function classifyExecutable(executable: string): Runtime | null {
  const name = baseName(executable);
  if (!name) return null;
  if (PYTHON_EXECUTABLES.has(name) || PYTHON_VERSIONED.test(name)) return "python";
  if (NODE_EXECUTABLES.has(name)) return "node";
  return null;
}

/** Whether this token starts a command costcatch knows how to trace. */
export function isRuntimeExecutable(token: string): boolean {
  return classifyExecutable(token) !== null;
}

/**
 * Detect the runtime from the command arguments.
 *
 * @example
 * detectRuntime(["python", "agent.py"])    // => "python"
 * detectRuntime(["/usr/bin/python3.12", …]) // => "python"
 * detectRuntime(["node", "agent.js"])      // => "node"
 * detectRuntime(["go", "run", "main.go"])  // => null
 */
export function detectRuntime(args: string[]): Runtime | null {
  if (args.length === 0) return null;
  return classifyExecutable(args[0]);
}

/**
 * Split raw argv into costcatch's own arguments and the command to trace.
 *
 * Two rules, checked in order:
 *
 *   1. An explicit `--` terminator wins. This is the escape hatch for anything
 *      ambiguous: `costcatch --save -- python agent.py --json` traces a program
 *      that itself takes `--json`.
 *   2. Otherwise we split at the first token that names a runtime we can trace.
 *
 * Rule 2 is what makes the previous behaviour safe. `run` was declared with
 * `allowUnknownOption` + `allowExcessArguments`, so commander happily ate flags
 * that appeared AFTER the user's program name — `costcatch python agent.py
 * --json` switched costcatch into JSON mode instead of passing `--json` to the
 * agent, and there was no way to opt out.
 */
export function splitInvocation(argv: string[]): { ownArgs: string[]; userCommand: string[] } {
  const terminator = argv.indexOf("--");
  if (terminator !== -1) {
    return { ownArgs: argv.slice(0, terminator), userCommand: argv.slice(terminator + 1) };
  }

  for (let i = 0; i < argv.length; i++) {
    if (isRuntimeExecutable(argv[i])) {
      return { ownArgs: argv.slice(0, i), userCommand: argv.slice(i) };
    }
  }

  return { ownArgs: argv, userCommand: [] };
}
