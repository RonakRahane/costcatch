// Turns a built trace into warnings about errors, tool calls, retries, context growth, cost and latency.
import type { Step, LLMStep, TraceWarning, ToolCall } from "../types/trace.js";
import { formatDuration as fmtMs, compact } from "../ui/theme.js";
import { describeOutputProblem, isFailedCall, NOT_RECORDED_ERROR, outputProblem, type OutputProblemKind } from "./step-checks.js";
import { gapsAfter } from "./timing.js";

export interface RunOutcome {
  exitCode?: number;
  stoppedByBudget?: boolean;
}

const CONTEXT_GROWTH_THRESHOLD = 3;

const COST_CONCENTRATION_THRESHOLD = 0.5;

// In ms.
const ADAPTIVE_LATENCY_FLOOR = 5_000;

const ADAPTIVE_LATENCY_MULTIPLIER = 2.5;

// In ms, for a run with a single call and nothing to compare it with.
// Reasoning calls are expected to be slow, so they get much longer.
const LONE_CALL_LATENCY_CEILING = 30_000;
const LONE_REASONING_LATENCY_CEILING = 15 * 60_000;

export interface WarningContext {
  /** A digest of the raw arguments, since redaction can make different calls look the same. */
  argKey?: (call: ToolCall) => string | undefined;
}

export function detectWarnings(
  steps: Step[],
  latencyThresholdMs?: number,
  outcome: RunOutcome = {},
  context: WarningContext = {},
): TraceWarning[] {
  const explicitThreshold =
    typeof latencyThresholdMs === "number" && Number.isFinite(latencyThresholdMs) && latencyThresholdMs > 0
      ? latencyThresholdMs
      : null;
  const warnings: TraceWarning[] = [];
  const llmSteps = steps.filter((s): s is LLMStep => s.type === "llm");

  // The sort below is stable, so this order is kept within each severity.
  const { argsOf, exactOf, loops } = findToolLoops(llmSteps, context.argKey);
  // Loops past the cap get no warning of their own, so their failures are reported as tool errors.
  const reportedLoops = new Map([...loops].slice(0, MAX_LOOP_WARNINGS));
  warnings.push(...detectErrors(llmSteps));
  warnings.push(...detectToolErrors(llmSteps, reportedLoops));
  warnings.push(...detectToolLoops(loops));
  warnings.push(...detectUnansweredToolCalls(llmSteps, outcome));
  warnings.push(...detectOutputProblems(llmSteps));
  warnings.push(...detectLargeToolResults(llmSteps));
  warnings.push(...detectRetries(llmSteps));
  warnings.push(...detectContextGrowth(llmSteps));
  warnings.push(...detectDuplicateToolCalls(llmSteps, argsOf, exactOf, loops));
  warnings.push(...detectCostConcentration(llmSteps));
  warnings.push(...detectLatencySpikes(steps, explicitThreshold));
  warnings.push(...detectSlowGaps(llmSteps));

  const severityOrder: Record<string, number> = { critical: 0, warn: 1, info: 2 };
  warnings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return warnings;
}

function detectErrors(llmSteps: LLMStep[]): TraceWarning[] {
  const warnings: TraceWarning[] = [];
  for (const step of llmSteps) {
    if (!isFailedCall(step)) continue;
    // The call may have been answered after the capture limit, so it isn't a known failure.
    if (step.error?.type === NOT_RECORDED_ERROR) continue;
    const status = step.statusCode ?? "?";

    const kind = step.error?.type ? ` ${step.error.type}` : "";
    const msg = step.error?.message ? `: ${truncateMsg(step.error.message)}` : "";
    warnings.push({
      severity: "critical",
      code: "http_error",
      message: `Step ${step.id} failed: HTTP ${status}${kind}${msg}`,
      stepIds: [step.id],
    });
  }
  return warnings;
}

const MAX_TOOL_ERROR_WARNINGS = 10;

function detectToolErrors(llmSteps: LLMStep[], loops: Map<string, ToolLoop>): TraceWarning[] {
  const inLoop = new Set<ToolCall>();
  for (const loop of loops.values()) for (const { call } of loop.calls) inLoop.add(call);

  const groups = new Map<string, { name: string; message: string; ids: number[]; count: number }>();
  for (const step of llmSteps) {
    for (const tc of step.toolCalls) {
      if (!tc.error || inLoop.has(tc)) continue;
      const key = `${tc.name}\u0000${tc.error.message}`;
      const group = groups.get(key) ?? { name: tc.name, message: tc.error.message, ids: [], count: 0 };
      group.count++;
      if (group.ids[group.ids.length - 1] !== step.id) group.ids.push(step.id);
      groups.set(key, group);
    }
  }

  const warnings: TraceWarning[] = [];
  let more = 0;
  const moreIds = new Set<number>();
  for (const { name, message, ids, count } of groups.values()) {
    if (warnings.length >= MAX_TOOL_ERROR_WARNINGS) {
      more += count;
      for (const id of ids) moreIds.add(id);
      continue;
    }
    const msg = message ? `: ${truncateMsg(message)}` : "";
    warnings.push({
      severity: "warn",
      code: "tool_error",
      message: count === 1 ? `Step ${ids[0]}: ${name}() failed${msg}` : `${name}() failed ${count} times (steps ${listSteps(ids)})${msg}`,
      stepIds: ids,
    });
  }
  if (more > 0) {
    warnings.push({
      severity: "warn",
      code: "tool_error",
      message: `${more} more tool ${more === 1 ? "call" : "calls"} failed`,
      stepIds: [...moreIds],
    });
  }
  return warnings;
}

interface ToolLoop {
  name: string;
  calls: { stepId: number; call: ToolCall }[];
}

const LOOP_MIN_STEPS = 3;

const MAX_LOOP_WARNINGS = 10;

function findToolLoops(
  llmSteps: LLMStep[],
  argKey?: (call: ToolCall) => string | undefined,
): { argsOf: Map<ToolCall, string>; exactOf: Map<ToolCall, string>; loops: Map<string, ToolLoop> } {
  const argsOf = new Map<ToolCall, string>();
  const exactOf = new Map<ToolCall, string>();
  const groups = new Map<string, ToolLoop & { steps: Set<number> }>();
  for (const step of llmSteps) {
    for (const call of step.toolCalls) {
      const args = argPairs(call.input);
      argsOf.set(call, args);
      const key = `${call.name}\u0000${argKey?.(call) ?? args}`;
      exactOf.set(call, key);
      const group = groups.get(key) ?? { name: call.name, calls: [], steps: new Set<number>() };
      group.calls.push({ stepId: step.id, call });
      group.steps.add(step.id);
      groups.set(key, group);
    }
  }
  const loops = new Map<string, ToolLoop>();
  for (const [key, group] of groups) {
    if (group.steps.size >= LOOP_MIN_STEPS) loops.set(key, { name: group.name, calls: group.calls });
  }
  return { argsOf, exactOf, loops };
}

function detectToolLoops(loops: Map<string, ToolLoop>): TraceWarning[] {
  const warnings: TraceWarning[] = [];
  let more = 0;
  for (const { name, calls } of loops.values()) {
    if (warnings.length >= MAX_LOOP_WARNINGS) {
      more++;
      continue;
    }
    const ids = [...new Set(calls.map((c) => c.stepId))];
    const failed = calls.filter((c) => c.call.error);
    const messages = new Set(failed.map((c) => c.call.error!.message));
    const only = messages.size === 1 ? [...messages][0] : "";
    const why = only ? `: ${truncateMsg(only)}` : "";
    const outcome =
      failed.length === 0 ? "" : failed.length === calls.length ? `; all ${calls.length} failed${why}` : `; ${failed.length} failed${why}`;
    warnings.push({
      severity: failed.length === calls.length ? "critical" : "warn",
      code: "tool_loop",
      message: `${name}() was called ${calls.length} times with the same arguments (steps ${listSteps(ids)})${outcome}`,
      stepIds: ids,
    });
  }
  if (more > 0) {
    warnings.push({
      severity: "warn",
      code: "tool_loop",
      message: `${more} more ${more === 1 ? "tool was" : "tools were"} called repeatedly with the same arguments`,
      stepIds: [],
    });
  }
  return warnings;
}

// Only reported when the run ended abnormally. A healthy agent can finish on a tool call,
// like a "submit" tool, and never send the result back.
function detectUnansweredToolCalls(llmSteps: LLMStep[], outcome: RunOutcome): TraceWarning[] {
  const abnormal = outcome.stoppedByBudget === true || (outcome.exitCode !== undefined && outcome.exitCode !== 0);
  if (!abnormal || llmSteps.some((s) => s.offsetMs === undefined)) return [];
  const why = outcome.stoppedByBudget
    ? "costcatch stopped the program (--budget)"
    : `the program exited with code ${outcome.exitCode}`;

  let latest: LLMStep | null = null;
  let runnerUpStart = -Infinity;
  for (const s of llmSteps) {
    if (latest === null || s.offsetMs! >= latest.offsetMs!) {
      if (latest !== null) runnerUpStart = Math.max(runnerUpStart, latest.offsetMs!);
      latest = s;
    } else {
      runnerUpStart = Math.max(runnerUpStart, s.offsetMs!);
    }
  }

  const warnings: TraceWarning[] = [];
  for (const step of llmSteps) {
    const names = step.toolCalls.filter((tc) => tc.unanswered).map((tc) => `${tc.name}()`);
    if (names.length === 0) continue;
    const otherLatestStart = step === latest ? runnerUpStart : latest!.offsetMs!;
    if (otherLatestStart >= step.offsetMs! + step.durationMs) continue;
    const list = listNames(names);
    const it = names.length === 1 ? "its result" : "their results";
    warnings.push({
      severity: "warn",
      code: "unanswered_tool_call",
      message: `Step ${step.id} asked for ${list}; ${why} before sending ${it} back to the model`,
      stepIds: [step.id],
    });
  }
  return warnings;
}

export function listSteps(ids: number[]): string {
  if (ids.length === 1) return String(ids[0]);
  if (ids.length > 8) return `${ids.slice(0, 6).join(", ")}, … (${ids.length} steps)`;
  return `${ids.slice(0, -1).join(", ")} and ${ids[ids.length - 1]}`;
}

export function listNames(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length > 5) return `${names.slice(0, 4).join(", ")} and ${names.length - 4} more`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const OUTPUT_PROBLEM_CODES: Record<OutputProblemKind, string> = {
  cut_off: "truncated_output",
  blocked: "blocked_output",
  invalid_tool_call: "invalid_tool_call",
  cancelled: "cancelled_call",
};

// A call the program stopped is often on purpose, like a "stop generating" button, so it's only info.
function detectOutputProblems(llmSteps: LLMStep[]): TraceWarning[] {
  const groups = new Map<string, { kind: OutputProblemKind; reason: string; unknown?: string; steps: LLMStep[] }>();
  for (const step of llmSteps) {
    const problem = outputProblem(step);
    if (!problem) continue;
    const key = problem.kind === "cancelled" ? `cancelled\u0000${problem.unknown ?? ""}` : `${problem.kind}\u0000${problem.reason}`;
    const group = groups.get(key) ?? { ...problem, steps: [] };
    group.steps.push(step);
    groups.set(key, group);
  }

  const warnings: TraceWarning[] = [];
  for (const { kind, reason, unknown, steps } of groups.values()) {
    const ids = steps.map((s) => s.id);
    const one = ids.length === 1;
    const who = one ? `Step ${ids[0]}` : `Steps ${listSteps(ids)}`;
    let message: string;
    if (kind === "cut_off") {
      const tools = steps.some((s) => s.toolCalls.length > 0);
      const what = tools ? "tool arguments may be incomplete" : one ? "the answer is incomplete" : "their answers are incomplete";
      message = `${who} ${one ? "was" : "were"} cut off (${reason}): ${what}`;
    } else if (kind === "blocked") {
      message = `${who} ${one ? "was" : "were"} blocked (${reason})`;
    } else if (kind === "cancelled") {
      message = `${who} ${one ? "was" : "were"} ${describeOutputProblem({ kind, reason, unknown }, false)}`;
    } else {
      message = `${who} produced ${one ? "an invalid tool call" : "invalid tool calls"} (${reason})`;
    }
    warnings.push({ severity: kind === "cancelled" ? "info" : "warn", code: OUTPUT_PROBLEM_CODES[kind], message, stepIds: ids });
  }
  return warnings;
}

const LARGE_RESULT_MIN_TOKENS = 1_000;

const LARGE_RESULT_MIN_SHARE = 0.25;

const MAX_LARGE_RESULT_WARNINGS = 10;

function detectLargeToolResults(llmSteps: LLMStep[]): TraceWarning[] {
  const byId = new Map(llmSteps.map((s) => [s.id, s]));
  const warnings: TraceWarning[] = [];
  let more = 0;
  for (const step of llmSteps) {
    for (const tc of step.toolCalls) {
      const result = tc.result;
      if (!result || result.tokens < LARGE_RESULT_MIN_TOKENS) continue;
      const carrier = byId.get(result.stepId);
      const prompt = carrier?.inputTokens;
      if (!carrier || !prompt || prompt <= 0) continue;
      const share = result.tokens / prompt;
      if (share < LARGE_RESULT_MIN_SHARE) continue;
      if (warnings.length >= MAX_LARGE_RESULT_WARNINGS) {
        more++;
        continue;
      }
      // The token estimate can exceed the real prompt size, so cap it at 100%.
      const pct = Math.min(100, Math.round(share * 100));
      const sends =
        result.sendsPartial ? `, sent at least ${result.sends} ${result.sends === 1 ? "time" : "times"}`
        : result.sends > 1 ? `, sent ${result.sends} times` : "";
      warnings.push({
        severity: "warn",
        code: "large_tool_result",
        message: `Step ${step.id}: ${tc.name}() returned ~${compact(result.tokens)} tokens, ${pct}% of step ${carrier.id}'s prompt${sends}`,
        stepIds: [step.id, carrier.id],
      });
    }
  }
  if (more > 0) {
    warnings.push({
      severity: "warn",
      code: "large_tool_result",
      message: `${more} more large tool ${more === 1 ? "result" : "results"}`,
      stepIds: [],
    });
  }
  return warnings;
}

function detectRetries(llmSteps: LLMStep[]): TraceWarning[] {
  const warnings: TraceWarning[] = [];
  for (const step of llmSteps) {
    if (step.retryOf == null) continue;
    const priorFailed = llmSteps.find((s) => s.id === step.retryOf)?.error != null;
    warnings.push({
      severity: priorFailed ? "warn" : "info",
      code: "retry",
      message: priorFailed
        ? `Step ${step.id} retried step ${step.retryOf} (which failed), same prompt re-sent`
        : `Step ${step.id} re-sends the same prompt as step ${step.retryOf} (redundant call?)`,
      stepIds: [step.retryOf, step.id],
    });
  }
  return warnings;
}

function truncateMsg(s: string): string {
  return s.length <= 80 ? s : s.slice(0, 79) + "…";
}

const CONTEXT_MIN_TOKENS = 1_000;

// Each conversation, as grouped by markConversations in trace-builder.ts, is checked on its own.
function detectContextGrowth(allSteps: LLMStep[]): TraceWarning[] {
  const llmSteps = allSteps.filter((s) => s.kind !== "embedding");
  // Older traces have no conversation ids, so all their calls count as one conversation.
  // A call without an id in a newer trace gets a group of its own.
  const known = llmSteps.some((s) => s.conversation !== undefined);
  const conversations = new Map<string, LLMStep[]>();
  for (const step of llmSteps) {
    const key = !known ? "all" : step.conversation !== undefined ? String(step.conversation) : `unread-${step.id}`;
    const calls = conversations.get(key) ?? [];
    calls.push(step);
    conversations.set(key, calls);
  }
  return [...conversations.values()].flatMap(growthWithin);
}

function growthWithin(llmSteps: LLMStep[]): TraceWarning[] {
  const warnings: TraceWarning[] = [];
  if (llmSteps.length < 2) return warnings;

  const firstTokens = llmSteps[0].inputTokens;
  const lastTokens = llmSteps[llmSteps.length - 1].inputTokens;

  if (firstTokens !== null && lastTokens !== null && firstTokens > 0 && lastTokens >= CONTEXT_MIN_TOKENS) {
    const growthFactor = lastTokens / firstTokens;

    if (growthFactor >= 10) {
      warnings.push({
        severity: "critical",
        code: "context_growth",
        message: `Context grew ${Math.round(growthFactor)}× across calls (${firstTokens.toLocaleString()} → ${lastTokens.toLocaleString()} tokens)`,
        stepIds: [llmSteps[0].id, llmSteps[llmSteps.length - 1].id],
      });
    } else if (growthFactor >= CONTEXT_GROWTH_THRESHOLD) {
      warnings.push({
        severity: "warn",
        code: "context_growth",
        message: `Context grew ${growthFactor.toFixed(1)}× across calls (${firstTokens.toLocaleString()} → ${lastTokens.toLocaleString()} tokens)`,
        stepIds: [llmSteps[0].id, llmSteps[llmSteps.length - 1].id],
      });
    }
  }

  for (let i = 1; i < llmSteps.length; i++) {
    const prev = llmSteps[i - 1].inputTokens;
    const curr = llmSteps[i].inputTokens;

    if (prev !== null && curr !== null && prev > 0 && curr >= CONTEXT_MIN_TOKENS) {
      const growth = curr / prev;
      if (growth >= 4) {
        warnings.push({
          severity: "warn",
          code: "context_spike",
          message: `Context grew ${growth.toFixed(1)}× between steps ${llmSteps[i - 1].id} and ${llmSteps[i].id} (${prev.toLocaleString()} → ${curr.toLocaleString()})`,
          stepIds: [llmSteps[i - 1].id, llmSteps[i].id],
        });
      }
    }
  }

  return warnings;
}

const DUPLICATE_LOOKBACK = 16;

const MAX_DUPLICATE_WARNINGS = 25;

// A call repeated in LOOP_MIN_STEPS steps or more gets one loop warning instead of these.
function detectDuplicateToolCalls(
  llmSteps: LLMStep[],
  argsOf: Map<ToolCall, string>,
  exactOf: Map<ToolCall, string>,
  loops: Map<string, ToolLoop>,
): TraceWarning[] {
  const warnings: TraceWarning[] = [];

  interface Entry {
    stepId: number;
    name: string;
    args: string;
    exact: string;
    input: Record<string, unknown>;
  }

  const exactSeen = new Map<string, number>();
  const recentByName = new Map<string, Entry[]>();
  const reportedPairs = new Set<string>();

  const pairKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

  for (const step of llmSteps) {
    const calls = step.toolCalls.map((tc) => {
      const args = argsOf.get(tc) ?? argPairs(tc.input);
      return { tc, args, exactKey: exactOf.get(tc) ?? `${tc.name}\u0000${args}` };
    });

    const inStep = new Map<string, { name: string; count: number }>();
    for (const { tc, exactKey } of calls) {
      if (loops.has(exactKey)) continue;
      const seen = inStep.get(exactKey);
      if (seen) seen.count++;
      else inStep.set(exactKey, { name: tc.name, count: 1 });
    }
    for (const { name, count } of inStep.values()) {
      if (count < 2) continue;
      if (warnings.length >= MAX_DUPLICATE_WARNINGS) return warnings;
      warnings.push({
        severity: "warn",
        code: "duplicate_tool_call",
        message: `Step ${step.id} makes the identical ${name}() call ${count === 2 ? "twice" : `${count} times`}`,
        stepIds: [step.id],
      });
    }

    for (const { tc, args, exactKey } of calls) {
      if (warnings.length >= MAX_DUPLICATE_WARNINGS) return warnings;

      const entry: Entry = { stepId: step.id, name: tc.name, args, exact: exactKey, input: tc.input };

      const looped = loops.has(exactKey);
      const firstStepId = exactSeen.get(exactKey);
      if (looped) {
        if (firstStepId === undefined) exactSeen.set(exactKey, step.id);
      } else if (firstStepId !== undefined && firstStepId !== step.id) {
        const key = pairKey(firstStepId, step.id);
        if (!reportedPairs.has(key)) {
          reportedPairs.add(key);
          warnings.push({
            severity: "warn",
            code: "duplicate_tool_call",
            message: `Steps ${firstStepId} and ${step.id} make the identical ${tc.name}() call`,
            stepIds: [firstStepId, step.id],
          });
        }
      } else if (firstStepId === undefined) {
        exactSeen.set(exactKey, step.id);
      }

      const FUZZY_MAX_CHARS = 10_000;
      const recent = recentByName.get(tc.name) ?? [];
      for (const prior of recent) {
        if (prior.stepId === step.id) continue;
        if (looped && prior.exact === exactKey) continue;
        // Same saved text with different raw arguments means redaction hides the difference.
        if (prior.args === args && prior.exact !== exactKey) continue;
        if (args.length > FUZZY_MAX_CHARS || prior.args.length > FUZZY_MAX_CHARS) continue;
        const key = pairKey(prior.stepId, step.id);
        if (reportedPairs.has(key)) continue;
        if (!nearlySameArguments(prior.input, tc.input)) continue;

        reportedPairs.add(key);
        warnings.push({
          severity: "info",
          code: "duplicate_tool_call",
          message: `Steps ${prior.stepId} and ${step.id} may be near-duplicate ${tc.name}() calls`,
          stepIds: [prior.stepId, step.id],
        });
        break;
      }

      recent.push(entry);
      if (recent.length > DUPLICATE_LOOKBACK) recent.shift();
      recentByName.set(tc.name, recent);
    }
  }

  return warnings;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

function argPairs(input: Record<string, unknown>): string {
  return Object.keys(input)
    .sort()
    .map((k) => {
      const v = input[k];
      return `${k}=${typeof v === "string" ? v : safeStringify(v)}`;
    })
    .join("\u0000");
}

// With fewer calls, one of them nearly always has most of the cost.
const COST_CONCENTRATION_MIN_STEPS = 3;

function detectCostConcentration(llmSteps: LLMStep[]): TraceWarning[] {
  const warnings: TraceWarning[] = [];

  const priced = llmSteps.filter((s) => s.costUsd !== null && s.costUsd > 0 && !isFailedCall(s));
  if (priced.length < COST_CONCENTRATION_MIN_STEPS) return warnings;
  const totalCost = priced.reduce((sum, s) => sum + (s.costUsd ?? 0), 0);
  if (totalCost === 0) return warnings;

  for (const step of priced) {
    const fraction = (step.costUsd ?? 0) / totalCost;
    if (fraction > COST_CONCENTRATION_THRESHOLD) {
      const tokens =
        step.inputTokens !== null && step.outputTokens !== null
          ? ` (${step.inputTokens.toLocaleString()} tok in → ${step.outputTokens.toLocaleString()} tok out)`
          : "";
      warnings.push({
        severity: "warn",
        code: "cost_concentration",
        message: `Step ${step.id} = ${Math.round(fraction * 100)}% of total cost${tokens}`,
        stepIds: [step.id],
      });
    }
  }

  return warnings;
}

function detectLatencySpikes(steps: Step[], explicitThreshold: number | null): TraceWarning[] {
  const warnings: TraceWarning[] = [];
  if (steps.length === 0) return warnings;

  if (explicitThreshold !== null) {
    for (const step of steps) {
      if (step.durationMs > explicitThreshold) {
        warnings.push({
          severity: "info",
          code: "latency_spike",
          message: `Step ${step.id} took ${fmtMs(step.durationMs)} (threshold: ${fmtMs(explicitThreshold)})`,
          stepIds: [step.id],
        });
      }
    }
    return warnings;
  }

  const healthy = steps.filter((s) => s.type !== "llm" || !s.error);
  const basis = healthy.length > 0 ? healthy : steps;
  const wholeRunMedian = median(basis.map((s) => s.durationMs));

  for (const step of steps) {
    // With five or more samples, one outlier barely moves the median, so the shared one is fine.
    const others = basis.length >= 5 ? null : basis.filter((s) => s !== step);

    let threshold: number;
    let reference: string;
    if (others !== null && others.length === 0) {
      const reasoned = step.type === "llm" && (step.reasoningTokens ?? 0) > 0;
      threshold = reasoned ? LONE_REASONING_LATENCY_CEILING : LONE_CALL_LATENCY_CEILING;
      reference = reasoned
        ? `single reasoning call, over ${fmtMs(LONE_REASONING_LATENCY_CEILING)}`
        : `single call, over ${fmtMs(LONE_CALL_LATENCY_CEILING)}`;
    } else {
      const base = others === null ? wholeRunMedian : median(others.map((s) => s.durationMs));
      threshold = Math.max(base * ADAPTIVE_LATENCY_MULTIPLIER, ADAPTIVE_LATENCY_FLOOR);
      reference = `rest of run: ${fmtMs(base)}`;
    }

    if (step.durationMs > threshold) {
      warnings.push({
        severity: "info",
        code: "latency_spike",
        message: `Step ${step.id} took ${fmtMs(step.durationMs)} (${reference})`,
        stepIds: [step.id],
      });
    }
  }

  return warnings;
}

// In ms.
const SLOW_GAP_FLOOR = 5_000;

const SLOW_GAP_MULTIPLIER = 2.5;

// In ms, for a run with only one gap.
const LONE_GAP_CEILING = 30_000;

function detectSlowGaps(llmSteps: LLMStep[]): TraceWarning[] {
  const gaps = gapsAfter(llmSteps);
  if (gaps.size === 0) return [];
  const all = [...gaps.values()];
  const wholeRunMedian = median(all);
  const byId = new Map(llmSteps.map((s) => [s.id, s]));

  const warnings: TraceWarning[] = [];
  for (const [stepId, gap] of gaps) {
    let threshold: number;
    let reference: string;
    if (all.length === 1) {
      threshold = LONE_GAP_CEILING;
      reference = `single gap, over ${fmtMs(LONE_GAP_CEILING)}`;
    } else {
      const others = all.length >= 5 ? null : [...gaps].filter(([id]) => id !== stepId).map(([, g]) => g);
      const base = others === null ? wholeRunMedian : median(others);
      threshold = Math.max(base * SLOW_GAP_MULTIPLIER, SLOW_GAP_FLOOR);
      reference = `other gaps: ${fmtMs(base)}`;
    }
    if (gap <= threshold) continue;
    const tools = byId.get(stepId)?.toolCalls.map((tc) => `${tc.name}()`) ?? [];
    const asked = tools.length > 0 ? `; step ${stepId} asked for ${listNames(tools)}` : "";
    warnings.push({
      severity: "info",
      code: "slow_gap",
      message: `${fmtMs(gap)} passed after step ${stepId} before the next LLM call (${reference})${asked}`,
      stepIds: [stepId],
    });
  }
  return warnings;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Only free text may differ, and only in case, spacing, punctuation or spelling.
// A different number, id or word is a different request.
function nearlySameArguments(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length || !keys.every((k) => k in b)) return false;
  let differs = false;
  for (const k of keys) {
    const x = a[k];
    const y = b[k];
    if (x === y || safeStringify(x) === safeStringify(y)) continue;
    if (typeof x !== "string" || typeof y !== "string" || !sameWordsLoosely(x, y)) return false;
    differs = true;
  }
  return differs;
}

const WORD = /[\p{L}\p{N}]+/gu;

function sameWordsLoosely(x: string, y: string): boolean {
  const wx = x.toLowerCase().match(WORD) ?? [];
  const wy = y.toLowerCase().match(WORD) ?? [];
  if (wx.length === 0 || wx.length !== wy.length) return false;
  if (wx.every((w, i) => w === wy[i])) return true;
  // A value of one or two words is usually an id or a choice, so it must match exactly.
  return wx.length >= 3 && wx.every((w, i) => w === wy[i] || spellingVariant(w, wy[i]));
}

function spellingVariant(a: string, b: string): boolean {
  if (/\d/.test(a) || /\d/.test(b)) return false;
  const shorter = Math.min(a.length, b.length);
  if (shorter < 4) return false;
  let same = 0;
  while (same < shorter && a[same] === b[same]) same++;
  return same >= Math.max(4, Math.ceil(shorter * 0.7));
}
