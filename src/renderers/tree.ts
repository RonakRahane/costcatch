/**
 * Tree renderer — the final, static trace box.
 *
 * Printed exactly once when a run finishes (and by `replay`). Shares the rounded
 * frame + palette with the live view (src/renderers/live-tree.ts) so the moment
 * the live region collapses, it reads as the same object at rest.
 */

import chalk from "chalk";
import type { Trace, LLMStep, ToolStep, Step, TraceWarning } from "../types/trace.js";
import { formatCost, formatProjection } from "../core/cost-calculator.js";
import {
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
} from "../ui/theme.js";
import { wordmark } from "../ui/matrix-banner.js";

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/**
 * Render a trace as the refined static box.
 */
export function renderTree(trace: Trace, showCost: boolean = true, useColor: boolean = true): string {
  if (!useColor) return renderPlainTree(trace, showCost);

  const width = termWidth();
  const lines: string[] = [];

  // ── Header ──
  const meta = `${dim(glyph.clock)} ${c("accent", fmtDuration(trace.durationMs))}${
    showCost ? "  " + c("cost", formatCost(trace.totalCostUsd)) : ""
  }`;
  lines.push("");
  lines.push(frameTop(wordmark(), meta, width));
  lines.push(frameLine("", width));

  // ── Steps ──
  for (const step of trace.steps) {
    const rows = step.type === "llm" ? renderLLM(step, trace.steps, showCost) : renderTool(step);
    for (const r of rows) lines.push(frameLine(r, width));
    lines.push(frameLine("", width));
  }

  // ── Summary ──
  lines.push(frameLine(faint("── ") + dim("summary"), width));
  const s = trace.summary;
  lines.push(
    frameLine(
      `${c("accent", String(s.llmCalls))} ${dim(s.llmCalls === 1 ? "LLM call" : "LLM calls")}` +
        dim("  ·  ") +
        `${c("accent", String(s.toolCalls))} ${dim("tool calls")}` +
        dim("  ·  ") +
        `${c("accent", fmtDuration(trace.durationMs))}` +
        (showCost ? dim("  ·  ") + c("cost", formatCost(trace.totalCostUsd)) : ""),
      width,
    ),
  );
  if (s.totalInputTokens > 0 || s.totalOutputTokens > 0) {
    let tokLine =
      `${c("token", compact(s.totalInputTokens))} ${faint(glyph.arrow)} ${c("token", compact(s.totalOutputTokens))} ${dim("tok")}`;
    if (showCost && trace.totalCostUsd !== null) {
      tokLine += dim("  ·  ") + dim(formatProjection(trace.totalCostUsd, 100).replace("/month", "/mo"));
    }
    lines.push(frameLine(tokLine, width));
  }

  // ── Warnings ──
  if (trace.warnings.length > 0) {
    lines.push(frameLine("", width));
    lines.push(frameLine(faint("── ") + c("warn", "warnings"), width));
    for (const w of trace.warnings) {
      lines.push(frameLine(renderWarning(w), width));
    }
  }

  // ── Footer ──
  const saved = trace.runId ? dim(trace.runId) : gradient("zero-instrumentation trace");
  lines.push(frameBottom(saved, width));
  lines.push("");

  return lines.join("\n");
}

/** Render one LLM step and its sublines (returns unframed content rows). */
function renderLLM(step: LLMStep, allSteps: Step[], showCost: boolean): string[] {
  const rows: string[] = [];
  const num = c("accent", stepNumber(step.id));
  const model = chalk.hex(palette.text).bold(truncate(step.model, 22));
  const dur = dim(fmtDuration(step.durationMs).padStart(6));
  const isError = !!step.error || (step.statusCode !== undefined && (step.statusCode < 200 || step.statusCode >= 300));

  const tok =
    step.inputTokens !== null && step.outputTokens !== null
      ? `${c("token", step.inputTokens.toLocaleString())} ${faint(glyph.arrow)} ${c("token", step.outputTokens.toLocaleString())} ${dim("tok")}`
      : dim("tokens ?");
  const cost = showCost && !isError ? "  " + c("cost", formatCost(step.costUsd)) : "";

  // Status badge: red ✗ for errors, green ✓ otherwise.
  const badge = isError ? c("err", glyph.err) : c("ok", glyph.ok);
  const head = isError
    ? `${badge} ${num} ${model}  ${dur}  ${c("err", `HTTP ${step.statusCode ?? "?"}`)}`
    : `${badge} ${num} ${model}  ${dur}  ${tok}${cost}`;
  rows.push(head);

  // Error detail line
  if (isError && step.error) {
    const kind = step.error.type ? c("err", `${step.error.type} `) : "";
    rows.push(`   ${faint(glyph.leaf)} ${kind}${dim(truncate(step.error.message, 58))}`);
  }

  // Retry marker
  if (step.retryOf != null) {
    rows.push(`   ${c("warn", glyph.arrow + glyph.arrow)} ${c("warn", `retry of step ${step.retryOf}`)}`);
  }

  if (step.cachedTokens !== null && step.cachedTokens > 0) {
    rows.push(`   ${faint(glyph.branch)} ${c("ok", glyph.cache)} ${c("ok", `${step.cachedTokens.toLocaleString()} cached tokens`)}`);
  }

  for (let i = 0; i < step.toolCalls.length; i++) {
    const tc = step.toolCalls[i];
    const conn = i === step.toolCalls.length - 1 ? glyph.leaf : glyph.branch;
    rows.push(`   ${faint(conn)} ${c("warn", glyph.bolt)} ${c("warn", tc.name)}${faint("(")}${dim(firstArg(tc.input))}${faint(")")}`);
  }

  if (step.toolCalls.length === 0 && step.finishReason && step.finishReason !== "unknown") {
    rows.push(`   ${faint(glyph.leaf)} ${c("ok", glyph.ok)} ${dim(`${step.finishReason} — final answer`)}`);
  }

  // Inline context-growth note
  const prev = findPrevLLM(step.id, allSteps);
  if (prev && step.inputTokens !== null && prev.inputTokens !== null && prev.inputTokens > 0) {
    const growth = step.inputTokens / prev.inputTokens;
    if (growth >= 3) {
      rows.push(`   ${c("warn", glyph.warn)} ${c("warn", `context grew ${growth.toFixed(1)}× (${prev.inputTokens.toLocaleString()} → ${step.inputTokens.toLocaleString()} tok)`)}`);
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
  const msg = role === "dim" ? dim(w.message) : c(role as "err" | "warn", w.message);
  return `${bullet} ${msg}`;
}

/** Plain, color-free fallback for CI / --no-color. */
function renderPlainTree(trace: Trace, showCost: boolean): string {
  const lines: string[] = [];
  const cost = formatCost(trace.totalCostUsd);
  const dur = fmtDuration(trace.durationMs);

  lines.push("");
  lines.push(`costcatch — ${dur} · ${cost}`);
  lines.push("");

  for (const step of trace.steps) {
    if (step.type === "llm") {
      const tok = step.inputTokens !== null ? `${step.inputTokens} -> ${step.outputTokens} tok` : "tokens ?";
      lines.push(`  ${step.id}. LLM  ${step.model.padEnd(22)} ${fmtDuration(step.durationMs)}  ${tok}  ${showCost ? formatCost(step.costUsd) : ""}`);
      for (const tc of step.toolCalls) lines.push(`       - ${tc.name}(${firstArg(tc.input)})`);
    } else {
      lines.push(`  ${step.id}. TOOL ${step.name.padEnd(22)} ${fmtDuration(step.durationMs)}`);
    }
  }

  lines.push("");
  lines.push(`  ${trace.summary.llmCalls} LLM calls · ${trace.summary.toolCalls} tool calls · ${dur} · ${cost}`);
  if (trace.warnings.length > 0) {
    lines.push("  warnings:");
    for (const w of trace.warnings) lines.push(`    - [${w.severity}] ${w.message}`);
  }
  lines.push("");

  return lines.join("\n");
}

function firstArg(input: Record<string, unknown>): string {
  const entries = Object.entries(input);
  if (entries.length === 0) return "";
  const v = entries[0][1];
  return typeof v === "string" ? `"${truncate(v, 30)}"` : truncate(JSON.stringify(v), 30);
}

function findPrevLLM(currentId: number, steps: Step[]): LLMStep | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (s.type === "llm" && s.id < currentId) return s;
  }
  return null;
}
