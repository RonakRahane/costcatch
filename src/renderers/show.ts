/**
 * Show renderer — full conversation view for a single step or the entire trace.
 *
 * This is the highest-value feature: it answers "why did my agent do that?" by
 * rendering the actual system prompt, input messages, model output, errors, and
 * retry status for each step. Without this, costcatch only tells you *what*
 * happened; with it, you can read *why*.
 *
 * Backward-compatible: old traces saved before content capture will show a
 * "no content captured — re-run to inspect" note instead of crashing.
 */

import chalk from "chalk";
import type { Trace, LLMStep } from "../types/trace.js";
import {
  palette,
  glyph,
  c,
  dim,
  faint,
  cb,
  stepNumber,
  termWidth,
  truncate,
  frameTop,
  frameBottom,
  frameLine,
  wordmark,
} from "../ui/theme.js";
import { formatCost } from "../core/cost-calculator.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ShowOptions {
  /** Show only this step (1-indexed). null = show all. */
  step?: number | null;
  /** Search for a string across all steps and highlight matches. */
  grep?: string | null;
  /** Use ANSI colors. */
  useColor?: boolean;
}

/**
 * Render the full conversation view.
 */
export function renderShow(trace: Trace, opts: ShowOptions = {}): string {
  const useColor = opts.useColor !== false;
  if (!useColor) return renderShowPlain(trace, opts);

  const width = termWidth();
  const lines: string[] = [];

  // Header
  lines.push("");
  const meta = `${dim(glyph.clock)} ${c("accent", fmtDuration(trace.durationMs))}  ${c("cost", formatCost(trace.totalCostUsd))}`;
  lines.push(frameTop(wordmark(), meta, width));
  lines.push(frameLine(dim(`show: ${trace.script} (${trace.summary.llmCalls} LLM calls)`), width));
  lines.push(frameLine("", width));

  // Select steps
  const llmSteps = trace.steps.filter((s): s is LLMStep => s.type === "llm");

  if (opts.step != null) {
    const step = llmSteps.find((s) => s.id === opts.step);
    if (!step) {
      lines.push(frameLine(c("err", `Step ${opts.step} not found (${llmSteps.length} LLM steps in trace)`), width));
    } else {
      lines.push(...renderStepContent(step, width, opts.grep ?? null));
    }
  } else if (opts.grep) {
    // Grep mode: show only steps that match the search term
    let matches = 0;
    for (const step of llmSteps) {
      if (stepMatchesGrep(step, opts.grep)) {
        lines.push(...renderStepContent(step, width, opts.grep));
        lines.push(frameLine("", width));
        matches++;
      }
    }
    if (matches === 0) {
      lines.push(frameLine(c("warn", `No steps match "${opts.grep}"`), width));
    } else {
      lines.push(frameLine(dim(`${matches} step${matches === 1 ? "" : "s"} match "${opts.grep}"`), width));
    }
  } else {
    // Show all steps
    for (const step of llmSteps) {
      lines.push(...renderStepContent(step, width, null));
      lines.push(frameLine("", width));
    }
  }

  lines.push(frameBottom(dim(trace.runId), width));
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Step content rendering
// ---------------------------------------------------------------------------

function renderStepContent(step: LLMStep, width: number, grep: string | null): string[] {
  const rows: string[] = [];
  const inner = width - 4;

  // Step header
  const num = c("accent", stepNumber(step.id));
  const model = chalk.hex(palette.text).bold(truncate(step.model, 22));
  const dur = dim(fmtDuration(step.durationMs));
  const tok =
    step.inputTokens !== null && step.outputTokens !== null
      ? `${c("token", step.inputTokens.toLocaleString())} ${faint(glyph.arrow)} ${c("token", step.outputTokens.toLocaleString())} ${dim("tok")}`
      : dim("tokens ?");
  const cost = c("cost", formatCost(step.costUsd));

  const isError = !!step.error || (step.statusCode !== undefined && (step.statusCode < 200 || step.statusCode >= 300));
  const badge = isError ? c("err", glyph.err) : c("ok", glyph.ok);

  rows.push(frameLine(faint("── ") + `${badge} ${num} ${model}  ${dur}  ${tok}  ${cost}`, width));

  // Error
  if (isError && step.error) {
    const typeStr = step.error.type ? c("err", step.error.type) + " " : "";
    const statusStr = c("err", `HTTP ${step.statusCode ?? "?"}`);
    rows.push(frameLine(
      `  ${c("err", glyph.bullet)} ${statusStr} ${typeStr}${dim(step.error.message)}`,
      width,
    ));
  }

  // Retry
  if (step.retryOf != null) {
    rows.push(frameLine(`  ${c("warn", glyph.arrow + glyph.arrow)} ${c("warn", `retry of step ${step.retryOf}`)}`, width));
  }

  // ── Content ──
  if (!step.content) {
    rows.push(frameLine(dim("  no content captured — re-run with the latest costcatch to inspect"), width));
    return rows;
  }

  const content = step.content;

  // System prompt
  if (content.system) {
    rows.push(frameLine("", width));
    rows.push(frameLine(cb("accent2", "SYSTEM"), width));
    // Wrap BEFORE highlighting so we measure plain-text width correctly
    for (const line of wrapText(content.system, inner - 2)) {
      rows.push(frameLine(`  ${highlightLine(line, grep)}`, width));
    }
  }

  // Messages
  if (content.messages.length > 0) {
    rows.push(frameLine("", width));
    for (const msg of content.messages) {
      const roleColor: "token" | "accent" | "warn" =
        msg.role === "user" ? "token" : msg.role === "assistant" ? "accent" : "warn";
      rows.push(frameLine(cb(roleColor, msg.role.toUpperCase()), width));
      for (const line of wrapText(msg.content, inner - 2)) {
        rows.push(frameLine(`  ${highlightLine(line, grep)}`, width));
      }
    }
  }

  // Model output
  if (content.output) {
    rows.push(frameLine("", width));
    rows.push(frameLine(cb("ok", "OUTPUT"), width));
    for (const line of wrapText(content.output, inner - 2)) {
      rows.push(frameLine(`  ${highlightLine(line, grep)}`, width));
    }
  }

  // Tool calls
  if (step.toolCalls.length > 0) {
    rows.push(frameLine("", width));
    rows.push(frameLine(cb("warn", "TOOL CALLS"), width));
    for (const tc of step.toolCalls) {
      const argStr = dim(JSON.stringify(tc.input).slice(0, Math.max(0, inner - 20)));
      rows.push(frameLine(`  ${c("warn", glyph.bolt)} ${c("warn", tc.name)}${faint("(")}${argStr}${faint(")")}`, width));
    }
  }

  // Truncation notice
  if (content.truncated) {
    rows.push(frameLine(dim(`  ${glyph.spark} some fields were truncated — full content exceeded capture limits`), width));
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Grep helpers
// ---------------------------------------------------------------------------

function stepMatchesGrep(step: LLMStep, grep: string): boolean {
  if (!step.content) return false;
  const lower = grep.toLowerCase();
  const sc = step.content;
  if (sc.system?.toLowerCase().includes(lower)) return true;
  if (sc.output?.toLowerCase().includes(lower)) return true;
  for (const msg of sc.messages) {
    if (msg.content.toLowerCase().includes(lower)) return true;
  }
  return false;
}

/** Apply grep highlighting to a single already-wrapped line. */
function highlightLine(text: string, grep: string | null): string {
  if (!grep) return text;
  const escaped = grep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(${escaped})`, "gi");
  return text.replace(re, (m) => chalk.bgYellow.black(m));
}

// ---------------------------------------------------------------------------
// Text wrapping — operates on plain text BEFORE ANSI coloring is applied
// ---------------------------------------------------------------------------

function wrapText(text: string, maxWidth: number): string[] {
  if (maxWidth <= 0) return [text];
  const rawLines = text.split("\n");
  const wrapped: string[] = [];
  for (const rawLine of rawLines) {
    if (rawLine.length <= maxWidth) {
      wrapped.push(rawLine);
    } else {
      // Hard-wrap long lines (content is plain text at this point)
      let pos = 0;
      while (pos < rawLine.length) {
        wrapped.push(rawLine.slice(pos, pos + maxWidth));
        pos += maxWidth;
      }
    }
  }
  return wrapped;
}

// ---------------------------------------------------------------------------
// Plain text fallback (CI / --no-color / piped output)
// ---------------------------------------------------------------------------

function renderShowPlain(trace: Trace, opts: ShowOptions): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`costcatch show: ${trace.script} (${trace.summary.llmCalls} LLM calls)`);
  lines.push("");

  const llmSteps = trace.steps.filter((s): s is LLMStep => s.type === "llm");
  const stepsToShow = opts.step != null
    ? llmSteps.filter((s) => s.id === opts.step)
    : opts.grep
      ? llmSteps.filter((s) => stepMatchesGrep(s, opts.grep!))
      : llmSteps;

  if (stepsToShow.length === 0) {
    lines.push(opts.step != null ? `  Step ${opts.step} not found.` : `  No steps match "${opts.grep}".`);
  }

  for (const step of stepsToShow) {
    const tok = step.inputTokens !== null ? `${step.inputTokens} -> ${step.outputTokens} tok` : "tokens ?";
    const isError = !!step.error;
    lines.push(`--- Step ${step.id}: ${step.model}  ${fmtDuration(step.durationMs)}  ${tok}  ${formatCost(step.costUsd)} ${isError ? `ERROR HTTP ${step.statusCode}` : ""}`);

    if (isError && step.error) {
      lines.push(`  ERROR: ${step.error.type ?? ""} ${step.error.message}`);
    }
    if (step.retryOf != null) {
      lines.push(`  RETRY of step ${step.retryOf}`);
    }

    if (!step.content) {
      lines.push("  (no content captured — re-run to inspect)");
      lines.push("");
      continue;
    }

    const content = step.content;
    if (content.system) {
      lines.push("  SYSTEM:");
      for (const line of content.system.split("\n").slice(0, 20)) {
        lines.push(`    ${line.slice(0, 200)}`);
      }
      if (content.system.split("\n").length > 20) lines.push("    ...(truncated)");
    }
    for (const msg of content.messages) {
      lines.push(`  ${msg.role.toUpperCase()}:`);
      for (const line of msg.content.split("\n").slice(0, 20)) {
        lines.push(`    ${line.slice(0, 200)}`);
      }
      if (msg.content.split("\n").length > 20) lines.push("    ...(truncated)");
    }
    if (content.output) {
      lines.push("  OUTPUT:");
      for (const line of content.output.split("\n").slice(0, 20)) {
        lines.push(`    ${line.slice(0, 200)}`);
      }
      if (content.output.split("\n").length > 20) lines.push("    ...(truncated)");
    }
    for (const tc of step.toolCalls) {
      lines.push(`  TOOL: ${tc.name}(${JSON.stringify(tc.input).slice(0, 200)})`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
