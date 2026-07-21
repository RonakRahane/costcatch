// Draws the live box frame by frame, and the closed boxes of steps flushed to scrollback.
import chalk from "chalk";
import type { LLMStep } from "../types/trace.js";
import type { FailedToolCall } from "../core/trace-builder.js";
import {
  palette,
  glyph,
  c,
  dim,
  faint,
  spinnerFrame,
  stepNumber,
  termWidth,
  terminalSize,
  formatDuration as fmtDuration,
  truncate,
  wordmark,
  frameTop,
  frameBottom,
  frameLine,
  matrixReveal,
  visibleLength,
  truncateAnsi,
} from "../ui/theme.js";
import { formatCost, roundUsd } from "../core/cost-calculator.js";
import {
  cachedNote,
  reasoningNote,
  isFailedCall,
  callErrorRow,
  toolCallRows,
  countFailures,
  outputProblemRow,
  formatArgs,
  oneLine,
  callBadge,
  tokenTotals,
} from "./tree.js";
import { isRejectedCall, isUnpricedCall, outputProblem, tokenGaps } from "../core/step-checks.js";

// Rows left free above a full-height box for the program's own output.
export const OUTPUT_ROWS = 3;

let fillWindow = true;

// Only fill the window when we can follow resizes. Otherwise use half of it, so shrinking the
// window can't leave the box taller than the screen.
export function setLiveBoxFill(fill: boolean): void {
  fillWindow = fill;
}

// The 2 is the line under the box plus a spare line. The box can't redraw a row that has scrolled off the top.
export function liveBoxCapacity(): number {
  const rows = terminalSize().rows;
  return Math.max(MIN_FRAME_ROWS, fillWindow ? rows - 2 - OUTPUT_ROWS : Math.floor((rows - 2) / 2));
}

// An empty box has two borders, the header, two blank rows and the footer.
export const MIN_FRAME_ROWS = 6;

export function frameRows(frame: string): number {
  return frame.split("\n").length;
}

// Frees a quarter of the capacity, and at least four rows, so the box has room to grow again.
export function stepsToFlush(state: LiveState, rows: number, capacity: number): number {
  if (rows <= capacity) return 0;
  const target = capacity - Math.max(4, Math.floor(capacity / 4));
  // The first flush adds the "earlier steps" row.
  if (state.flushed === 0) rows += 1;
  let n = 0;
  for (const step of state.completed.slice(state.flushed)) {
    if (rows <= target) break;
    rows -= completedRowCount(step);
    n++;
  }
  return n;
}

// Keep this in step with renderCompleted, or the flush math miscounts the box.
export function completedRowCount(step: LLMStep): number {
  let rows = 1 + step.toolCalls.length;
  if (step.error) rows++;
  for (const tc of step.toolCalls) if (tc.error) rows++;
  if (outputProblem(step)) rows++;
  return rows;
}

export interface InflightCall {
  id: number;
  model: string | null;
  provider: string;
  startMs: number;
}

export interface LiveState {
  script: string;
  runtime: string;
  completed: LLMStep[];
  inflight: InflightCall[];
  startedAtMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  // True when some step is priced, or every step was rejected and so cost nothing.
  costKnown: boolean;
  // Some step is unpriced, so the total is a minimum and is shown with ≥.
  hasUnknownCost: boolean;
  showCost: boolean;
  // How many of the first steps are already in scrollback. The totals still count them.
  flushed: number;
}

const topBorder = frameTop;
const bottomBorder = frameBottom;
const bodyLine = frameLine;

const MODEL_MIN_W = 8;

// The widest string formatDuration returns, like "100.0h".
const DURATION_W = 6;

const NO_STEP = "··";

export interface StepColumns {
  num: number;
  // 0 when even a shortened name doesn't fit.
  model: number;
  // Widths of the printed counts, like "4,081". 0 when no row has tokens.
  tokIn: number;
  tokOut: number;
  cost: number;
}

function hasTokens(step: LLMStep): boolean {
  return !isFailedCall(step) && step.inputTokens !== null && step.outputTokens !== null;
}

function tokensWidth(cols: StepColumns): number {
  return cols.tokIn > 0 ? cols.tokIn + " tok in → ".length + cols.tokOut + " tok out".length : "tokens ?".length;
}

export function stepColumns(steps: LLMStep[], inflight: InflightCall[], width: number, showCost: boolean): StepColumns {
  const priced = steps.filter((s) => !isFailedCall(s));
  const counted = steps.filter(hasTokens);
  const cols: StepColumns = {
    num: Math.max(NO_STEP.length, ...steps.map((s) => stepNumber(s.id).length)),
    model: 0,
    tokIn: Math.max(0, ...counted.map((s) => s.inputTokens!.toLocaleString().length)),
    tokOut: Math.max(0, ...counted.map((s) => s.outputTokens!.toLocaleString().length)),
    cost: showCost ? Math.max(0, ...priced.map((s) => formatCost(s.costUsd).length)) : 0,
  };
  const names = [...steps.map((s) => s.model), ...inflight.map(inflightName)];
  const longest = Math.max(0, ...names.map((n) => visibleLength(n)));
  // Everything on the row except the model name, laid out the same way as in the final tree.
  const fixed = 4 + 2 + cols.num + 1 + DURATION_W + 2 + tokensWidth(cols) + (cols.cost > 0 ? 2 + cols.cost : 0);
  const room = width - fixed - 2;
  cols.model = longest <= room ? longest : room >= MODEL_MIN_W ? room : 0;
  return cols;
}

function inflightName(call: InflightCall): string {
  // The name comes from the request body, and a line break in it would split the row.
  return oneLine(call.model || call.provider || "llm");
}

// Use this before coloring, because escape codes would be counted as columns.
function cell(s: string, w: number): string {
  const cut = truncate(s, w);
  return cut + " ".repeat(Math.max(0, w - visibleLength(cut)));
}

function renderCompleted(step: LLMStep, width: number, cols: StepColumns): string[] {
  const lines: string[] = [];
  const num = c("accent", cell(stepNumber(step.id), cols.num));
  const model = cols.model > 0 ? chalk.hex(palette.text).bold(cell(step.model, cols.model)) + "  " : "";
  const durtxt = dim(fmtDuration(step.durationMs).padStart(DURATION_W));

  const tok = hasTokens(step)
    ? `${c("token", step.inputTokens!.toLocaleString().padStart(cols.tokIn))} ${dim("tok in")} ${faint(glyph.arrow)} ` +
      `${c("token", step.outputTokens!.toLocaleString().padStart(cols.tokOut))} ${dim("tok out")}`
    : dim(cell("tokens ?", tokensWidth(cols)));

  if (isFailedCall(step)) {
    lines.push(bodyLine(`${c("err", glyph.err)} ${num} ${model}${durtxt}  ${c("err", `HTTP ${step.statusCode ?? "?"}`)}`, width));
  } else {
    const cost = cols.cost > 0 ? "  " + c("cost", formatCost(step.costUsd).padStart(cols.cost)) : "";
    let head = `${callBadge(step)} ${num} ${model}${durtxt}  ${tok}${cost}`;
    for (const badge of [reasoningNote(step), cachedNote(step)]) {
      if (visibleLength(head) + visibleLength(badge) <= width - 4) head += badge;
    }
    lines.push(bodyLine(head, width));
  }

  const why = callErrorRow(step);
  if (why) lines.push(bodyLine(why, width));
  for (const row of toolCallRows(step)) lines.push(bodyLine(row, width));
  const problem = outputProblemRow(step);
  if (problem) lines.push(bodyLine(problem, width));

  return lines;
}

// Reasoning models can take minutes, so no call counts as stalled before this.
export const STALL_FLOOR_MS = 10 * 60_000;

const STALL_MULTIPLIER = 3;

export function stallThresholdMs(completed: LLMStep[]): number {
  const done = completed.filter((s) => !s.error).map((s) => s.durationMs);
  if (done.length === 0) return STALL_FLOOR_MS;
  const sorted = [...done].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return Math.max(STALL_FLOOR_MS, median * STALL_MULTIPLIER);
}

function renderInflight(
  call: InflightCall,
  tick: number,
  nowMs: number,
  width: number,
  stallMs: number,
  cols: StepColumns,
): string {
  const elapsedMs = nowMs - call.startMs;
  const stalled = elapsedMs >= stallMs;
  const mark = stalled ? c("warn", glyph.warn) : c("accent2", spinnerFrame(tick));
  // With no model column, the name uses the space the tokens and cost will take once the call finishes.
  const modelW = cols.model > 0 ? cols.model : Math.min(36, Math.max(MODEL_MIN_W, width - 4 - 2 - cols.num - 1 - DURATION_W - 2 - 14 - 2));
  const model = chalk.hex(palette.text)(cell(inflightName(call), modelW));
  const clock = fmtDuration(elapsedMs).padStart(DURATION_W);
  const elapsed = stalled ? c("warn", clock) : c("accent", clock);
  const dots = ".".repeat(1 + (tick % 3));
  const note = stalled ? c("warn", "no response yet") : dim("thinking" + dots);
  return bodyLine(`${mark} ${dim(cell(NO_STEP, cols.num))} ${model}  ${elapsed}  ${note}`, width);
}

function earlierStepsRow(steps: LLMStep[], showCost: boolean, width: number): string {
  let inTok = 0;
  let outTok = 0;
  let cost = 0;
  let priced = false;
  let unpriced = false;
  let allRejected = true;
  for (const s of steps) {
    inTok += s.inputTokens ?? 0;
    outTok += s.outputTokens ?? 0;
    if (s.costUsd !== null) {
      cost = roundUsd(cost + s.costUsd);
      priced = true;
    } else if (isUnpricedCall(s)) {
      unpriced = true;
    }
    if (!isRejectedCall(s)) allRejected = false;
  }
  const parts = [
    `${c("accent", steps.length.toLocaleString())} ${dim(steps.length === 1 ? "earlier step" : "earlier steps")}`,
    tokenTotals(inTok, outTok, tokenGaps(steps)),
  ];
  // If every step was rejected the cost is $0.00, not unknown.
  if (showCost) parts.push(priced || allRejected ? c("cost", `${unpriced ? "≥" : ""}${formatCost(cost)}`) : dim("$…"));
  const failures = countFailures(steps);
  const errors = failures.calls + failures.tools;
  if (errors > 0) parts.push(c("err", `${errors} ${errors === 1 ? "error" : "errors"}`));
  return bodyLine(`${dim(glyph.above)} ${parts.join(dim(" · "))}`, width);
}

export function renderLiveFrame(state: LiveState, tick: number, nowMs: number): string {
  const width = termWidth();

  const totalCalls = state.completed.length + state.inflight.length;
  const elapsed = fmtDuration(nowMs - state.startedAtMs);

  let costStr = "";
  if (state.showCost) {
    if (state.costKnown && state.totalCostUsd > 0) {
      costStr = state.hasUnknownCost
        ? c("cost", `≥${formatCost(state.totalCostUsd)}`)
        : c("cost", formatCost(state.totalCostUsd));
    } else if (!state.costKnown && state.totalCostUsd === 0) {
      costStr = dim("$…");
    } else {
      costStr = c("cost", formatCost(state.totalCostUsd));
    }
  }

  const wm = matrixReveal("costcatch", tick);
  const headerLeft = `${c("accent", glyph.bolt)} ${wm}`;
  const headerRight = `${c("accent", elapsed)}${state.showCost ? "  " + costStr : ""}`;

  const lines: string[] = [];
  lines.push(topBorder(headerLeft, headerRight, width));
  lines.push(bodyLine("", width));

  if (state.flushed > 0) lines.push(earlierStepsRow(state.completed.slice(0, state.flushed), state.showCost, width));

  // No row limit here, because the controller flushes old steps before the box outgrows the screen.
  const shown = state.completed.slice(state.flushed);
  const cols = stepColumns(shown, state.inflight, width, state.showCost);
  for (const step of shown) {
    lines.push(...renderCompleted(step, width, cols));
  }

  const stallMs = stallThresholdMs(state.completed);
  for (const call of state.inflight) {
    lines.push(renderInflight(call, tick, nowMs, width, stallMs, cols));
  }

  if (totalCalls === 0) {
    lines.push(bodyLine(dim(`  ${spinnerFrame(tick)} waiting for the first LLM call…`), width));
  }

  lines.push(bodyLine("", width));

  const parts = [
    `${c("accent", String(totalCalls))} ${dim(totalCalls === 1 ? "call" : "calls")}`,
    tokenTotals(state.totalInputTokens, state.totalOutputTokens, tokenGaps(state.completed)),
  ];
  if (state.showCost) {
    if (state.costKnown && state.hasUnknownCost) {
      parts.push(c("cost", `≥${formatCost(state.totalCostUsd)}`));
    } else if (state.costKnown) {
      parts.push(c("cost", formatCost(state.totalCostUsd)));
    } else {
      parts.push(dim("$…"));
    }
  }
  // Errors go last, so a narrow terminal clips them before the totals.
  const failures = countFailures(state.completed);
  const errors = failures.calls + failures.tools;
  if (errors > 0) parts.push(c("err", `${errors} ${errors === 1 ? "error" : "errors"}`));
  lines.push(bottomBorder(parts.join(dim(" · ")), width));

  return lines.join("\n");
}

// Tool failures found after their step was flushed. The text ends with a newline for writePassthrough.
export function renderLateFailures(failures: FailedToolCall[]): string {
  const width = termWidth();
  return failures
    .map(({ step, call }) => {
      const message = oneLine(call.error?.message ?? "") || "(no message)";
      const line =
        `  ${c("err", glyph.err)} ${dim(`step ${step.id} ·`)} ${c("err", oneLine(call.name))}` +
        `${faint("(")}${dim(formatArgs(call.input))}${faint(")")} ${c("err", "failed:")} ${dim(message)}`;
      return visibleLength(line) > width ? truncateAnsi(line, width - 1) + "…" : line;
    })
    .map((line) => `${line}\n`)
    .join("");
}

// A closed box of steps for scrollback. It ends with a newline so a runner that labels lines labels every row.
export function renderFlushedSteps(steps: LLMStep[], showCost: boolean): string {
  const width = termWidth();
  // Steps are numbered by start time, so parallel calls can leave gaps or come out of order.
  const ids = steps.map((s) => s.id).sort((a, b) => a - b);
  const contiguous = ids[ids.length - 1] - ids[0] === ids.length - 1;
  const range =
    ids.length === 1
      ? `step ${ids[0]}`
      : contiguous
        ? `steps ${ids[0]}–${ids[ids.length - 1]}`
        : `steps ${ids.length > 4 ? `${ids.slice(0, 3).join(", ")}, …` : ids.join(", ")}`;
  const cols = stepColumns(steps, [], width, showCost);
  const lines = [
    topBorder(`${c("accent", glyph.bolt)} ${wordmark()}`, dim(range), width),
    bodyLine("", width),
    ...steps.flatMap((step) => renderCompleted(step, width, cols)),
    bodyLine("", width),
    bottomBorder(dim("continued below"), width),
  ];
  return lines.join("\n") + "\n";
}
