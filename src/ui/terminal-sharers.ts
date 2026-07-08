// Finds other processes writing to the same terminal as the live box, such as a worker
// started next to the traced server. The box would draw over their output.

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import { isTerminal } from "./runner-terminal.js";

export interface Sharer {
  pid: number;
  command: string;
}

interface ProcessRow {
  ppid: number;
  stat: string;
  tty: string;
  command: string;
}

// Parses the output of `ps -axo pid=,ppid=,stat=,tty=,args=`.
export function parseProcessRows(text: string): Map<number, ProcessRow> {
  const table = new Map<number, ProcessRow>();
  for (const line of text.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s*(.*)$/.exec(line);
    if (m) table.set(Number(m[1]), { ppid: Number(m[2]), stat: m[3], tty: m[4], command: m[5].trim() });
  }
  return table;
}

// Processes on pid's terminal, leaving out its ancestors, its descendants and stopped or zombie processes.
export function terminalNeighbours(table: Map<number, ProcessRow>, pid: number): number[] {
  const own = table.get(pid)?.tty;
  if (!own || !isTerminal(own)) return [];

  const ancestors = new Set<number>();
  for (let p = table.get(pid)?.ppid, depth = 0; p !== undefined && p > 0 && depth < 64; depth++) {
    ancestors.add(p);
    p = table.get(p)?.ppid;
  }

  const children = new Map<number, number[]>();
  for (const [child, row] of table) {
    const siblings = children.get(row.ppid);
    if (siblings) siblings.push(child);
    else children.set(row.ppid, [child]);
  }
  const descendants = new Set<number>();
  const pending = [pid];
  while (pending.length > 0) {
    for (const child of children.get(pending.pop()!) ?? []) {
      if (!descendants.has(child)) {
        descendants.add(child);
        pending.push(child);
      }
    }
  }

  const found: number[] = [];
  for (const [p, row] of table) {
    if (p === pid || ancestors.has(p) || descendants.has(p) || row.tty !== own) continue;
    if (row.stat.startsWith("T") || row.stat.startsWith("Z")) continue;
    found.push(p);
  }
  return found;
}

// Parses `lsof -F pn` output into the pids that have device open.
export function parseLsofHolders(text: string, device: string): Set<number> {
  const holders = new Set<number>();
  let pid = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && line.slice(1) === device && pid > 0) holders.add(pid);
  }
  return holders;
}

export function describeCommand(command: string, max = 60): string {
  const [program = "", ...args] = command.split(/\s+/).filter(Boolean);
  const short = [program.split("/").pop() ?? program, ...args].join(" ");
  return short.length > max ? `${short.slice(0, max - 1)}…` : short;
}

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { encoding: "utf8", timeout: 2_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      // lsof exits with 1 when a pid has none of the listed descriptors, but its output is still good.
      resolve(err && !stdout ? "" : stdout);
    });
  });
}

async function writingTo(pids: number[], device: string): Promise<Set<number>> {
  if (process.platform === "linux") {
    const holders = new Set<number>();
    for (const pid of pids) {
      for (const fd of [1, 2]) {
        try {
          if (fs.readlinkSync(`/proc/${pid}/fd/${fd}`) === device) holders.add(pid);
        } catch {}
      }
    }
    return holders;
  }
  const out = await run("lsof", ["-w", "-a", "-p", pids.join(","), "-d", "1,2", "-F", "pn"]);
  return parseLsofHolders(out, device);
}

export async function findTerminalSharers(pid: number = process.pid): Promise<Sharer[]> {
  if (process.platform === "win32") return [];
  try {
    const table = parseProcessRows(await run("ps", ["-axo", "pid=,ppid=,stat=,tty=,args="]));
    const candidates = terminalNeighbours(table, pid);
    if (candidates.length === 0) return [];
    const writers = await writingTo(candidates, `/dev/${table.get(pid)!.tty}`);
    return candidates.filter((p) => writers.has(p)).map((p) => ({ pid: p, command: table.get(p)!.command }));
  } catch {
    return [];
  }
}
