// Compares two traces, pairing steps by content rather than by position.
import type { Trace, LLMStep } from "../types/trace.js";
import { unpricedCallsOf } from "./step-checks.js";

export interface TraceDiff {
  before: DiffSummary;
  after: DiffSummary;
  delta: DiffDelta;
  addedToolCalls: string[];
  removedToolCalls: string[];
  stepDeltas: StepDelta[];
}

export interface DiffSummary {
  totalSteps: number;
  llmCalls: number;
  toolCalls: number;
  durationMs: number;
  costUsd: number | null;
  // Calls with no price. When this is above zero, costUsd is only a lower bound.
  unpricedCalls: number;
  maxContext: number;
}

export interface DiffDelta {
  steps: number;
  llmCalls: number;
  toolCalls: number;
  durationMs: number;
  costUsd: number | null;
  maxContext: number;
}

export interface StepDelta {
  stepId: number;
  model: string;
  beforeInputTokens: number | null;
  afterInputTokens: number | null;
  tokenDelta: number | null;
  costDelta: number | null;
}

export function diffTraces(before: Trace, after: Trace): TraceDiff {
  const beforeSummary = extractDiffSummary(before);
  const afterSummary = extractDiffSummary(after);

  const delta: DiffDelta = {
    steps: afterSummary.totalSteps - beforeSummary.totalSteps,
    llmCalls: afterSummary.llmCalls - beforeSummary.llmCalls,
    toolCalls: afterSummary.toolCalls - beforeSummary.toolCalls,
    durationMs: afterSummary.durationMs - beforeSummary.durationMs,
    // Don't subtract lower bounds, or moving a step to an unpriced model would look cheaper.
    costUsd:
      beforeSummary.costUsd !== null &&
      afterSummary.costUsd !== null &&
      beforeSummary.unpricedCalls === 0 &&
      afterSummary.unpricedCalls === 0
        ? afterSummary.costUsd - beforeSummary.costUsd
        : null,
    maxContext: afterSummary.maxContext - beforeSummary.maxContext,
  };

  const beforeToolNames = extractToolCallNames(before);
  const afterToolNames = extractToolCallNames(after);

  const addedToolCalls = afterToolNames.filter((t) => !beforeToolNames.includes(t));
  const removedToolCalls = beforeToolNames.filter((t) => !afterToolNames.includes(t));

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
    unpricedCalls: unpricedCallsOf(trace),
    maxContext,
  };
}

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

function buildStepDeltas(before: Trace, after: Trace): StepDelta[] {
  const pairs = matchSteps(before, after);
  const deltas: StepDelta[] = [];

  for (let i = 0; i < pairs.length; i++) {
    const b = pairs[i].before;
    const a = pairs[i].after;

    if (b && a) {
      const tokenDelta =
        b.inputTokens !== null && a.inputTokens !== null
          ? a.inputTokens - b.inputTokens
          : null;
      const costDelta =
        b.costUsd !== null && a.costUsd !== null ? a.costUsd - b.costUsd : null;

      deltas.push({
        // Use the step's own id, since the pair index drifts once a call is inserted.
        stepId: a.id,
        model: a.model,
        beforeInputTokens: b.inputTokens,
        afterInputTokens: a.inputTokens,
        tokenDelta,
        costDelta,
      });
    } else if (b && !a) {
      deltas.push({
        stepId: b.id,
        model: b.model,
        beforeInputTokens: b.inputTokens,
        afterInputTokens: null,
        tokenDelta: null,
        costDelta: null,
      });
    } else if (!b && a) {
      deltas.push({
        stepId: a.id,
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

  // Then pair steps at the same position with the same model, so an edited step shows as changed.
  for (let i = 0; i < Math.min(bSteps.length, aSteps.length); i++) {
    if (usedB.has(i) || usedA.has(i)) continue;
    if (bSteps[i].model !== aSteps[i].model) continue;
    pairs.push({ before: bSteps[i], after: aSteps[i] });
    usedB.add(i);
    usedA.add(i);
  }

  for (let bi = 0; bi < bSteps.length; bi++) {
    if (!usedB.has(bi)) pairs.push({ before: bSteps[bi], after: null });
  }

  for (let ai = 0; ai < aSteps.length; ai++) {
    if (!usedA.has(ai)) pairs.push({ before: null, after: aSteps[ai] });
  }

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
