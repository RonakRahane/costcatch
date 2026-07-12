// Draws the before and after comparison for `costcatch diff` and --compare-last.
import chalk from "chalk";
import type { TraceDiff } from "../core/diff-engine.js";
import { formatCost, formatTotalCost } from "../core/cost-calculator.js";
import { noColorChalk, boxed, dim, faint, glyph } from "../ui/theme.js";

export function renderDiff(diff: TraceDiff, useColor: boolean = true): string {
  const c = useColor ? chalk : noColorChalk();
  const lines: string[] = [];
  const rule = (title: string) => faint("── ") + dim(title);

  lines.push(renderDiffLine("Steps", diff.before.totalSteps, diff.after.totalSteps, diff.delta.steps, c));
  lines.push(renderDiffLine("LLM calls", diff.before.llmCalls, diff.after.llmCalls, diff.delta.llmCalls, c));
  lines.push(renderDiffLine("Tool calls", diff.before.toolCalls, diff.after.toolCalls, diff.delta.toolCalls, c));
  lines.push(renderDurationLine(diff.before.durationMs, diff.after.durationMs, diff.delta.durationMs, c));
  lines.push(
    renderCostLine(
      formatTotalCost(diff.before.costUsd, diff.before.unpricedCalls ?? 0),
      formatTotalCost(diff.after.costUsd, diff.after.unpricedCalls ?? 0),
      diff.before.costUsd,
      diff.delta.costUsd,
      c,
    ),
  );
  lines.push(
    renderDiffLine("Max context tok", diff.before.maxContext, diff.after.maxContext, diff.delta.maxContext, c, true),
  );

  if (diff.removedToolCalls.length > 0) {
    lines.push("");
    lines.push(rule("removed calls"));
    for (const tc of diff.removedToolCalls) {
      lines.push(`  ${c.red("·")} ${c.strikethrough(tc)}`);
    }
  }

  if (diff.addedToolCalls.length > 0) {
    lines.push("");
    lines.push(rule("added calls"));
    for (const tc of diff.addedToolCalls) {
      lines.push(`  ${c.green("+")} ${tc}`);
    }
  }

  const movedSteps = diff.stepDeltas.filter((sd) => sd.tokenDelta !== null && sd.tokenDelta !== 0);
  if (movedSteps.length > 0) {
    lines.push("");
    lines.push(rule("input-token delta by step (before → after)"));
    for (const sd of movedSteps) {
      const pct = sd.beforeInputTokens
        ? Math.round((sd.tokenDelta! / sd.beforeInputTokens) * 100)
        : 0;
      const sign = sd.tokenDelta! > 0 ? "+" : "";
      const color = sd.tokenDelta! < 0 ? c.green : c.red;
      lines.push(
        `  Step ${sd.stepId}: ${sd.beforeInputTokens?.toLocaleString() ?? "?"} → ${sd.afterInputTokens?.toLocaleString() ?? "?"} (${color(`${sign}${pct}%`)})`,
      );
    }
  }

  // CI reads the plain version from log files, where box drawing is just noise.
  if (!useColor) {
    return ["", "  diff: before vs after", "", ...lines.map((l) => (l ? `  ${l}` : "")), ""].join("\n");
  }

  const verdict =
    diff.delta.costUsd === null
      ? dim(diff.before.costUsd !== null && diff.after.costUsd !== null ? "cost not comparable: some calls unpriced" : "cost unknown")
      : diff.delta.costUsd < 0
        ? c.green(`${formatCost(Math.abs(diff.delta.costUsd))} cheaper`)
        : diff.delta.costUsd > 0
          ? c.red(`${formatCost(diff.delta.costUsd)} more expensive`)
          : dim("no cost change");

  return boxed({
    rows: lines,
    headerRight: dim(`diff ${glyph.dot} before ${glyph.arrow} after`),
    footer: verdict,
  });
}

function renderDiffLine(
  label: string,
  before: number,
  after: number,
  delta: number,
  c: typeof chalk,
  isTokens: boolean = false,
): string {
  const labelPad = label.padEnd(16);
  const beforeStr = isTokens ? before.toLocaleString() : String(before);
  const afterStr = isTokens ? after.toLocaleString() : String(after);
  const sign = delta > 0 ? "+" : "";
  const deltaStr = `${sign}${isTokens ? delta.toLocaleString() : delta}`;
  const color = delta < 0 ? c.green : delta > 0 ? c.red : c.dim;
  const check = delta < 0 ? " ✓" : "";

  return `${c.dim(labelPad)} ${beforeStr.padStart(8)} → ${afterStr.padEnd(8)} ${color(deltaStr.padStart(10))}${c.green(check)}`;
}

function renderDurationLine(
  before: number,
  after: number,
  delta: number,
  c: typeof chalk,
): string {
  const label = "Duration".padEnd(16);
  const formatMs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  const pct = before > 0 ? Math.round((delta / before) * 100) : 0;
  const sign = pct > 0 ? "+" : "";
  const color = delta < 0 ? c.green : c.red;

  return `${c.dim(label)} ${formatMs(before).padStart(8)} → ${formatMs(after).padEnd(8)} ${color(`${sign}${pct}%`.padStart(10))}`;
}

function renderCostLine(
  beforeText: string,
  afterText: string,
  before: number | null,
  delta: number | null,
  c: typeof chalk,
): string {
  const label = "Cost".padEnd(16);

  if (before === null || delta === null) {
    return `${c.dim(label)} ${beforeText.padStart(8)} → ${afterText.padEnd(8)}`;
  }

  const pct = before > 0 ? Math.round((delta / before) * 100) : 0;
  const sign = pct > 0 ? "+" : "";
  const color = delta < 0 ? c.green : c.red;
  const check = delta < 0 ? " ✓" : "";

  return `${c.dim(label)} ${beforeText.padStart(8)} → ${afterText.padEnd(8)} ${color(`${sign}${pct}%`.padStart(10))}${c.green(check)}`;
}
