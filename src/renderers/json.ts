/**
 * JSON renderer.
 *
 * Outputs the trace as structured JSON to stdout.
 * Used with the --json flag for machine-readable output.
 */

import type { Trace } from "../types/trace.js";

/**
 * Render a trace as a JSON string.
 * Uses sorted keys for deterministic output.
 */
export function renderJson(trace: Trace): string {
  return JSON.stringify(trace, null, 2);
}
