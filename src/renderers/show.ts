// Draws `costcatch show`, the full conversation for one step or a whole trace, with optional --grep highlighting.
import chalk from "chalk";
import type { Trace, LLMStep, ToolCall } from "../types/trace.js";
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
  plural,
  visibleLength,
  compact,
} from "../ui/theme.js";
import { formatTotalCost } from "../core/cost-calculator.js";
import { isFailedCall, outputProblem, describeOutputProblem, unpricedCallsOf } from "../core/step-checks.js";
import { callBadge, stepCost } from "./tree.js";
import { gapsAfter } from "../core/timing.js";

export interface ShowOptions {
  // 1-based step id. null shows every step.
  step?: number | null;
  grep?: string | null;
  useColor?: boolean;
}

export function renderShow(trace: Trace, opts: ShowOptions = {}): string {
  const useColor = opts.useColor !== false;
  if (!useColor) return renderShowPlain(trace, opts);

  const width = termWidth();
  const lines: string[] = [];

  lines.push("");
  const meta = `${c("accent", fmtDuration(trace.durationMs))}  ${c("cost", formatTotalCost(trace.totalCostUsd, unpricedCallsOf(trace)))}`;
  lines.push(frameTop(wordmark(), meta, width));
  lines.push(frameLine(dim(`show: ${trace.script} (${plural(trace.summary.llmCalls, "LLM call")})`), width));
  lines.push(frameLine("", width));

  const llmSteps = trace.steps.filter((s): s is LLMStep => s.type === "llm");
  const gaps = gapsAfter(trace.steps);

  if (opts.step != null) {
    const step = llmSteps.find((s) => s.id === opts.step);
    if (!step) {
      lines.push(frameLine(c("err", `Step ${opts.step} not found (${llmSteps.length} LLM steps in trace)`), width));
    } else {
      lines.push(...renderStepContent(step, width, opts.grep ?? null, gaps.get(step.id)));
    }
  } else if (opts.grep) {
    let matches = 0;
    for (const step of llmSteps) {
      if (stepMatchesGrep(step, opts.grep)) {
        lines.push(...renderStepContent(step, width, opts.grep, gaps.get(step.id)));
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
    for (const step of llmSteps) {
      lines.push(...renderStepContent(step, width, null, gaps.get(step.id)));
      lines.push(frameLine("", width));
    }
  }

  lines.push(frameBottom(dim(trace.runId), width));
  lines.push("");
  return lines.join("\n");
}

// gapMs is the time from this step's response to the next call, when no other step shares that gap.
function renderStepContent(step: LLMStep, width: number, grep: string | null, gapMs?: number): string[] {
  const rows: string[] = [];
  const inner = width - 4;

  const num = c("accent", stepNumber(step.id));
  const modelRoom =
    inner -
    3 - // "── "
    2 - // badge and a space
    stepNumber(step.id).length -
    1 -
    fmtDuration(step.durationMs).length -
    2 -
    ((step.inputTokens ?? 0).toLocaleString().length + (step.outputTokens ?? 0).toLocaleString().length + 18) -
    2 -
    stepCost(step).length -
    2; // gap after the name
  const modelW = Math.min(22, modelRoom);
  const model = modelW >= 8 ? chalk.hex(palette.text).bold(truncate(step.model, modelW)) + "  " : "";
  const dur = dim(fmtDuration(step.durationMs));
  const tok =
    step.inputTokens !== null && step.outputTokens !== null
      ? `${c("token", step.inputTokens.toLocaleString())} ${dim("tok in")} ${faint(glyph.arrow)} ${c("token", step.outputTokens.toLocaleString())} ${dim("tok out")}`
      : dim("tokens ?");
  const cost = c("cost", stepCost(step));

  const isError = isFailedCall(step);
  const badge = callBadge(step);

  rows.push(frameLine(faint("── ") + `${badge} ${num} ${model}${dur}  ${tok}  ${cost}`, width));

  if (isError && step.error) {
    const typeStr = step.error.type ? c("err", step.error.type) + " " : "";
    const statusStr = c("err", `HTTP ${step.statusCode ?? "?"}`);
    rows.push(frameLine(
      `  ${c("err", glyph.bullet)} ${statusStr} ${typeStr}${dim(step.error.message)}`,
      width,
    ));
  }

  if (step.retryOf != null) {
    rows.push(frameLine(`  ${c("warn", glyph.arrow + glyph.arrow)} ${c("warn", `retry of step ${step.retryOf}`)}`, width));
  }

  const problem = outputProblem(step);
  if (problem) {
    rows.push(frameLine(`  ${c("warn", glyph.warn)} ${c("warn", describeOutputProblem(problem, step.toolCalls.length > 0))}`, width));
  }
  if (gapMs !== undefined) {
    rows.push(frameLine(`  ${dim(`next LLM call ${fmtDuration(gapMs)} after this one ended (your code and tools)`)}`, width));
  }

  if (!step.content) {
    rows.push(frameLine(dim("  no content captured, re-run with the latest costcatch to inspect"), width));
    return rows;
  }

  const content = step.content;

  if (content.system) {
    rows.push(frameLine("", width));
    rows.push(frameLine(cb("accent2", "SYSTEM"), width));
    // Wrap before highlighting, or the color codes get counted as width.
    for (const line of wrapText(content.system, inner - 2)) {
      rows.push(frameLine(`  ${highlightLine(line, grep)}`, width));
    }
  }

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

  if (content.output) {
    rows.push(frameLine("", width));
    rows.push(frameLine(cb("ok", "OUTPUT"), width));
    for (const line of wrapText(content.output, inner - 2)) {
      rows.push(frameLine(`  ${highlightLine(line, grep)}`, width));
    }
  }

  if (step.toolCalls.length > 0) {
    rows.push(frameLine("", width));
    rows.push(frameLine(cb("warn", "TOOL CALLS"), width));
    for (const tc of step.toolCalls) {
      const argStr = dim(JSON.stringify(tc.input).slice(0, Math.max(0, inner - 20)));
      if (!tc.error) {
        rows.push(frameLine(`  ${c("warn", glyph.bolt)} ${c("warn", tc.name)}${faint("(")}${argStr}${faint(")")}`, width));
        const result = resultLine(tc);
        if (result) rows.push(frameLine(`    ${dim(result)}`, width));
        continue;
      }
      rows.push(frameLine(`  ${c("err", glyph.err)} ${c("err", tc.name)}${faint("(")}${argStr}${faint(")")}`, width));
      // Wrap the whole message instead of cutting it, since this view is for reading what the tree clips.
      const message = tc.error.message || "(no message)";
      wrapText(`failed: ${message}`, inner - 6).forEach((line, i) => {
        rows.push(frameLine(`    ${i === 0 ? c("err", line.slice(0, 7)) + dim(line.slice(7)) : dim(line)}`, width));
      });
    }
  }

  if (content.truncated) {
    rows.push(frameLine(dim(`  ${glyph.spark} some fields were truncated, full content exceeded capture limits`), width));
  }

  return rows;
}

function resultLine(tc: ToolCall): string | null {
  if (tc.result) {
    const r = tc.result;
    const atLeast = r.sendsPartial ? "at least " : "";
    const sends = `sent in ${atLeast}${r.sends} ${r.sends === 1 ? "request" : "requests"}`;
    return `result ~${compact(r.tokens)} tok (${r.chars.toLocaleString()} chars), ${sends}`;
  }
  return tc.unanswered ? "no result was sent back" : null;
}

function stepMatchesGrep(step: LLMStep, grep: string): boolean {
  const lower = grep.toLowerCase();

  // Search tool calls even when there's no content, because the tree shows their names.
  for (const tc of step.toolCalls) {
    if (tc.name.toLowerCase().includes(lower)) return true;
    if (tc.error?.message.toLowerCase().includes(lower)) return true;
    try {
      if (JSON.stringify(tc.input)?.toLowerCase().includes(lower)) return true;
    } catch {}
  }
  if (step.model.toLowerCase().includes(lower)) return true;

  if (!step.content) return false;
  const sc = step.content;
  if (sc.system?.toLowerCase().includes(lower)) return true;
  if (sc.output?.toLowerCase().includes(lower)) return true;
  for (const msg of sc.messages) {
    if (msg.content.toLowerCase().includes(lower)) return true;
  }
  return false;
}

function highlightLine(text: string, grep: string | null): string {
  if (!grep) return text;
  const escaped = grep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(${escaped})`, "gi");
  return text.replace(re, (m) => chalk.bgYellow.black(m));
}

function wrapText(text: string, maxWidth: number): string[] {
  if (maxWidth <= 0) return [text];
  const rawLines = text.split("\n");
  const wrapped: string[] = [];
  for (const rawLine of rawLines) {
    if (visibleLength(rawLine) <= maxWidth) {
      wrapped.push(rawLine);
      continue;
    }
    // Measure display width, not string length, or CJK text overflows the border.
    let current = "";
    let currentWidth = 0;
    for (const ch of rawLine) {
      const w = visibleLength(ch);
      if (currentWidth + w > maxWidth && current !== "") {
        wrapped.push(current);
        current = "";
        currentWidth = 0;
      }
      current += ch;
      currentWidth += w;
    }
    if (current !== "") wrapped.push(current);
  }
  return wrapped;
}

function renderShowPlain(trace: Trace, opts: ShowOptions): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`costcatch show: ${trace.script} (${plural(trace.summary.llmCalls, "LLM call")})`);
  lines.push("");

  const llmSteps = trace.steps.filter((s): s is LLMStep => s.type === "llm");
  const gaps = gapsAfter(trace.steps);
  const stepsToShow = opts.step != null
    ? llmSteps.filter((s) => s.id === opts.step)
    : opts.grep
      ? llmSteps.filter((s) => stepMatchesGrep(s, opts.grep!))
      : llmSteps;

  if (stepsToShow.length === 0) {
    lines.push(
      opts.step != null
        ? `  Step ${opts.step} not found.`
        : opts.grep
          ? `  No steps match "${opts.grep}".`
          : "  No LLM calls in this trace.",
    );
  }

  for (const step of stepsToShow) {
    const tok =
      step.inputTokens !== null ? `${step.inputTokens} tok in -> ${step.outputTokens ?? "?"} tok out` : "tokens ?";
    const isError = !!step.error;
    lines.push(`--- Step ${step.id}: ${step.model}  ${fmtDuration(step.durationMs)}  ${tok}  ${stepCost(step)} ${isError ? `ERROR HTTP ${step.statusCode}` : ""}`);

    if (isError && step.error) {
      lines.push(`  ERROR: ${step.error.type ?? ""} ${step.error.message}`);
    }
    if (step.retryOf != null) {
      lines.push(`  RETRY of step ${step.retryOf}`);
    }
    const problem = outputProblem(step);
    if (problem) lines.push(`  WARNING: ${describeOutputProblem(problem, step.toolCalls.length > 0)}`);
    const gap = gaps.get(step.id);
    if (gap !== undefined) lines.push(`  NEXT CALL: ${fmtDuration(gap)} after this one ended (your code and tools)`);

    if (!step.content) {
      lines.push("  (no content captured, re-run to inspect)");
      lines.push("");
      continue;
    }

    // Print it in full, because cutting it could hide the text a --grep match was found in.
    const content = step.content;
    if (content.system) {
      lines.push("  SYSTEM:");
      for (const line of content.system.split("\n")) lines.push(`    ${line}`);
    }
    for (const msg of content.messages) {
      lines.push(`  ${msg.role.toUpperCase()}:`);
      for (const line of msg.content.split("\n")) lines.push(`    ${line}`);
    }
    if (content.output) {
      lines.push("  OUTPUT:");
      for (const line of content.output.split("\n")) lines.push(`    ${line}`);
    }
    for (const tc of step.toolCalls) {
      lines.push(`  TOOL: ${tc.name}(${JSON.stringify(tc.input)})`);
      if (tc.error) lines.push(`    TOOL FAILED: ${tc.error.message || "(no message)"}`);
      else if (resultLine(tc)) lines.push(`    ${resultLine(tc)}`);
    }
    // CI reads this output, and without the note it can't tell an empty conversation from a capped one.
    if (content.truncated) {
      lines.push("  (content truncated: full content exceeded capture limits)");
    }
    lines.push("");
  }

  return lines.join("\n");
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
