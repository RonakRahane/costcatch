/**
 * Live-tree renderer — pure `state → frame string`.
 *
 * Produces one snapshot of the pinned live box: an animated header, the last few
 * completed step rows, the in-flight calls (spinner + ticking timer), and a live
 * totals footer. Called ~12×/second by the live controller. No side effects.
 */

import chalk from "chalk";
import type { LLMStep } from "../types/trace.js";
import {
  palette,
  glyph,
  c,
  dim,
  faint,
  spinnerFrame,
  stepNumber,
  termWidth,
  truncate,
  gradient,
  frameTop,
  frameBottom,
  frameLine,
} from "../ui/theme.js";
import { matrixReveal } from "../ui/matrix-banner.js";
import { formatCost } from "../core/cost-calculator.js";

/** A call that has started but not yet completed. */
export interface InflightCall {
  id: number;
  model: string | null;
  provider: string;
  startMs: number;
}

/** Everything the live view needs, mutated by the controller each poll. */
export interface LiveState {
  script: string;
  runtime: string;
  completed: LLMStep[];
  inflight: InflightCall[];
  startedAtMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  costKnown: boolean;
  showCost: boolean;
}

/** How many completed rows to keep in the pinned box (older ones scrolled off). */
const MAX_VISIBLE_STEPS = 6;

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

// Frame helpers (frameTop / frameBottom / frameLine) live in ui/theme.ts so the
// live view and the final static tree share one visual language. Local aliases:
const topBorder = frameTop;
const bottomBorder = frameBottom;
const bodyLine = frameLine;

/** Render one completed LLM step (+ its tool-call sublines). */
function renderCompleted(step: LLMStep, width: number, showCost: boolean): string[] {
  const lines: string[] = [];
  const num = c("accent", stepNumber(step.id));
  const model = chalk.hex(palette.text).bold(truncate(step.model, 22));
  const durtxt = dim(fmtDuration(step.durationMs).padStart(6));

  const tok =
    step.inputTokens !== null && step.outputTokens !== null
      ? `${c("token", step.inputTokens.toLocaleString())} ${faint(glyph.arrow)} ${c("token", step.outputTokens.toLocaleString())} ${dim("tok")}`
      : dim("tokens ?");

  const cost = showCost ? "  " + c("cost", formatCost(step.costUsd)) : "";
  const badge = c("ok", glyph.ok);

  lines.push(bodyLine(`${badge} ${num} ${model}  ${durtxt}  ${tok}${cost}`, width));

  // Tool calls as dim connectors
  for (let i = 0; i < step.toolCalls.length; i++) {
    const tc = step.toolCalls[i];
    const conn = i === step.toolCalls.length - 1 ? glyph.leaf : glyph.branch;
    const arg = firstArg(tc.input);
    lines.push(
      bodyLine(`   ${faint(conn)} ${c("warn", glyph.bolt)} ${c("warn", tc.name)}${faint("(")}${dim(arg)}${faint(")")}`, width),
    );
  }

  // Final-answer marker when there were no tool calls
  if (step.toolCalls.length === 0 && step.finishReason && step.finishReason !== "unknown") {
    lines.push(bodyLine(`   ${faint(glyph.leaf)} ${c("ok", glyph.ok)} ${dim(`${step.finishReason} — final answer`)}`, width));
  }

  return lines;
}

function firstArg(input: Record<string, unknown>): string {
  const entries = Object.entries(input);
  if (entries.length === 0) return "";
  const v = entries[0][1];
  return typeof v === "string" ? `"${truncate(v, 30)}"` : truncate(JSON.stringify(v), 30);
}

/** Render one in-flight call with spinner + live elapsed. */
function renderInflight(call: InflightCall, tick: number, nowMs: number, width: number): string {
  const spin = c("accent2", spinnerFrame(tick));
  const model = chalk.hex(palette.text)(truncate(call.model || call.provider || "llm", 22));
  const elapsed = c("accent", fmtDuration(nowMs - call.startMs).padStart(6));
  const dots = ".".repeat(1 + (tick % 3));
  return bodyLine(`${spin} ${dim("··")} ${model}  ${elapsed}  ${dim("thinking" + dots)}`, width);
}

/**
 * Render the full live frame.
 */
export function renderLiveFrame(state: LiveState, tick: number, nowMs: number): string {
  const width = termWidth();

  const totalCalls = state.completed.length + state.inflight.length;
  const elapsed = fmtDuration(nowMs - state.startedAtMs);
  const costStr = state.showCost
    ? state.costKnown
      ? c("cost", formatCost(state.totalCostUsd))
      : dim("$…")
    : "";

  // ── Header ──
  const wm = matrixReveal("costcatch", tick);
  const headerLeft = `${c("accent", glyph.bolt)} ${wm}`;
  const headerRight = `${dim(glyph.clock)} ${c("accent", elapsed)}${state.showCost ? "  " + costStr : ""}`;

  const lines: string[] = [];
  lines.push(topBorder(headerLeft, headerRight, width));
  lines.push(bodyLine("", width));

  // ── Completed steps (last K) ──
  const shown = state.completed.slice(-MAX_VISIBLE_STEPS);
  const hidden = state.completed.length - shown.length;
  if (hidden > 0) {
    lines.push(bodyLine(faint(`  ⋮ ${hidden} earlier ${hidden === 1 ? "step" : "steps"} above`), width));
  }
  for (const step of shown) {
    lines.push(...renderCompleted(step, width, state.showCost));
  }

  // ── In-flight ──
  for (const call of state.inflight) {
    lines.push(renderInflight(call, tick, nowMs, width));
  }

  if (totalCalls === 0) {
    lines.push(bodyLine(dim(`  ${spinnerFrame(tick)} waiting for the first LLM call…`), width));
  }

  lines.push(bodyLine("", width));

  // ── Footer totals ──
  const parts = [
    `${c("accent", String(totalCalls))} ${dim(totalCalls === 1 ? "call" : "calls")}`,
    `${c("token", compact(state.totalInputTokens))}${faint(glyph.arrow)}${c("token", compact(state.totalOutputTokens))} ${dim("tok")}`,
  ];
  if (state.showCost) parts.push(state.costKnown ? c("cost", formatCost(state.totalCostUsd)) : dim("$…"));
  lines.push(bottomBorder(parts.join(dim(" · ")), width));

  return lines.join("\n");
}

/** A tiny standalone "starting" frame shown before the first poll. */
export function renderBootFrame(tick: number): string {
  const width = termWidth();
  const wm = matrixReveal("costcatch", tick);
  const lines = [
    topBorder(`${c("accent", glyph.bolt)} ${wm}`, dim("starting…"), width),
    bodyLine(dim(`  ${spinnerFrame(tick)} launching your program…`), width),
    bottomBorder(gradient("zero-instrumentation trace"), width),
  ];
  return lines.join("\n");
}
