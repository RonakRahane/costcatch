// Finds the real terminal behind a task runner's pseudo terminal (like turborepo's),
// so the live box can follow resizes the pseudo terminal never sees.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as tty from "node:tty";
import { kernelWindowSize, type TerminalSize } from "./theme.js";

interface ProcessEntry {
  ppid: number;
  tty: string;
}

// Parses the output of `ps -axo pid=,ppid=,tty=`.
export function parseProcessTable(text: string): Map<number, ProcessEntry> {
  const table = new Map<number, ProcessEntry>();
  for (const line of text.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)/.exec(line);
    if (m) table.set(Number(m[1]), { ppid: Number(m[2]), tty: m[3] });
  }
  return table;
}

// ps prints ? on Linux and ?? on macOS and BSD for a process with no terminal.
export const isTerminal = (name: string): boolean => name !== "?" && name !== "??" && name !== "-";

// Returns the terminal of the nearest ancestor that isn't on ours, or null when they all share ours.
export function findRunnerTerminal(table: Map<number, ProcessEntry>, pid: number): string | null {
  const own = table.get(pid)?.tty;
  if (!own || !isTerminal(own)) return null;
  let cursor = pid;
  for (let depth = 0; depth < 32; depth++) {
    const entry = table.get(cursor);
    if (!entry) return null;
    if (entry.tty !== own) return isTerminal(entry.tty) ? entry.tty : null;
    if (entry.ppid <= 1) return null;
    cursor = entry.ppid;
  }
  return null;
}

export function openRunnerTerminal(): (() => Partial<TerminalSize>) | null {
  if (process.platform === "win32") return null;
  let name: string | null;
  try {
    const ps = spawnSync("ps", ["-axo", "pid=,ppid=,tty="], { encoding: "utf8", timeout: 2_000 });
    if (ps.status !== 0 || !ps.stdout) return null;
    name = findRunnerTerminal(parseProcessTable(ps.stdout), process.pid);
  } catch {
    return null;
  }
  if (!name) return null;

  let stream: tty.WriteStream;
  try {
    // O_NOCTTY stops this terminal from becoming our controlling terminal.
    const fd = fs.openSync(`/dev/${name}`, fs.constants.O_RDWR | fs.constants.O_NOCTTY);
    stream = new tty.WriteStream(fd);
  } catch {
    return null;
  }
  if (!stream.isTTY) {
    stream.destroy();
    return null;
  }
  stream.unref();

  // Don't use getWindowSize(), because it returns the size from when the stream opened and no SIGWINCH comes to update it.
  const read = kernelWindowSize(stream);
  if (!read) stream.destroy();
  return read;
}

// turbo always gives the task pane at least this share of the window width.
const PANE_SHARE = 0.75;

// Works out turbo's task pane size from the window size, using both sizes seen at launch.
// The pane gets whatever the task list leaves, but never less than PANE_SHARE.
export function turboPaneLayout(pane: TerminalSize, window: TerminalSize): (now: TerminalSize) => TerminalSize {
  const share = (cols: number) => Math.floor(cols * PANE_SHARE);
  const list = window.columns - pane.columns - 1;
  const knownList = pane.columns + 1 > share(window.columns) && list >= 0 ? list : null;
  const band = Math.max(0, window.rows - pane.rows);
  return (now) => {
    const width = knownList === null ? share(now.columns) : Math.max(now.columns - knownList, share(now.columns));
    return {
      columns: Math.max(1, Math.min(now.columns - 1, width - 1)),
      rows: Math.max(1, now.rows - band),
    };
  };
}

// turbo sets the task's terminal size once at launch and never updates it, so we follow turbo's own window instead.
export function followTurboPane(pane: TerminalSize, readWindow: () => Partial<TerminalSize>): () => TerminalSize {
  const sized = (s: Partial<TerminalSize>): s is TerminalSize => Boolean(s.columns && s.rows);
  const launch = readWindow();
  if (!sized(launch)) return () => pane;
  const layout = turboPaneLayout(pane, launch);
  return () => {
    const now = readWindow();
    return sized(now) ? layout(now) : pane;
  };
}
