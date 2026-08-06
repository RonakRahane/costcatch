/**
 * Compare-last helper.
 *
 * Implements `--compare-last`: after a `run --save`, automatically diff against
 * the most recent prior saved trace for the SAME script. This is the single
 * most valuable workflow for prompt iteration — change the prompt, re-run,
 * instantly see what moved.
 *
 * Alignment strategy: match steps by (model + tool-call-names signature), NOT
 * by index position. This avoids the "run A has 4 steps, run B has 5 → every
 * line after the divergence shows spurious changes" problem.
 */

import * as path from "node:path";
import type { Trace, LLMStep } from "../types/trace.js";
import { listTraces, loadTrace } from "../storage/load.js";

/**
 * Find the most recent saved trace for the same script, excluding the current run.
 * Returns null if no prior trace exists.
 */
export function findPriorTrace(
  currentTrace: Trace,
  projectRoot: string,
): Trace | null {
  const files = listTraces(projectRoot); // sorted newest-first
  const currentScript = path.basename(currentTrace.script);

  for (const file of files) {
    try {
      const candidate = loadTrace(file);
      // Skip the trace we just saved
      if (candidate.runId === currentTrace.runId) continue;
      // Match by script basename (users might run from different CWDs)
      if (path.basename(candidate.script) === currentScript) {
        return candidate;
      }
    } catch {
      // Skip corrupt files
      continue;
    }
  }
  return null;
}

/**
 * Semantic step-matching for diffing.
 *
 * Instead of matching by index position (which breaks when step counts differ),
 * we match by a semantic fingerprint: model + sorted tool call names. This way
 * a newly-inserted step doesn't cascade spurious diffs on every subsequent line.
 *
 * Returns pairs of (beforeStep, afterStep) where null means unmatched.
 */
export interface MatchedPair {
  before: LLMStep | null;
  after: LLMStep | null;
}

export function matchSteps(before: Trace, after: Trace): MatchedPair[] {
  const bSteps = before.steps.filter((s): s is LLMStep => s.type === "llm");
  const aSteps = after.steps.filter((s): s is LLMStep => s.type === "llm");

  const pairs: MatchedPair[] = [];
  const usedB = new Set<number>();
  const usedA = new Set<number>();

  // Pass 1: exact fingerprint matches (model + tool names)
  for (let ai = 0; ai < aSteps.length; ai++) {
    const aFp = stepFingerprint(aSteps[ai]);
    for (let bi = 0; bi < bSteps.length; bi++) {
      if (usedB.has(bi)) continue;
      if (stepFingerprint(bSteps[bi]) === aFp) {
        pairs.push({ before: bSteps[bi], after: aSteps[ai] });
        usedB.add(bi);
        usedA.add(ai);
        break;
      }
    }
  }

  // Pass 2: unmatched from before (removed steps)
  for (let bi = 0; bi < bSteps.length; bi++) {
    if (!usedB.has(bi)) pairs.push({ before: bSteps[bi], after: null });
  }

  // Pass 3: unmatched from after (added steps)
  for (let ai = 0; ai < aSteps.length; ai++) {
    if (!usedA.has(ai)) pairs.push({ before: null, after: aSteps[ai] });
  }

  // Sort by the step id of whichever side is present
  pairs.sort((a, b) => {
    const aId = a.after?.id ?? a.before?.id ?? 0;
    const bId = b.after?.id ?? b.before?.id ?? 0;
    return aId - bId;
  });

  return pairs;
}

function stepFingerprint(step: LLMStep): string {
  const tools = step.toolCalls.map((tc) => tc.name).sort().join(",");
  return `${step.model}::${tools}`;
}
