/**
 * Stats renderer.
 *
 * Renders aggregated analytics across all saved traces.
 */

import chalk, { type ChalkInstance } from "chalk";
import type { Trace, LLMStep } from "../types/trace.js";
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

/** Stats filter options. */
export interface StatsFilter {
  today?: boolean;
  week?: boolean;
  script?: string;
  model?: string;
}

/**
 * Render aggregated stats from multiple traces.
 */
export function renderStats(traces: Trace[], filter: StatsFilter = {}, useColor: boolean = true): string {
  const c = useColor ? chalk : noColorChalk();

  // Apply filters
  let filtered = traces;

  if (filter.today) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    filtered = filtered.filter((t) => new Date(t.startedAt) >= todayStart);
  }

  if (filter.week) {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    filtered = filtered.filter((t) => new Date(t.startedAt) >= weekAgo);
  }

  if (filter.script) {
    const script = filter.script;
    filtered = filtered.filter((t) => t.script.includes(script));
  }

  if (filter.model) {
    const model = filter.model;
    filtered = filtered.filter((t) =>
      t.steps.some((s) => s.type === "llm" && (s as LLMStep).model.includes(model)),
    );
  }

  if (filtered.length === 0) {
    return `\n  ${c.dim("No traces found matching the filter.")}\n`;
  }

  const lines: string[] = [];
  const period = filter.today ? "today" : filter.week ? "last 7 days" : "all time";

  lines.push("");
  lines.push(c.bold(`  📊 costcatch stats (${period})`));
  lines.push(c.dim(`  ${BOX_LINE}`));
  lines.push("");

  // Total runs and cost
  const totalCost = filtered.reduce((sum, t) => sum + (t.totalCostUsd ?? 0), 0);
  const avgCost = totalCost / filtered.length;
  lines.push(`  ${c.dim("Total runs:")}      ${c.bold(String(filtered.length))}`);
  lines.push(`  ${c.dim("Total cost:")}      ${c.bold(formatCost(totalCost))}`);
  lines.push(`  ${c.dim("Avg cost/run:")}    ${formatCost(avgCost)}`);
  lines.push("");

  // Most expensive scripts
  const scriptCosts = aggregateByField(filtered, (t) => t.script);
  if (scriptCosts.length > 0) {
    lines.push(`  ${c.bold("Most expensive scripts:")}`);
    for (const entry of scriptCosts.slice(0, 5)) {
      lines.push(`    ${formatCost(entry.totalCost).padStart(8)}  ${c.white(entry.key)}  (${entry.count} runs)`);
    }
    lines.push("");
  }

  // Most used models
  const modelCosts = aggregateByModel(filtered);
  if (modelCosts.length > 0) {
    lines.push(`  ${c.bold("Most expensive models:")}`);
    for (const entry of modelCosts.slice(0, 5)) {
      lines.push(`    ${formatCost(entry.totalCost).padStart(8)}  ${c.white(entry.key)}  (${entry.count} calls)`);
    }
    lines.push("");
  }

  // Average tokens
  const totalInputTokens = filtered.reduce((sum, t) => sum + t.summary.totalInputTokens, 0);
  const totalOutputTokens = filtered.reduce((sum, t) => sum + t.summary.totalOutputTokens, 0);
  lines.push(`  ${c.dim("Avg input tokens/run:")}   ${Math.round(totalInputTokens / filtered.length).toLocaleString()}`);
  lines.push(`  ${c.dim("Avg output tokens/run:")}  ${Math.round(totalOutputTokens / filtered.length).toLocaleString()}`);
  lines.push("");

  // Slowest runs
  const sortedByDuration = [...filtered].sort((a, b) => b.durationMs - a.durationMs);
  if (sortedByDuration.length > 0) {
    lines.push(`  ${c.bold("Slowest runs:")}`);
    for (const t of sortedByDuration.slice(0, 3)) {
      const dur = `${(t.durationMs / 1000).toFixed(1)}s`;
      lines.push(`    ${dur.padStart(8)}  ${c.white(t.script)}  ${c.dim(t.runId)}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

const BOX_LINE = "─".repeat(50);

/** Aggregate entry for stats grouping. */
interface AggregateEntry {
  key: string;
  totalCost: number;
  count: number;
}

/** Aggregate traces by a field (e.g. script name). */
function aggregateByField(
  traces: Trace[],
  keyFn: (t: Trace) => string,
): AggregateEntry[] {
  const map = new Map<string, AggregateEntry>();

  for (const trace of traces) {
    const key = keyFn(trace);
    const existing = map.get(key);
    if (existing) {
      existing.totalCost += trace.totalCostUsd ?? 0;
      existing.count++;
    } else {
      map.set(key, { key, totalCost: trace.totalCostUsd ?? 0, count: 1 });
    }
  }

  return [...map.values()].sort((a, b) => b.totalCost - a.totalCost);
}

/** Aggregate by model across all LLM steps in all traces. */
function aggregateByModel(traces: Trace[]): AggregateEntry[] {
  const map = new Map<string, AggregateEntry>();

  for (const trace of traces) {
    for (const step of trace.steps) {
      if (step.type !== "llm") continue;
      const llm = step as LLMStep;
      const existing = map.get(llm.model);
      if (existing) {
        existing.totalCost += llm.costUsd ?? 0;
        existing.count++;
      } else {
        map.set(llm.model, { key: llm.model, totalCost: llm.costUsd ?? 0, count: 1 });
      }
    }
  }

  return [...map.values()].sort((a, b) => b.totalCost - a.totalCost);
}
