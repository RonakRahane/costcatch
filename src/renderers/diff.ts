/**
 * Diff renderer.
 *
 * Renders the output of the diff engine — a side-by-side comparison
 * of two traces showing what changed.
 */

import chalk, { type ChalkInstance } from "chalk";
import type { TraceDiff } from "../core/diff-engine.js";
import { formatCost } from "../core/cost-calculator.js";

/** Create a passthrough (no-color) chalk-like object. */
function noColorChalk(): ChalkInstance {
  const identity = ((s: string) => s) as unknown as ChalkInstance;
  const handler: ProxyHandler<ChalkInstance> = {
    get() { return identity; },
    apply(_t, _a, args) { return args[0]; },
  };
  return new Proxy(identity, handler);
}

/**
 * Render a diff comparison for the terminal.
 */
export function renderDiff(diff: TraceDiff, useColor: boolean = true): string {
  const c = useColor ? chalk : noColorChalk();
  const lines: string[] = [];

  lines.push("");
  lines.push(c.bold("  diff: before vs after"));
  lines.push("");

  // Summary table
  lines.push(renderDiffLine("Steps", diff.before.totalSteps, diff.after.totalSteps, diff.delta.steps, c));
  lines.push(renderDiffLine("LLM calls", diff.before.llmCalls, diff.after.llmCalls, diff.delta.llmCalls, c));
  lines.push(renderDiffLine("Tool calls", diff.before.toolCalls, diff.after.toolCalls, diff.delta.toolCalls, c));
  lines.push(renderDurationLine(diff.before.durationMs, diff.after.durationMs, diff.delta.durationMs, c));
  lines.push(renderCostLine(diff.before.costUsd, diff.after.costUsd, diff.delta.costUsd, c));
  lines.push(renderDiffLine("Max context", diff.before.maxContext, diff.after.maxContext, diff.delta.maxContext, c, true));

  // Removed tool calls
  if (diff.removedToolCalls.length > 0) {
    lines.push("");
    lines.push(`  ${c.bold("Removed calls:")}`);
    for (const tc of diff.removedToolCalls) {
      lines.push(`    ${c.red("·")} ${c.strikethrough(tc)}`);
    }
  }

  // Added tool calls
  if (diff.addedToolCalls.length > 0) {
    lines.push("");
    lines.push(`  ${c.bold("Added calls:")}`);
    for (const tc of diff.addedToolCalls) {
      lines.push(`    ${c.green("+")} ${tc}`);
    }
  }

  // Per-step token deltas
  if (diff.stepDeltas.length > 0) {
    lines.push("");
    lines.push(`  ${c.bold("Token delta by step:")}`);
    for (const sd of diff.stepDeltas) {
      if (sd.tokenDelta !== null && sd.tokenDelta !== 0) {
        const pct = sd.beforeInputTokens
          ? Math.round((sd.tokenDelta / sd.beforeInputTokens) * 100)
          : 0;
        const sign = sd.tokenDelta > 0 ? "+" : "";
        const color = sd.tokenDelta < 0 ? c.green : c.red;
        lines.push(
          `    Step ${sd.stepId}: ${sd.beforeInputTokens?.toLocaleString() ?? "?"} → ${sd.afterInputTokens?.toLocaleString() ?? "?"} (${color(`${sign}${pct}%`)})`,
        );
      }
    }
  }

  lines.push("");

  return lines.join("\n");
}

/** Render a single diff summary line with delta. */
function renderDiffLine(
  label: string,
  before: number,
  after: number,
  delta: number,
  c: typeof chalk,
  isTokens: boolean = false,
): string {
  const labelPad = label.padEnd(14);
  const beforeStr = isTokens ? before.toLocaleString() : String(before);
  const afterStr = isTokens ? after.toLocaleString() : String(after);
  const sign = delta > 0 ? "+" : "";
  const deltaStr = `${sign}${isTokens ? delta.toLocaleString() : delta}`;
  const color = delta < 0 ? c.green : delta > 0 ? c.red : c.dim;
  const check = delta < 0 ? " ✓" : "";

  return `  ${c.dim(labelPad)} ${beforeStr.padStart(8)} → ${afterStr.padEnd(8)} ${color(deltaStr.padStart(10))}${c.green(check)}`;
}

/** Render the duration diff line. */
function renderDurationLine(
  before: number,
  after: number,
  delta: number,
  c: typeof chalk,
): string {
  const label = "Duration".padEnd(14);
  const formatMs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  const pct = before > 0 ? Math.round((delta / before) * 100) : 0;
  const sign = pct > 0 ? "+" : "";
  const color = delta < 0 ? c.green : c.red;

  return `  ${c.dim(label)} ${formatMs(before).padStart(8)} → ${formatMs(after).padEnd(8)} ${color(`${sign}${pct}%`.padStart(10))}`;
}

/** Render the cost diff line. */
function renderCostLine(
  before: number | null,
  after: number | null,
  delta: number | null,
  c: typeof chalk,
): string {
  const label = "Cost".padEnd(14);

  if (before === null || after === null || delta === null) {
    return `  ${c.dim(label)} ${formatCost(before).padStart(8)} → ${formatCost(after).padEnd(8)}`;
  }

  const pct = before > 0 ? Math.round((delta / before) * 100) : 0;
  const sign = pct > 0 ? "+" : "";
  const color = delta < 0 ? c.green : c.red;
  const check = delta < 0 ? " ✓" : "";

  return `  ${c.dim(label)} ${formatCost(before).padStart(8)} → ${formatCost(after).padEnd(8)} ${color(`${sign}${pct}%`.padStart(10))}${c.green(check)}`;
}
