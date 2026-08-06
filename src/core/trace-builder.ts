/**
 * Trace builder.
 *
 * Converts raw HTTP call logs (captured by interceptors) into a structured
 * Trace object with ordered steps, token counts, and metadata.
 */

import type { Trace, Step, LLMStep, RawHttpCall, TraceSummary } from "../types/trace.js";
import type { Runtime } from "../types/config.js";
import { detectProvider } from "../providers/registry.js";
import { calculateStepCost } from "./cost-calculator.js";
import { detectWarnings } from "./warning-engine.js";
import { extractContent, extractError } from "./content-extractor.js";

/** Knobs for {@link buildTrace}. */
export interface BuildOptions {
  /** Capture conversation content into steps (default true). */
  captureContent?: boolean;
  /**
   * Latency above which a step earns a `latency_spike` warning, in ms.
   *
   * Surfaced as `--threshold`. Before this existed the flag was parsed, typed,
   * threaded through `RunFlags`… and then never read, so `--threshold 500`
   * silently did nothing.
   */
  latencyThresholdMs?: number;
  /**
   * Keep only calls to this provider (`--filter`).
   *
   * Applied to the RAW calls, before steps are numbered and totals computed.
   * Filtering afterwards left `summary`, `totalCostUsd` and `warnings`
   * describing the unfiltered run while the rendered tree showed a subset — so
   * `--filter openai` printed an Anthropic-inclusive total under an
   * OpenAI-only list of steps.
   */
  providerFilter?: string;
  /**
   * Redact PII (emails, phones, card numbers) from captured content.
   *
   * Defaults to true. `--no-redact` turns it off for users reading their own
   * traces locally. Secrets and terminal escape sequences are scrubbed
   * regardless — those are never a legitimate thing to keep.
   */
  redactPii?: boolean;
}

/**
 * Build a Trace from raw interceptor output.
 *
 * This is the main data pipeline:
 * raw HTTP logs → provider parsing → cost calculation → warning detection → Trace
 */
export function buildTrace(
  rawCalls: RawHttpCall[],
  script: string,
  runtime: Runtime,
  command: string,
  startedAt: string,
  options: BuildOptions = {},
): Trace {
  const captureContent = options.captureContent !== false;

  // Sort calls by start time to preserve execution order
  const filteredCalls = options.providerFilter
    ? rawCalls.filter((c) => matchesProvider(c, options.providerFilter!))
    : rawCalls;
  const sortedCalls = [...filteredCalls].sort((a, b) => a.startMs - b.startMs);

  const steps: Step[] = [];
  let stepId = 1;
  let contentBudget = CONTENT_BUDGET_CHARS;

  for (const call of sortedCalls) {
    const budgetLeft = contentBudget > 0;
    const step = buildStep(call, stepId, captureContent && budgetLeft, options.redactPii !== false);
    if (!step) continue;

    if (captureContent && !budgetLeft && step.type === "llm") {
      // Say so explicitly: an empty `content` would read as "this call had no
      // conversation", which is a very different claim from "we stopped storing".
      step.content = { system: null, messages: [], output: null, truncated: true };
    }

    contentBudget -= contentCost(step);
    steps.push(step);
    stepId++;
  }

  // Retry detection: an LLM call whose input matches an earlier one, especially
  // right after an error, is almost always a silent retry.
  markRetries(steps);

  // Calculate total duration from first request start to last response end
  const firstStart = sortedCalls.length > 0 ? sortedCalls[0].startMs : Date.now();
  const lastEnd = sortedCalls.length > 0
    ? Math.max(...sortedCalls.map((c) => c.endMs))
    : firstStart;
  const durationMs = lastEnd - firstStart;

  // Calculate total cost — null if any step has unknown pricing
  const totalCostUsd = calculateTotalCost(steps);

  // Build summary
  const summary = buildSummary(steps);

  // Detect warnings
  const warnings = detectWarnings(steps, options.latencyThresholdMs);

  return {
    runId: generateRunId(startedAt),
    script,
    runtime,
    durationMs,
    totalCostUsd,
    steps,
    warnings,
    summary,
    startedAt,
    command,
  };
}

/**
 * Total characters of conversation content one trace may hold (~8 MB of JSON).
 *
 * Chat APIs resend the entire history every turn, so storing full content per
 * step grows with the square of the run length: a 200-step agent with a long
 * context can otherwise produce a saved trace in the hundreds of megabytes —
 * slow to write, slow to load, and useless to read. Per-field caps alone don't
 * bound this because the step COUNT is unbounded.
 *
 * Once the budget is spent, later steps keep every metric (tokens, cost,
 * timing, tool calls, errors) and simply carry no content, flagged with
 * `truncated: true` so `show` can say so rather than implying the call was empty.
 */
const CONTENT_BUDGET_CHARS = 8_000_000;

/** Approximate characters of content a step contributes to the budget. */
function contentCost(step: Step): number {
  if (step.type !== "llm" || !step.content) return 0;
  const c = step.content;
  let total = (c.system?.length ?? 0) + (c.output?.length ?? 0);
  for (const m of c.messages) total += m.content.length + m.role.length;
  return total;
}

/** Whether a raw call belongs to the requested provider (case-insensitive). */
function matchesProvider(call: RawHttpCall, filter: string): boolean {
  try {
    return detectProvider(call.url).name.toLowerCase() === filter.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Build a single step from a raw HTTP call.
 * Returns null if the call can't be parsed (shouldn't happen, but fail safe).
 */
function buildStep(
  call: RawHttpCall,
  id: number,
  captureContent: boolean,
  redactPii: boolean,
): Step | null {
  try {
    const provider = detectProvider(call.url);
    const request = provider.parseRequest(call.requestBody, call.url);
    const parsed = provider.parseResponse(call.responseBody, request);
    const durationMs = call.endMs - call.startMs;
    const costUsd = calculateStepCost(parsed.model, parsed.inputTokens, parsed.outputTokens, parsed.cachedTokens);

    const statusCode = call.statusCode;
    const isError = typeof statusCode === "number" && (statusCode < 200 || statusCode >= 300);
    const error = isError ? extractError(call.responseBody) : null;

    const llmStep: LLMStep = {
      type: "llm",
      id,
      durationMs,
      provider: parsed.provider,
      model: parsed.model,
      inputTokens: parsed.inputTokens,
      outputTokens: parsed.outputTokens,
      cachedTokens: parsed.cachedTokens,
      costUsd,
      toolCalls: parsed.toolCalls,
      isStreaming: parsed.isStreaming,
      finishReason: parsed.finishReason,
      statusCode,
      error,
      content: captureContent
        ? extractContent(call.requestBody, call.responseBody, parsed.provider, { pii: redactPii })
        : null,
      retryOf: null,
    };

    return llmStep;
  } catch {
    // If parsing fails, still create a minimal step so the user sees something
    return {
      type: "llm",
      id,
      durationMs: call.endMs - call.startMs,
      provider: "unknown",
      model: "unknown",
      inputTokens: null,
      outputTokens: null,
      cachedTokens: null,
      costUsd: null,
      toolCalls: [],
      isStreaming: false,
      finishReason: "unknown",
      statusCode: call.statusCode,
      error: null,
      content: null,
      retryOf: null,
    };
  }
}

/**
 * Flag near-duplicate consecutive calls as retries. We fingerprint each LLM
 * step by model + its input messages; if a later step matches an earlier one
 * we set `retryOf`. This catches the classic "it silently retried after a 429"
 * and "my loop re-sends the same prompt" cases.
 */
function markRetries(steps: Step[]): void {
  const seen = new Map<string, number>(); // fingerprint -> step id
  for (const step of steps) {
    if (step.type !== "llm") continue;
    const fp = fingerprint(step);
    if (fp === null) continue;
    const prior = seen.get(fp);
    if (prior !== undefined) step.retryOf = prior;
    else seen.set(fp, step.id);
  }
}

function fingerprint(step: LLMStep): string | null {
  if (!step.content) return null;
  const msgs = step.content.messages.map((m) => `${m.role}:${m.content}`).join("|");
  const key = `${step.model}::${step.content.system ?? ""}::${msgs}`;
  return key.length > 0 ? key : null;
}

/**
 * Calculate total cost across all steps.
 *
 * Returns the best-effort sum of all steps with known pricing. If no LLM steps
 * exist, returns null. A partial sum (some steps unpriced) is far more useful
 * than showing nothing — the UI adds a "≥" prefix when some steps are unknown.
 */
function calculateTotalCost(steps: Step[]): number | null {
  let total = 0;
  let hasAny = false;

  for (const step of steps) {
    if (step.type === "llm") {
      if (step.costUsd !== null) {
        total += step.costUsd;
        hasAny = true;
      }
    }
  }

  return hasAny ? total : null;
}

/** Build aggregated summary from steps. */
function buildSummary(steps: Step[]): TraceSummary {
  let llmCalls = 0;
  let toolCalls = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const step of steps) {
    if (step.type === "llm") {
      llmCalls++;
      totalInputTokens += step.inputTokens ?? 0;
      totalOutputTokens += step.outputTokens ?? 0;
      toolCalls += step.toolCalls.length;
    } else if (step.type === "tool") {
      toolCalls++;
    }
  }

  return {
    llmCalls,
    toolCalls,
    totalInputTokens,
    totalOutputTokens,
    totalSteps: steps.length,
  };
}

/** Generate a deterministic run ID from an ISO timestamp. */
function generateRunId(isoTimestamp: string): string {
  // "2026-05-15T14:32:17.000Z" → "2026-05-15T14-32-17"
  return isoTimestamp
    .replace(/\.\d{3}Z$/, "")
    .replace(/:/g, "-");
}
