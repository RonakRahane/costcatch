/**
 * Trace saving.
 *
 * Saves a Trace to the .costcatch/ directory as a JSON file.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Trace } from "../types/trace.js";
import { ensureTracesDir } from "./index.js";

/**
 * Save a trace to disk.
 *
 * @param trace - The trace to save.
 * @param projectRoot - The project root directory.
 * @param customName - Optional custom name (from --save-as flag).
 * @returns The absolute path to the saved file.
 */
export function saveTrace(trace: Trace, projectRoot: string, customName?: string): string {
  const tracesDir = ensureTracesDir(projectRoot);

  // Build filename
  const filename = customName
    ? sanitizeFilename(customName) + ".json"
    : buildFilename(trace);

  const filepath = path.join(tracesDir, filename);

  // Write with deterministic key ordering for reproducibility
  const json = JSON.stringify(trace, null, 2);
  fs.writeFileSync(filepath, json, "utf-8");

  return filepath;
}

/**
 * Build a filename from the trace metadata.
 * Format: "2026-05-15T14-32-script-name.json"
 */
function buildFilename(trace: Trace): string {
  const timestamp = trace.runId;
  const scriptBase = path.basename(trace.script, path.extname(trace.script));
  const safeName = sanitizeFilename(scriptBase);
  return `${timestamp}-${safeName}.json`;
}

/**
 * Sanitize a string for use as a filename.
 * Replaces unsafe characters with hyphens.
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
