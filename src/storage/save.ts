/**
 * Trace saving.
 *
 * Writes a Trace to the `.costcatch/` directory as a JSON file.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Trace } from "../types/trace.js";
import { ensureTracesDir } from "./index.js";

/**
 * Save a trace to disk.
 *
 * The write is atomic: JSON is serialized to a sibling temp file and renamed
 * into place. A run interrupted mid-write (Ctrl+C, OOM, power loss) therefore
 * leaves either the old file or the new one, never a truncated document that
 * `stats` and `diff` would have to skip forever.
 *
 * @param trace       - The trace to save.
 * @param projectRoot - The project root directory.
 * @param customName  - Optional custom name (from --save-as).
 * @returns The absolute path to the saved file.
 */
export function saveTrace(trace: Trace, projectRoot: string, customName?: string): string {
  const tracesDir = ensureTracesDir(projectRoot);

  const filename = customName ? `${sanitizeFilename(customName)}.json` : buildFilename(trace);
  const filepath = uniquePath(path.join(tracesDir, filename), Boolean(customName));

  const json = JSON.stringify(trace, null, 2);
  const tmp = `${filepath}.${process.pid}.tmp`;

  try {
    fs.writeFileSync(tmp, json, { encoding: "utf-8", mode: 0o600 });
    fs.renameSync(tmp, filepath);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* best effort */
    }
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`costcatch: could not save trace to ${filepath}: ${reason}`);
  }

  return filepath;
}

/**
 * Build a filename from the trace metadata.
 * Format: "2026-05-15T14-32-17-script-name.json"
 */
function buildFilename(trace: Trace): string {
  const scriptBase = path.basename(trace.script, path.extname(trace.script));
  const safeName = sanitizeFilename(scriptBase) || "trace";
  return `${sanitizeFilename(trace.runId)}-${safeName}.json`;
}

/**
 * Avoid clobbering an existing trace.
 *
 * `runId` only has second resolution, so two fast runs of the same script
 * collide and the second would silently overwrite the first — destroying the
 * very history `--compare-last` and `stats` depend on. An explicit `--save-as`
 * is treated as a deliberate overwrite.
 */
function uniquePath(desired: string, allowOverwrite: boolean): string {
  if (allowOverwrite || !fs.existsSync(desired)) return desired;

  const dir = path.dirname(desired);
  const ext = path.extname(desired);
  const base = path.basename(desired, ext);
  for (let n = 2; n < 1000; n++) {
    const candidate = path.join(dir, `${base}-${n}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(dir, `${base}-${Date.now()}${ext}`);
}

/**
 * Sanitize a string for use as a filename.
 *
 * Keeps only `[A-Za-z0-9._-]` and collapses runs of `-`, which also neutralizes
 * path traversal: `../../etc/passwd` becomes `etc-passwd`, and a name that is
 * nothing but dots cannot escape the traces directory.
 */
function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned.slice(0, 120);
}
