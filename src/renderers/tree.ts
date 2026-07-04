// Draws the final trace box after a run and for replay, plus a plain text version for CI.
import chalk from "chalk";
import type { Trace, LLMStep, ToolStep, Step, TraceWarning, ToolCall } from "../types/trace.js";
import { formatCost, formatProjection, formatTotalCost } from "../core/cost-calculator.js";
import { isFailedCall, isRejectedCall, countFailures, outputProblem, describeOutputProblem, unpricedCallsOf, tokenGaps } from "../core/step-checks.js";
import { timeSplit } from "../core/timing.js";
import { stripControl } from "../core/redact.js";

export { isFailedCall, countFailures };
import {
  formatDuration as fmtDuration,
  palette,
  glyph,
  c,
  dim,
  faint,
  stepNumber,
  termWidth,
  truncate,
  gradient,
  frameTop,
  frameBottom,
  frameLine,
  wordmark,
  plural,
  renderBar,
  visibleLength,
  compact,
} from "../ui/theme.js";

export function renderTree(trace: Trace, showCost: boolean = true, useColor: boolean = true): string {
  if (!useColor) return renderPlainTree(trace, showCost);

  const width = termWidth();
  const lines: string[] = [];

  const llmSteps = trace.steps.filter((s): s is LLMStep => s.type === "llm");
  const models = new Set(llmSteps.map((s) => s.model));
  const singleModel = models.size === 1 ? llmSteps[0].model : null;

  // Use a loop rather than Math.max(...arr), because spreading a huge trace overflows the call stack.
  const layout: RowLayout = {
    showModel: singleModel === null,
    stepW: 0, durW: 0, tokInW: 0, tokOutW: 0, maxCostUsd: 0, costW: 0, modelW: 0,
    showBar: false, showCached: false, showReasoning: false,
  };
  let cachedW = 0;
  let reasonW = 0;
  for (const s2 of trace.steps) {
    layout.stepW = Math.max(layout.stepW, stepNumber(s2.id).length);
    layout.durW = Math.max(layout.durW, fmtDuration(s2.durationMs).length);
    if (s2.type !== "llm") continue;
    layout.tokInW = Math.max(layout.tokInW, (s2.inputTokens ?? 0).toLocaleString().length);
    layout.tokOutW = Math.max(layout.tokOutW, (s2.outputTokens ?? 0).toLocaleString().length);
    layout.maxCostUsd = Math.max(layout.maxCostUsd, s2.costUsd ?? 0);
    layout.costW = Math.max(layout.costW, formatCost(s2.costUsd).length);
    const cached = s2.cachedTokens ?? 0;
    // "  " (2) + figure + " cached" (7)
    if (cached > 0) cachedW = Math.max(cachedW, cached.toLocaleString().length + 9);
    const reasoned = s2.reasoningTokens ?? 0;
    // "  " (2) + figure + " thinking" (9)
    if (reasoned > 0) reasonW = Math.max(reasonW, reasoned.toLocaleString().length + 11);
  }
  if (llmSteps.length <= 1) layout.maxCostUsd = 0;
  fitRow(width, layout, showCost, cachedW, reasonW);

  const unpriced = unpricedCallsOf(trace);
  const totalCost = formatTotalCost(trace.totalCostUsd, unpriced);
  const fixedMeta =
    `${c("accent", fmtDuration(trace.durationMs))}${
      showCost ? "  " + c("cost", totalCost) : ""
    }`;
  // 5 for the "  ·  " separator and 3 to keep a gap after the wordmark.
  const headerRoom = width - 4 - visibleLength(wordmark()) - visibleLength(fixedMeta) - 5 - 3;
  const meta =
    singleModel !== null && headerRoom >= MODEL_MIN_W
      ? dim(truncate(singleModel, Math.min(headerRoom, 36))) + dim("  ·  ") + fixedMeta
      : fixedMeta;
  lines.push("");
  lines.push(frameTop(wordmark(), meta, width));
  lines.push(frameLine("", width));

  for (const step of trace.steps) {
    const rows = step.type === "llm" ? renderLLM(step, trace.steps, showCost, layout) : renderTool(step);
    for (const r of rows) lines.push(frameLine(r, width));
    lines.push(frameLine("", width));
  }

  lines.push(frameLine(faint("── ") + dim("summary"), width));
  const s = trace.summary;
  lines.push(
    frameLine(
      `${c("accent", String(s.llmCalls))} ${dim(s.llmCalls === 1 ? "LLM call" : "LLM calls")}` +
        dim("  ·  ") +
        `${c("accent", String(s.toolCalls))} ${dim(s.toolCalls === 1 ? "tool call" : "tool calls")}` +
        dim("  ·  ") +
        `${c("accent", fmtDuration(trace.durationMs))}` +
        (showCost ? dim("  ·  ") + c("cost", totalCost) : ""),
      width,
    ),
  );
  const failureLine = failureSummary(countFailures(trace.steps));
  if (failureLine) lines.push(frameLine(`${c("err", glyph.err)} ${c("err", failureLine)}`, width));
  if (showCost && unpriced > 0) {
    lines.push(frameLine(`${c("warn", glyph.warn)} ${c("warn", unpricedLine(unpriced, trace.totalCostUsd !== null))}`, width));
  }
  const split = timeSplitLine(trace);
  if (split) {
    lines.push(
      frameLine(
        `${c("accent", fmtDuration(split.llmMs))} ${dim("in LLM calls")}${dim("  ·  ")}` +
          `${c("accent", fmtDuration(split.betweenMs))} ${dim("between calls (your code and tools)")}`,
        width,
      ),
    );
  }
  // Say "repeated" rather than "retry", because sending the same prompt twice may be deliberate.
  if (s.retries > 0) {
    const wastedNote =
      showCost && s.wastedCostUsd > 0
        ? dim("  ·  ") + c("warn", `${formatCost(s.wastedCostUsd)} on the earlier copies`)
        : "";
    lines.push(
      frameLine(
        `${c("warn", String(s.retries))} ${dim(s.retries === 1 ? "repeated prompt" : "repeated prompts")}${wastedNote}`,
        width,
      ),
    );
  }
  if (s.totalInputTokens > 0 || s.totalOutputTokens > 0) {
    lines.push(
      frameLine(
        tokenTotals(s.totalInputTokens, s.totalOutputTokens, tokenGaps(trace.steps)) +
          (s.totalReasoningTokens > 0
            ? `  ${faint(glyph.dot)} ${dim(`${compact(s.totalReasoningTokens)} of it thinking`)}`
            : ""),
        width,
      ),
    );
    if (showCost && trace.totalCostUsd !== null && trace.totalCostUsd > 0) {
      // At 80 columns the full form clips the 1000/day figure, so fall back to shorter forms.
      const cost = trace.totalCostUsd;
      const rates = [1, 100, 1000];
      const atLeast = unpriced > 0 ? "≥" : "";
      const full = rates.map((n) => formatProjection(cost, n).replace("/month", "/mo").replace(" = ", atLeast ? " ≥ " : " = "));
      const compactForm = rates.map(
        (n) => `${n >= 1000 ? `${n / 1000}k` : n}/day ${atLeast}${formatProjection(cost, n).split(" = ")[1].replace("/month", "/mo")}`,
      );
      const sep = "  ·  ";
      const inner = width - 4;
      const fits = (parts: string[]) => parts.join(sep).length <= inner;

      if (fits(full)) {
        lines.push(frameLine(full.map(dim).join(dim(sep)), width));
      } else if (fits(compactForm)) {
        lines.push(frameLine(compactForm.map(dim).join(dim(sep)), width));
      } else {
        for (const part of compactForm) lines.push(frameLine(dim(part), width));
      }
    }
  }

  if (trace.warnings.length > 0) {
    lines.push(frameLine("", width));
    lines.push(frameLine(faint("── ") + c("warn", "warnings"), width));
    for (const w of trace.warnings) {
      lines.push(frameLine(renderWarning(w), width));
    }
  }

  const saved = trace.runId ? dim(`run ${trace.runId}`) : gradient("zero-instrumentation trace");
  lines.push(frameBottom(saved, width));
  lines.push("");

  return lines.join("\n");
}

interface RowLayout {
  showModel: boolean;
  stepW: number;
  durW: number;
  tokInW: number;
  tokOutW: number;
  // The highest step cost, used to scale the cost bars. 0 turns the bars off.
  maxCostUsd: number;
  costW: number;
  modelW: number;
  showBar: boolean;
  showCached: boolean;
  showReasoning: boolean;
}

const MODEL_MIN_W = 8;

function fitRow(
  width: number,
  layout: RowLayout,
  showCost: boolean,
  cachedW: number,
  reasonW: number,
): void {
  const inner = width - 4; // "│ " + " │"
  const base =
    2 + // status glyph + space
    layout.stepW +
    1 +
    Math.max(layout.durW, 6) +
    2 +
    (layout.tokInW + layout.tokOutW + 18) + // "1,024 tok in → 512 tok out"
    (showCost ? layout.costW + 2 : 0);

  if (layout.showModel) {
    layout.modelW = Math.min(22, inner - base - 2);
    if (layout.modelW < MODEL_MIN_W) {
      layout.showModel = false;
      layout.modelW = 0;
    }
  }

  const used = base + (layout.showModel ? layout.modelW + 2 : 0);

  layout.showReasoning = reasonW > 0 && used + reasonW <= inner;
  const afterReasoning = used + (layout.showReasoning ? reasonW : 0);

  layout.showBar = showCost && layout.maxCostUsd > 0 && afterReasoning + BAR_W <= inner;
  layout.showCached =
    cachedW > 0 && afterReasoning + (layout.showBar ? BAR_W : 0) + cachedW <= inner;
}

// two spaces and a 5-cell bar
const BAR_W = 7;

function costBar(costUsd: number | null, maxCostUsd: number): string {
  if (costUsd === null || maxCostUsd <= 0) return "";
  // A free call gets an empty bar, and any paid call fills at least a quarter cell.
  const fraction = costUsd <= 0 ? 0 : Math.max(costUsd / maxCostUsd, 0.05);
  return "  " + renderBar(fraction, 5, palette.cost);
}

type TokenBreakdown = "thinking" | "cached";

function tokenBreakdown(step: LLMStep, kind: TokenBreakdown): number | null {
  const n = kind === "thinking" ? step.reasoningTokens : step.cachedTokens;
  return n !== null && n > 0 ? n : null;
}

export function cachedNote(step: LLMStep): string {
  const n = tokenBreakdown(step, "cached");
  return n === null ? "" : `  ${c("ok", `${n.toLocaleString()} cached`)}`;
}

export function reasoningNote(step: LLMStep): string {
  const n = tokenBreakdown(step, "thinking");
  return n === null ? "" : `  ${c("token", `${n.toLocaleString()} thinking`)}`;
}

function plainTokenNotes(step: LLMStep): string {
  return (["thinking", "cached"] as const)
    .map((kind) => {
      const n = tokenBreakdown(step, kind);
      return n === null ? "" : ` (${n} ${kind})`;
    })
    .join("");
}

function timeSplitLine(trace: Trace) {
  if (trace.steps.length < 2) return null;
  const split = timeSplit(trace.steps);
  return split && split.betweenMs > 0 ? split : null;
}

export function failureSummary(failures: { calls: number; tools: number }): string | null {
  const parts: string[] = [];
  if (failures.calls > 0) parts.push(plural(failures.calls, "failed LLM call"));
  if (failures.tools > 0) parts.push(plural(failures.tools, "failed tool call"));
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

const ERROR_ROW_MAX_CHARS = 300;

export function callErrorRow(step: LLMStep): string | null {
  if (!step.error) return null;
  const kind = step.error.type ? c("err", `${oneLine(step.error.type)} `) : "";
  return `   ${faint(glyph.leaf)} ${kind}${dim(truncate(oneLine(step.error.message), ERROR_ROW_MAX_CHARS))}`;
}

function resultNote(tc: ToolCall): string {
  if (tc.result) return `  ${faint(glyph.arrow)} ${dim(`~${compact(tc.result.tokens)} tok`)}`;
  if (tc.unanswered) return `  ${faint(glyph.arrow)} ${dim("no result")}`;
  return "";
}

export function callMark(step: LLMStep): { role: "ok" | "warn" | "err"; mark: string } {
  if (isFailedCall(step)) return { role: "err", mark: glyph.err };
  return outputProblem(step) ? { role: "warn", mark: glyph.warn } : { role: "ok", mark: glyph.ok };
}

export function callBadge(step: LLMStep): string {
  const { role, mark } = callMark(step);
  return c(role, mark);
}

export function tokenTotal(n: number, gaps: number): string {
  if (gaps === 0) return compact(n);
  return n > 0 ? `≥${compact(n)}` : "?";
}

export function tokenTotals(input: number, output: number, gaps: { input: number; output: number }): string {
  return `${c("token", tokenTotal(input, gaps.input))} ${dim("tok in")} ${faint(glyph.arrow)} ${c("token", tokenTotal(output, gaps.output))} ${dim("tok out")}`;
}

// A rejected call costs nothing, and the totals count it as $0.00 too.
export function stepCost(step: LLMStep): string {
  return formatCost(isRejectedCall(step) ? 0 : step.costUsd);
}

export function outputProblemRow(step: LLMStep): string | null {
  const problem = outputProblem(step);
  if (!problem) return null;
  return `   ${c("warn", glyph.warn)} ${c("warn", describeOutputProblem(problem, step.toolCalls.length > 0))}`;
}

export function toolCallRows(step: LLMStep): string[] {
  const rows: string[] = [];
  step.toolCalls.forEach((tc, i) => {
    const last = i === step.toolCalls.length - 1;
    const conn = faint(last ? glyph.leaf : glyph.branch);
    const args = `${faint("(")}${dim(formatArgs(tc.input))}${faint(")")}`;
    // The name comes from the model, and a line break in it would split the row.
    const name = oneLine(tc.name);
    if (!tc.error) {
      rows.push(`   ${conn} ${c("warn", glyph.bolt)} ${c("warn", name)}${args}${resultNote(tc)}`);
      return;
    }
    rows.push(`   ${conn} ${c("err", glyph.err)} ${c("err", name)}${args}`);
    const message = oneLine(tc.error.message);
    const why = message ? dim(truncate(message, ERROR_ROW_MAX_CHARS)) : dim("(no message)");
    rows.push(`   ${last ? " " : faint(glyph.v)}    ${c("err", "failed:")} ${why}`);
  });
  return rows;
}

function renderLLM(step: LLMStep, allSteps: Step[], showCost: boolean, layout: RowLayout): string[] {
  const rows: string[] = [];
  const num = c("accent", stepNumber(step.id).padEnd(layout.stepW));
  const model = layout.showModel
    ? chalk.hex(palette.text).bold(truncate(step.model, layout.modelW).padEnd(layout.modelW)) + "  "
    : "";
  const dur = dim(fmtDuration(step.durationMs).padStart(Math.max(layout.durW, 6)));
  const isError = isFailedCall(step);

  const cached = layout.showCached ? cachedNote(step) : "";
  const reasoned = layout.showReasoning ? reasoningNote(step) : "";
  const tok =
    step.inputTokens !== null && step.outputTokens !== null
      ? `${c("token", step.inputTokens.toLocaleString().padStart(layout.tokInW))} ${dim("tok in")} ${faint(glyph.arrow)} ${c("token", step.outputTokens.toLocaleString().padStart(layout.tokOutW))} ${dim("tok out")}`
      : dim("tokens ?");
  const cost =
    showCost && !isError
      ? "  " +
        c("cost", formatCost(step.costUsd).padStart(layout.costW)) +
        (layout.showBar ? costBar(step.costUsd, layout.maxCostUsd) : "")
      : "";

  const badge = callBadge(step);
  const head = isError
    ? `${badge} ${num} ${model}${dur}  ${c("err", `HTTP ${step.statusCode ?? "?"}`)}`
    : `${badge} ${num} ${model}${dur}  ${tok}${cost}${reasoned}${cached}`;
  rows.push(head);

  const why = callErrorRow(step);
  if (why) rows.push(why);

  if (step.retryOf != null) {
    rows.push(`   ${c("warn", glyph.arrow + glyph.arrow)} ${c("warn", `retry of step ${step.retryOf}`)}`);
  }

  rows.push(...toolCallRows(step));

  const problem = outputProblemRow(step);
  if (problem) {
    rows.push(problem);
  } else if (step.toolCalls.length === 0 && step.finishReason && step.finishReason !== "unknown") {
    rows.push(`   ${faint(glyph.leaf)} ${c("ok", glyph.ok)} ${dim(`${step.finishReason}, final answer`)}`);
  }

  const prev = findPrevLLM(step.id, allSteps);
  if (prev && step.inputTokens !== null && prev.inputTokens !== null && prev.inputTokens > 0) {
    const growth = step.inputTokens / prev.inputTokens;
    if (growth >= 3) {
      rows.push(`   ${c("warn", glyph.warn)} ${c("warn", `context grew ${growth.toFixed(1)}× (${prev.inputTokens.toLocaleString()} → ${step.inputTokens.toLocaleString()} input tok)`)}`);
    }
  }

  return rows;
}

function renderTool(step: ToolStep): string[] {
  const num = c("accent", stepNumber(step.id));
  const dur = dim(fmtDuration(step.durationMs).padStart(6));
  const rows = [`${c("warn", glyph.bolt)} ${num} ${chalk.hex(palette.text)(truncate(step.name, 22))}  ${dur}`];
  if (step.outputChars !== null) {
    rows.push(`   ${faint(glyph.leaf)} ${dim(`returned ${step.outputChars.toLocaleString()} chars`)}`);
  }
  return rows;
}

function renderWarning(w: TraceWarning): string {
  const role = w.severity === "critical" ? "err" : w.severity === "warn" ? "warn" : "dim";
  const bullet = w.severity === "critical" ? c("err", glyph.bullet) : w.severity === "warn" ? c("warn", glyph.bullet) : faint(glyph.bullet);
  const text = oneLine(w.message);
  const msg = role === "dim" ? dim(text) : c(role as "err" | "warn", text);
  return `${bullet} ${msg}`;
}

function unpricedLine(n: number, hasTotal: boolean): string {
  return `${plural(n, "call")} could not be priced${hasTotal ? ": the total is a lower bound" : ""}`;
}

function renderPlainTree(trace: Trace, showCost: boolean): string {
  const lines: string[] = [];
  // CI reads this output, so it has to respect --no-cost and show the same retry waste as the colored box.
  const unpriced = unpricedCallsOf(trace);
  const cost = showCost ? formatTotalCost(trace.totalCostUsd, unpriced) : null;
  const dur = fmtDuration(trace.durationMs);

  lines.push("");
  lines.push(`costcatch  ${dur}${cost ? ` · ${cost}` : ""}`);
  lines.push("");

  for (const step of trace.steps) {
    if (step.type === "llm") {
      const tok =
        step.inputTokens !== null
          ? `${step.inputTokens} tok in -> ${step.outputTokens ?? "?"} tok out${plainTokenNotes(step)}`
          : "tokens ?";
      lines.push(`  ${step.id}. LLM  ${step.model.padEnd(22)} ${fmtDuration(step.durationMs)}  ${tok}  ${showCost ? stepCost(step) : ""}`);
      if (isFailedCall(step)) {
        const kind = step.error?.type ? `${oneLine(step.error.type)}: ` : "";
        const why = step.error ? ` ${kind}${oneLine(step.error.message)}` : "";
        lines.push(`       FAILED HTTP ${step.statusCode ?? "?"}${why}`);
      }
      for (const tc of step.toolCalls) {
        const result = tc.error ? "" : tc.result ? `  -> ~${compact(tc.result.tokens)} tok` : tc.unanswered ? "  -> no result" : "";
        lines.push(`       - ${tc.name}(${formatArgs(tc.input)})${result}`);
        if (tc.error) lines.push(`         FAILED: ${oneLine(tc.error.message) || "(no message)"}`);
      }
      const problem = outputProblem(step);
      if (problem) lines.push(`       ! ${describeOutputProblem(problem, step.toolCalls.length > 0)}`);
    } else {
      lines.push(`  ${step.id}. TOOL ${step.name.padEnd(22)} ${fmtDuration(step.durationMs)}`);
    }
  }

  lines.push("");
  lines.push(
    `  ${plural(trace.summary.llmCalls, "LLM call")} · ${plural(trace.summary.toolCalls, "tool call")} · ${dur}` +
      (cost ? ` · ${cost}` : ""),
  );
  const failureLine = failureSummary(countFailures(trace.steps));
  if (failureLine) lines.push(`  ${failureLine}`);
  if (showCost && unpriced > 0) lines.push(`  ${unpricedLine(unpriced, trace.totalCostUsd !== null)}`);
  const split = timeSplitLine(trace);
  if (split) {
    lines.push(`  ${fmtDuration(split.llmMs)} in LLM calls · ${fmtDuration(split.betweenMs)} between calls (your code and tools)`);
  }
  if (trace.summary.retries > 0) {
    const waste =
      showCost && trace.summary.wastedCostUsd > 0
        ? ` · ${formatCost(trace.summary.wastedCostUsd)} on the earlier copies`
        : "";
    lines.push(
      `  ${trace.summary.retries} ${trace.summary.retries === 1 ? "repeated prompt" : "repeated prompts"}${waste}`,
    );
  }
  if (trace.warnings.length > 0) {
    lines.push("  warnings:");
    for (const w of trace.warnings) lines.push(`    - [${w.severity}] ${w.message}`);
  }
  lines.push("");

  return lines.join("\n");
}

const ARGS_MAX_CHARS = 48;

// Runs about 12 times a second on arguments that can hold whole files, so values are cut
// before stringifying and the results are cached.
export function formatArgs(input: Record<string, unknown>): string {
  const hit = formatArgsCache.get(input);
  if (hit !== undefined) return hit;

  const parts: string[] = [];
  let used = 0;
  for (const [k, v] of Object.entries(input)) {
    if (used > ARGS_MAX_CHARS) break;
    // Strip terminal escapes from model output, or one could clear the screen.
    const val =
      typeof v === "string"
        ? `"${truncate(escapeBreaks(stripControl(v.slice(0, ARGS_MAX_CHARS * 4))), ARGS_MAX_CHARS + 1)}"`
        : truncate(stringifyBounded(v), ARGS_MAX_CHARS + 1);
    const part = `${escapeBreaks(stripControl(k))}=${val}`;
    parts.push(part);
    used += part.length + 2;
  }
  const out = truncate(parts.join(", "), ARGS_MAX_CHARS);
  formatArgsCache.set(input, out);
  return out;
}

const formatArgsCache = new WeakMap<Record<string, unknown>, string>();

// A raw line break would split the row and throw off the live box's row count.
function escapeBreaks(s: string): string {
  return s.replace(/\n/g, "\\n").replace(/\t/g, "\\t");
}

// JSON.stringify throws on cycles and BigInt.
function stringifyBounded(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s === undefined ? String(v) : s.length > ARGS_MAX_CHARS * 4 ? s.slice(0, ARGS_MAX_CHARS * 4) : s;
  } catch {
    return String(v);
  }
}

function findPrevLLM(currentId: number, steps: Step[]): LLMStep | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (s.type === "llm" && s.id < currentId) return s;
  }
  return null;
}
