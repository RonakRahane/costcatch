/**
 * Diff engine.
 *
 * Compares two traces to show what changed between runs.
 * The most powerful feature for prompt iteration workflows.
 */

import type { Trace, LLMStep } from "../types/trace.js";

/** The result of comparing two traces. */
export interface TraceDiff {
  /** The "before" trace summary */
  before: DiffSummary;
  /** The "after" trace summary */
  after: DiffSummary;
  /** Delta values (after - before) */
  delta: DiffDelta;
  /** Tool calls added in the "after" trace */
  addedToolCalls: string[];
  /** Tool calls removed from the "before" trace */
  removedToolCalls: string[];
  /** Per-step token comparison for matching steps */
  stepDeltas: StepDelta[];
}

/** Summary of one side of the diff. */
export interface DiffSummary {
  totalSteps: number;
  llmCalls: number;
  toolCalls: number;
  durationMs: number;
  costUsd: number | null;
  maxContext: number;
}

/** Delta between before and after. */
export interface DiffDelta {
  steps: number;
  llmCalls: number;
  toolCalls: number;
  durationMs: number;
  costUsd: number | null;
  maxContext: number;
}

/** Per-step token delta. */
export interface StepDelta {
  stepId: number;
  model: string;
  beforeInputTokens: number | null;
  afterInputTokens: number | null;
  tokenDelta: number | null;
  costDelta: number | null;
}

/**
 * Compare two traces and produce a diff.
 */
export function diffTraces(before: Trace, after: Trace): TraceDiff {
  const beforeSummary = extractDiffSummary(before);
  const afterSummary = extractDiffSummary(after);

  const delta: DiffDelta = {
    steps: afterSummary.totalSteps - beforeSummary.totalSteps,
    llmCalls: afterSummary.llmCalls - beforeSummary.llmCalls,
    toolCalls: afterSummary.toolCalls - beforeSummary.toolCalls,
    durationMs: afterSummary.durationMs - beforeSummary.durationMs,
    costUsd:
      beforeSummary.costUsd !== null && afterSummary.costUsd !== null
        ? afterSummary.costUsd - beforeSummary.costUsd
        : null,
    maxContext: afterSummary.maxContext - beforeSummary.maxContext,
  };

  // Collect unique tool call names from each trace
  const beforeToolNames = extractToolCallNames(before);
  const afterToolNames = extractToolCallNames(after);

  const addedToolCalls = afterToolNames.filter((t) => !beforeToolNames.includes(t));
  const removedToolCalls = beforeToolNames.filter((t) => !afterToolNames.includes(t));

  // Build step-level deltas by matching steps by position
  const stepDeltas = buildStepDeltas(before, after);

  return {
    before: beforeSummary,
    after: afterSummary,
    delta,
    addedToolCalls,
    removedToolCalls,
    stepDeltas,
  };
}

/** Extract a diff summary from a trace. */
function extractDiffSummary(trace: Trace): DiffSummary {
  const llmSteps = trace.steps.filter((s): s is LLMStep => s.type === "llm");

  const maxContext = llmSteps.reduce(
    (max, s) => Math.max(max, s.inputTokens ?? 0),
    0,
  );

  return {
    totalSteps: trace.steps.length,
    llmCalls: trace.summary.llmCalls,
    toolCalls: trace.summary.toolCalls,
    durationMs: trace.durationMs,
    costUsd: trace.totalCostUsd,
    maxContext,
  };
}

/** Extract unique tool call names from a trace. */
function extractToolCallNames(trace: Trace): string[] {
  const names: string[] = [];

  for (const step of trace.steps) {
    if (step.type === "llm") {
      for (const tc of step.toolCalls) {
        const key = `${tc.name}(${JSON.stringify(tc.input)})`;
        if (!names.includes(key)) names.push(key);
      }
    }
  }

  return names;
}

/** Build per-step token deltas by matching LLM steps by position. */
function buildStepDeltas(before: Trace, after: Trace): StepDelta[] {
  const beforeLLM = before.steps.filter((s): s is LLMStep => s.type === "llm");
  const afterLLM = after.steps.filter((s): s is LLMStep => s.type === "llm");

  const maxLen = Math.max(beforeLLM.length, afterLLM.length);
  const deltas: StepDelta[] = [];

  for (let i = 0; i < maxLen; i++) {
    const b = beforeLLM[i];
    const a = afterLLM[i];

    if (b && a) {
      const tokenDelta =
        b.inputTokens !== null && a.inputTokens !== null
          ? a.inputTokens - b.inputTokens
          : null;
      const costDelta =
        b.costUsd !== null && a.costUsd !== null ? a.costUsd - b.costUsd : null;

      deltas.push({
        stepId: i + 1,
        model: a.model,
        beforeInputTokens: b.inputTokens,
        afterInputTokens: a.inputTokens,
        tokenDelta,
        costDelta,
      });
    } else if (b && !a) {
      deltas.push({
        stepId: i + 1,
        model: b.model,
        beforeInputTokens: b.inputTokens,
        afterInputTokens: null,
        tokenDelta: null,
        costDelta: null,
      });
    } else if (!b && a) {
      deltas.push({
        stepId: i + 1,
        model: a.model,
        beforeInputTokens: null,
        afterInputTokens: a.inputTokens,
        tokenDelta: null,
        costDelta: null,
      });
    }
  }

  return deltas;
}
