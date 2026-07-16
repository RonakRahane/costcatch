/**
 * Trace loading.
 *
 * Loads saved traces from JSON files.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Trace } from "../types/trace.js";
import { TRACES_DIR } from "./index.js";

/**
 * Load a single trace from a JSON file.
 *
 * @param filepath - Absolute or relative path to the trace JSON file.
 * @returns The parsed Trace object.
 * @throws Error if the file doesn't exist or contains invalid JSON.
 */
export function loadTrace(filepath: string): Trace {
  const absPath = path.resolve(filepath);

  if (!fs.existsSync(absPath)) {
    throw new Error(`Trace file not found: ${absPath}`);
  }

  const content = fs.readFileSync(absPath, "utf-8");

  try {
    const trace = JSON.parse(content) as Trace;

    // Minimal validation — check for required fields
    if (!trace.runId || !trace.steps || !Array.isArray(trace.steps)) {
      throw new Error("Invalid trace file: missing required fields (runId, steps)");
    }

    return trace;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Invalid JSON in trace file: ${absPath}`);
    }
    throw err;
  }
}

/**
 * List all trace files in the project's .costcatch/ directory.
 *
 * @param projectRoot - The project root directory.
 * @returns Array of absolute paths to trace files, sorted by modification time (newest first).
 */
export function listTraces(projectRoot: string): string[] {
  const tracesDir = path.join(projectRoot, TRACES_DIR);

  if (!fs.existsSync(tracesDir)) return [];

  const files = fs.readdirSync(tracesDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(tracesDir, f));

  // Sort by modification time, newest first
  files.sort((a, b) => {
    const statA = fs.statSync(a);
    const statB = fs.statSync(b);
    return statB.mtimeMs - statA.mtimeMs;
  });

  return files;
}

/**
 * Load all traces from the project's .costcatch/ directory.
 *
 * @param projectRoot - The project root directory.
 * @returns Array of Trace objects, sorted by start time (newest first).
 */
export function loadAllTraces(projectRoot: string): Trace[] {
  const files = listTraces(projectRoot);
  const traces: Trace[] = [];

  for (const file of files) {
    try {
      traces.push(loadTrace(file));
    } catch {
      // Skip corrupt files — don't crash the stats command
    }
  }

  return traces;
}
