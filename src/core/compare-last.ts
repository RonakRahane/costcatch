// Finds the previous saved trace of the same script for --compare-last.

import * as path from "node:path";
import type { Trace } from "../types/trace.js";
import { listTraces, loadTrace } from "../storage/load.js";
export { matchSteps, type MatchedPair } from "./diff-engine.js";

// Pass currentPath when you have it. Run ids only go down to the second, so skipping the
// current run by id can also skip the run we want to compare against.
export function findPriorTrace(
  currentTrace: Trace,
  projectRoot: string,
  currentPath?: string,
): Trace | null {
  const currentScript = path.basename(currentTrace.script);
  const currentFile = currentPath ? path.resolve(currentPath) : null;
  const currentStart = Date.parse(currentTrace.startedAt);

  let best: { trace: Trace; start: number } | null = null;
  for (const file of listTraces(projectRoot)) {
    if (currentFile ? path.resolve(file) === currentFile : false) continue;
    try {
      const candidate = loadTrace(file);
      if (!currentFile && candidate.runId === currentTrace.runId) continue;
      // Compare basenames, since the same script often runs from different directories.
      if (path.basename(candidate.script) !== currentScript) continue;
      // Go by start time, not file mtime, since a copied or touched file isn't a newer run.
      const start = Date.parse(candidate.startedAt);
      const startKey = Number.isFinite(start) ? start : Number.NEGATIVE_INFINITY;
      if (Number.isFinite(currentStart) && startKey > currentStart) continue;
      if (!best || startKey > best.start) best = { trace: candidate, start: startKey };
    } catch {
      continue;
    }
  }
  return best?.trace ?? null;
}
