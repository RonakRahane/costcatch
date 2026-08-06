/**
 * Trace loading.
 *
 * Loads saved traces from JSON files. Every input here is untrusted: trace files
 * are shared between developers, committed by accident, and copied out of CI
 * artifacts, so the loader validates shape before the renderers get to assume
 * anything about it.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Trace, Step } from "../types/trace.js";
import { TRACES_DIR } from "./index.js";

/**
 * Refuse to parse a trace larger than this (256 MiB).
 *
 * `JSON.parse` on a multi-gigabyte file blocks the event loop and can exceed the
 * V8 string limit, turning a mis-typed path into a hang or a cryptic crash.
 */
const MAX_TRACE_FILE_BYTES = 256 * 1024 * 1024;

/**
 * Load a single trace from a JSON file.
 *
 * @param filepath - Absolute or relative path to the trace JSON file.
 * @returns The parsed Trace object.
 * @throws Error with an actionable message if the file is missing, too large,
 *         not JSON, or not a trace.
 */
export function loadTrace(filepath: string): Trace {
  const absPath = path.resolve(filepath);

  let stat: fs.Stats;
  try {
    stat = fs.statSync(absPath);
  } catch {
    throw new Error(`Trace file not found: ${absPath}`);
  }

  if (stat.isDirectory()) {
    throw new Error(`Expected a trace file, got a directory: ${absPath}`);
  }
  if (stat.size === 0) {
    throw new Error(`Trace file is empty: ${absPath}`);
  }
  if (stat.size > MAX_TRACE_FILE_BYTES) {
    throw new Error(
      `Trace file is too large to load (${(stat.size / 1024 / 1024).toFixed(0)} MB, max ${MAX_TRACE_FILE_BYTES / 1024 / 1024} MB): ${absPath}`,
    );
  }

  const content = fs.readFileSync(absPath, "utf-8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Invalid JSON in trace file: ${absPath}`);
  }

  const trace = coerceTrace(parsed);
  if (!trace) {
    throw new Error(
      `Not a costcatch trace file (missing runId/steps): ${absPath}`,
    );
  }
  return trace;
}

/**
 * Validate and normalize an arbitrary parsed value into a Trace.
 *
 * Returns null when the value clearly isn't a trace. Missing OPTIONAL fields are
 * filled with safe defaults rather than rejected, so traces written by an older
 * costcatch still open — the alternative is telling users their history is
 * unreadable after an upgrade.
 */
function coerceTrace(value: unknown): Trace | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const t = value as Record<string, unknown>;

  if (typeof t.runId !== "string" || !Array.isArray(t.steps)) return null;

  const steps = (t.steps as unknown[]).filter(
    (s): s is Step => s !== null && typeof s === "object" && "type" in (s as object),
  );

  const summary =
    t.summary !== null && typeof t.summary === "object"
      ? (t.summary as Trace["summary"])
      : { llmCalls: 0, toolCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, totalSteps: steps.length };

  return {
    runId: t.runId,
    script: typeof t.script === "string" ? t.script : "unknown",
    runtime: t.runtime === "node" || t.runtime === "python" ? t.runtime : "node",
    durationMs: typeof t.durationMs === "number" && Number.isFinite(t.durationMs) ? t.durationMs : 0,
    totalCostUsd: typeof t.totalCostUsd === "number" && Number.isFinite(t.totalCostUsd) ? t.totalCostUsd : null,
    steps,
    warnings: Array.isArray(t.warnings) ? (t.warnings as Trace["warnings"]) : [],
    summary,
    startedAt: typeof t.startedAt === "string" ? t.startedAt : new Date(0).toISOString(),
    command: typeof t.command === "string" ? t.command : "",
  };
}

/**
 * List all trace files in the project's `.costcatch/` directory.
 *
 * @param projectRoot - The project root directory.
 * @returns Absolute paths sorted by modification time, newest first.
 */
export function listTraces(projectRoot: string): string[] {
  const tracesDir = path.join(projectRoot, TRACES_DIR);

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(tracesDir, { withFileTypes: true });
  } catch {
    return []; // no traces dir yet, or unreadable — both mean "nothing to list"
  }

  // Read mtime once per file. The previous implementation called statSync from
  // inside the sort comparator, which re-stats the same file O(n log n) times.
  const files: Array<{ file: string; mtimeMs: number }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const file = path.join(tracesDir, entry.name);
    try {
      files.push({ file, mtimeMs: fs.statSync(file).mtimeMs });
    } catch {
      // Vanished between readdir and stat — skip it.
    }
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files.map((f) => f.file);
}

/**
 * Load all traces from the project's `.costcatch/` directory.
 *
 * @param projectRoot - The project root directory.
 * @param limit       - Cap on how many files to read (newest first).
 * @returns Trace objects, newest first. Corrupt files are skipped silently.
 */
export function loadAllTraces(projectRoot: string, limit = Number.POSITIVE_INFINITY): Trace[] {
  const files = listTraces(projectRoot);
  const traces: Trace[] = [];

  for (const file of files) {
    if (traces.length >= limit) break;
    try {
      traces.push(loadTrace(file));
    } catch {
      // Skip corrupt files — one bad trace must not break `stats`.
    }
  }

  return traces;
}
