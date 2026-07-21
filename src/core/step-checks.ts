// Checks on a finished call, such as whether it failed, may have been billed, or had its output cut off.
import type { LLMStep, Step } from "../types/trace.js";

/** Set by unfinished-calls.ts for a call that got no response before the run ended. */
export const NO_RESPONSE_ERROR = "no_response";

/** Used after the capture limit is hit, when the call may still have been answered and billed. */
export const NOT_RECORDED_ERROR = "not_recorded";

export function isFailedCall(step: LLMStep): boolean {
  return !!step.error || (step.statusCode !== undefined && (step.statusCode < 200 || step.statusCode >= 300));
}

// A call that failed after a 2xx, like a stream that broke off, was still accepted and may be billed.
function mayHaveBeenBilled(step: LLMStep): boolean {
  if (!isFailedCall(step)) return true;
  if (step.error?.type === NOT_RECORDED_ERROR) return true;
  return step.statusCode !== undefined && step.statusCode >= 200 && step.statusCode < 300;
}

/** Providers don't bill a call they refuse with an error status, so its cost is $0 rather than unknown. */
export function isRejectedCall(step: LLMStep): boolean {
  return step.statusCode !== undefined && step.statusCode >= 400;
}

export function isUnpricedCall(step: LLMStep): boolean {
  return step.costUsd === null && mayHaveBeenBilled(step);
}

/** When either count is above zero, the matching run token total is only a lower bound. */
export function tokenGaps(steps: Step[]): { input: number; output: number } {
  let input = 0;
  let output = 0;
  for (const step of steps) {
    if (step.type !== "llm" || !mayHaveBeenBilled(step)) continue;
    if (step.inputTokens === null) input++;
    if (step.outputTokens === null) output++;
  }
  return { input, output };
}

/** When this is above zero, totalCostUsd is only a lower bound. */
export function countUnpriced(steps: Step[]): number {
  let n = 0;
  for (const step of steps) if (step.type === "llm" && isUnpricedCall(step)) n++;
  return n;
}

/** Null means unknown. A run where every call was rejected costs $0, since rejected calls aren't billed. */
export function totalCost(steps: Step[]): number | null {
  const calls = steps.filter((s): s is LLMStep => s.type === "llm");
  const priced = calls.filter((s) => s.costUsd !== null);
  if (priced.length > 0) return priced.reduce((sum, s) => sum + (s.costUsd ?? 0), 0);
  return calls.length > 0 && calls.every(isRejectedCall) ? 0 : null;
}

// Older traces don't store unpricedCalls, so count them from the steps.
export function unpricedCallsOf(trace: { steps: Step[]; summary: { unpricedCalls?: number } }): number {
  return trace.summary.unpricedCalls ?? countUnpriced(trace.steps);
}

// Unrecorded calls aren't counted because they may have been answered.
export function countFailures(steps: Step[]): { calls: number; tools: number } {
  let calls = 0;
  let tools = 0;
  for (const step of steps) {
    if (step.type !== "llm") continue;
    if (isFailedCall(step) && step.error?.type !== NOT_RECORDED_ERROR) calls++;
    for (const tc of step.toolCalls) if (tc.error) tools++;
  }
  return { calls, tools };
}

export type OutputProblemKind = "cut_off" | "blocked" | "invalid_tool_call" | "cancelled";

export interface OutputProblem {
  kind: OutputProblemKind;
  reason: string;
  /** Lists what a cancelled call never got back, either "output", "cost" or "output and cost". */
  unknown?: string;
}

// Cohere reports a cut-off as "timeout".
const CUT_OFF = new Set(["length", "model_length", "max_tokens", "max_output_tokens", "model_context_window_exceeded", "timeout"]);

// providers/google.ts reports a Gemini prompt blocked before any answer as prompt_<blockReason>.
const BLOCKED = new Set(["content_filter", "refusal", "safety", "recitation", "blocklist", "prohibited_content", "spii", "image_safety"]);
const BLOCKED_PROMPT = /^prompt_/;

const INVALID_TOOL_CALL = new Set(["malformed_function_call"]);

export function outputProblem(step: LLMStep): OutputProblem | null {
  if (isFailedCall(step)) return null;
  const reason = step.finishReason.toLowerCase();
  if (step.cancelled) {
    const unknown = [step.outputTokens === null ? "output" : "", step.costUsd === null ? "cost" : ""].filter(Boolean).join(" and ");
    return unknown ? { kind: "cancelled", reason, unknown } : { kind: "cancelled", reason };
  }
  if (CUT_OFF.has(reason)) return { kind: "cut_off", reason };
  if (BLOCKED.has(reason) || BLOCKED_PROMPT.test(reason)) return { kind: "blocked", reason };
  if (INVALID_TOOL_CALL.has(reason)) return { kind: "invalid_tool_call", reason };
  // Must come after the cut-off check, since cut-off arguments are invalid JSON too.
  if (step.toolCalls.some((tc) => tc.invalidArguments)) return { kind: "invalid_tool_call", reason: "arguments are not valid JSON" };
  return null;
}

export const CANCELLED = "stopped by the program before the response finished";

export function describeOutputProblem(problem: OutputProblem, hasToolCalls: boolean): string {
  switch (problem.kind) {
    case "cut_off":
      return `output cut off (${problem.reason}): ${hasToolCalls ? "tool arguments may be incomplete" : "the answer is incomplete"}`;
    case "blocked":
      return `output blocked (${problem.reason})`;
    case "invalid_tool_call":
      return `invalid tool call (${problem.reason})`;
    case "cancelled":
      return `${CANCELLED}${problem.unknown ? `: ${problem.unknown} unknown` : ""}`;
  }
}
