// Detects the traced command's runtime and splits costcatch's own flags from the command.

import * as path from "node:path";
import type { Runtime } from "../types/config.js";

const PYTHON_EXECUTABLES = new Set([
  "python",
  "python2",
  "python3",
  "pythonw",
  "py", // the Windows Python launcher
]);

// Bun and Deno are left out because they ignore --require, so their traces would come back empty.
const NODE_EXECUTABLES = new Set(["node", "nodejs", "npx", "tsx", "ts-node"]);

function baseName(executable: string): string {
  const normalized = executable.replace(/\\/g, "/");
  const base = path.basename(normalized.split("/").pop() ?? normalized);
  return base.replace(/\.(exe|cmd|bat|com)$/i, "").toLowerCase();
}

const PYTHON_VERSIONED = /^python\d+(\.\d+)*$/;

export function classifyExecutable(executable: string): Runtime | null {
  const name = baseName(executable);
  if (!name) return null;
  if (PYTHON_EXECUTABLES.has(name) || PYTHON_VERSIONED.test(name)) return "python";
  if (NODE_EXECUTABLES.has(name)) return "node";
  return null;
}

export function isRuntimeExecutable(token: string): boolean {
  return classifyExecutable(token) !== null;
}

// Looks past args[0] so launchers like `uv run python` or `env KEY=1 node` still get traced.
export function findRuntime(args: string[]): { runtime: Runtime; index: number } | null {
  for (let index = 0; index < args.length; index++) {
    const runtime = classifyExecutable(args[index]);
    if (runtime) return { runtime, index };
  }
  return null;
}

export function detectRuntime(args: string[]): Runtime | null {
  return findRuntime(args)?.runtime ?? null;
}

// The value after a valueFlags option stays with costcatch, even if it names a runtime.
export function splitInvocation(
  argv: string[],
  valueFlags: ReadonlySet<string> = new Set(),
): { ownArgs: string[]; userCommand: string[] } {
  const terminator = argv.indexOf("--");
  if (terminator !== -1) {
    return { ownArgs: argv.slice(0, terminator), userCommand: argv.slice(terminator + 1) };
  }

  for (let i = 0; i < argv.length; i++) {
    if (valueFlags.has(argv[i])) {
      i++;
      continue;
    }
    if (isRuntimeExecutable(argv[i])) {
      return { ownArgs: argv.slice(0, i), userCommand: argv.slice(i) };
    }
  }

  return { ownArgs: argv, userCommand: [] };
}

const WRAPPING_COMMANDS = new Set(["run", "watch"]);

export function firstProgramToken(argv: string[], valueFlags: ReadonlySet<string> = new Set()): number {
  let commandSeen = false;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--") return -1;
    if (valueFlags.has(token)) {
      i++;
      continue;
    }
    if (token.startsWith("-")) continue;
    if (!commandSeen && WRAPPING_COMMANDS.has(token)) {
      commandSeen = true;
      continue;
    }
    return i;
  }
  return -1;
}
