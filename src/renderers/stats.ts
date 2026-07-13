// Builds the report for `costcatch stats` from saved traces and draws it as a table.
import chalk from "chalk";
import { basename, dirname } from "node:path";
import type { Trace, LLMStep } from "../types/trace.js";
import { formatCost, formatTotalCost } from "../core/cost-calculator.js";
import { countUnpriced, isUnpricedCall, totalCost, unpricedCallsOf } from "../core/step-checks.js";
import { gapsAfter } from "../core/timing.js";
import { noColorChalk, boxed, dim, faint, glyph, compact, formatDuration } from "../ui/theme.js";

function displayScriptNames(scripts: string[]): (script: string) => string {
  const byBase = new Map<string, Set<string>>();
  for (const s of scripts) {
    const base = basename(s) || s;
    const set = byBase.get(base) ?? new Set();
    set.add(s);
    byBase.set(base, set);
  }
  return (script: string) => {
    const base = basename(script) || script;
    if ((byBase.get(base)?.size ?? 0) <= 1) return base;
    const parent = basename(dirname(script));
    return parent ? `${parent}/${base}` : script;
  };
}

export interface StatsFilter {
  today?: boolean;
  week?: boolean;
  script?: string;
  model?: string;
}

// Result token figures are estimates and only cover the measured calls.
export interface ToolStats {
  name: string;
  calls: number;
  failed: number;
  unanswered: number;
  measured: number;
  avgResultTokens: number | null;
  maxResultTokens: number | null;
  // Estimated tokens its results added to prompts, counting every resend.
  sentTokens: number;
  // Median time to the next call after a step that called only this tool. null under a model filter.
  medianGapMs: number | null;
}

// stats --json prints this as is, so its shape is public.
export interface StatsReport {
  period: string;
  totalRuns: number;
  // Only counts priced calls, so it's a lower bound when unpricedCalls is above zero.
  totalCostUsd: number;
  avgCostUsd: number;
  unpricedCalls: number;
  scripts: { script: string; costUsd: number; runs: number; unpricedCalls: number }[];
  models: { model: string; costUsd: number; calls: number; unpricedCalls: number }[];
  avgInputTokensPerRun: number;
  avgOutputTokensPerRun: number;
  slowestRuns: { script: string; runId: string | null; durationMs: number }[];
  tools: ToolStats[];
}

export function filterTraces(traces: Trace[], filter: StatsFilter = {}): Trace[] {
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
    filtered = filtered
      .filter((t) => t.steps.some((s) => s.type === "llm" && (s as LLMStep).model.includes(model)))
      .map((t) => projectToModel(t, model));
  }

  return filtered;
}

// Returns a zeroed report rather than null when nothing matches, so stats --json keeps the same shape.
export function computeStats(traces: Trace[], filter: StatsFilter = {}): StatsReport {
  const filtered = filterTraces(traces, filter);
  const period = filter.today ? "today" : filter.week ? "last 7 days" : "all time";

  if (filtered.length === 0) {
    return {
      period,
      totalRuns: 0,
      totalCostUsd: 0,
      avgCostUsd: 0,
      unpricedCalls: 0,
      scripts: [],
      models: [],
      avgInputTokensPerRun: 0,
      avgOutputTokensPerRun: 0,
      slowestRuns: [],
      tools: [],
    };
  }

  const totalCost = filtered.reduce((sum, t) => sum + (t.totalCostUsd ?? 0), 0);
  const totalInputTokens = filtered.reduce((sum, t) => sum + t.summary.totalInputTokens, 0);
  const totalOutputTokens = filtered.reduce((sum, t) => sum + t.summary.totalOutputTokens, 0);
  const sortedByDuration = [...filtered].sort((a, b) => b.durationMs - a.durationMs);

  return {
    period,
    totalRuns: filtered.length,
    totalCostUsd: totalCost,
    avgCostUsd: totalCost / filtered.length,
    unpricedCalls: filtered.reduce((n, t) => n + unpricedCallsOf(t), 0),
    scripts: aggregateByField(filtered, (t) => t.script).map((e) => ({ script: e.key, costUsd: e.totalCost, runs: e.count, unpricedCalls: e.unpriced })),
    models: aggregateByModel(filtered).map((e) => ({ model: e.key, costUsd: e.totalCost, calls: e.count, unpricedCalls: e.unpriced })),
    avgInputTokensPerRun: Math.round(totalInputTokens / filtered.length),
    avgOutputTokensPerRun: Math.round(totalOutputTokens / filtered.length),
    slowestRuns: sortedByDuration.slice(0, 3).map((t) => ({ script: t.script, runId: t.runId ?? null, durationMs: t.durationMs })),
    // Under a model filter the gaps can't be trusted, because other models' calls were dropped.
    tools: aggregateTools(filtered, !filter.model),
  };
}

export function renderStats(traces: Trace[], filter: StatsFilter = {}, useColor: boolean = true): string {
  const c = useColor ? chalk : noColorChalk();

  // Draw only what's in the report stats --json prints, so the table and JSON always agree.
  const report = computeStats(traces, filter);

  if (report.totalRuns === 0) {
    const empty = c.dim("No traces found matching the filter.");
    return useColor ? boxed({ rows: [empty], headerRight: dim("stats") }) : `\n  ${empty}\n`;
  }

  const label = displayScriptNames(
    report.scripts.map((s) => s.script).concat(report.slowestRuns.map((r) => r.script)),
  );

  const rows: string[] = [];
  const rule = (title: string) => faint("── ") + dim(title);

  rows.push(`${c.dim("Total runs:")}      ${c.bold(String(report.totalRuns))}`);
  rows.push(`${c.dim("Total cost:")}      ${c.bold(costText(report.totalCostUsd, report.unpricedCalls))}`);
  rows.push(`${c.dim("Avg cost/run:")}    ${costText(report.avgCostUsd, report.unpricedCalls)}`);
  if (report.unpricedCalls > 0) {
    rows.push(c.dim(`${report.unpricedCalls} ${report.unpricedCalls === 1 ? "call" : "calls"} could not be priced: costs marked ≥ are lower bounds`));
  }

  if (report.scripts.length > 0) {
    rows.push("");
    rows.push(rule("most expensive scripts"));
    for (const entry of report.scripts.slice(0, 5)) {
      rows.push(`  ${costText(entry.costUsd, entry.unpricedCalls).padStart(8)}  ${c.white(label(entry.script))}  ${c.dim(`(${entry.runs} runs)`)}`);
    }
  }

  if (report.models.length > 0) {
    rows.push("");
    rows.push(rule("most expensive models"));
    for (const entry of report.models.slice(0, 5)) {
      rows.push(`  ${costText(entry.costUsd, entry.unpricedCalls).padStart(8)}  ${c.white(entry.model)}  ${c.dim(`(${entry.calls} calls)`)}`);
    }
  }

  rows.push("");
  rows.push(rule("tokens per run"));
  rows.push(`  ${c.dim("avg input tok/run:")}   ${report.avgInputTokensPerRun.toLocaleString()}`);
  rows.push(`  ${c.dim("avg output tok/run:")}  ${report.avgOutputTokensPerRun.toLocaleString()}`);

  if (report.tools.length > 0) {
    rows.push("");
    rows.push(rule("tools, by result tokens sent"));
    for (const t of report.tools.slice(0, 8)) {
      const sent = t.measured > 0 ? `~${compact(t.sentTokens)} tok` : "—";
      const details = [
        `${t.calls} ${t.calls === 1 ? "call" : "calls"}`,
        ...(t.failed > 0 ? [`${t.failed} failed`] : []),
        ...(t.unanswered > 0 ? [`${t.unanswered} unanswered`] : []),
        ...(t.avgResultTokens !== null ? [`avg ~${compact(t.avgResultTokens)} tok`] : []),
        ...(t.medianGapMs !== null ? [`${formatDuration(t.medianGapMs)} after`] : []),
      ];
      rows.push(`  ${sent.padStart(10)}  ${c.white(t.name)}  ${c.dim(`(${details.join(" · ")})`)}`);
    }
  }

  if (report.slowestRuns.length > 0) {
    rows.push("");
    rows.push(rule("slowest runs"));
    for (const r of report.slowestRuns) {
      const dur = `${(r.durationMs / 1000).toFixed(1)}s`;
      rows.push(`  ${dur.padStart(8)}  ${c.white(label(r.script))}  ${c.dim(r.runId ?? "")}`);
    }
  }

  // CI reads the plain version from log files, where box drawing is just noise.
  if (!useColor) {
    return ["", `  costcatch stats (${report.period})`, `  ${BOX_LINE}`, "", ...rows.map((r) => (r ? `  ${r}` : "")), ""].join("\n");
  }

  return boxed({
    rows,
    headerRight: dim(`stats ${glyph.dot} ${report.period}`),
    footer: dim(`${report.totalRuns} ${report.totalRuns === 1 ? "run" : "runs"} ${glyph.dot} ${costText(report.totalCostUsd, report.unpricedCalls)} total`),
  });
}

function costText(costUsd: number, unpricedCalls: number): string {
  if (unpricedCalls > 0 && costUsd === 0) return formatCost(null);
  return formatTotalCost(costUsd, unpricedCalls);
}

const BOX_LINE = "─".repeat(50);

// durationMs stays the whole run's wall clock time.
function projectToModel(trace: Trace, model: string): Trace {
  const steps = trace.steps.filter((s) => s.type === "llm" && (s as LLMStep).model.includes(model));
  const llmSteps = steps as LLMStep[];

  const totalCostUsd = totalCost(llmSteps);

  return {
    ...trace,
    steps,
    totalCostUsd,
    summary: {
      ...trace.summary,
      llmCalls: llmSteps.length,
      toolCalls: llmSteps.reduce((sum, s) => sum + s.toolCalls.length, 0),
      totalInputTokens: llmSteps.reduce((sum, s) => sum + (s.inputTokens ?? 0), 0),
      totalOutputTokens: llmSteps.reduce((sum, s) => sum + (s.outputTokens ?? 0), 0),
      totalSteps: steps.length,
      unpricedCalls: countUnpriced(llmSteps),
    },
  };
}

interface AggregateEntry {
  key: string;
  totalCost: number;
  count: number;
  unpriced: number;
}

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
      existing.unpriced += unpricedCallsOf(trace);
    } else {
      map.set(key, { key, totalCost: trace.totalCostUsd ?? 0, count: 1, unpriced: unpricedCallsOf(trace) });
    }
  }

  return [...map.values()].sort((a, b) => b.totalCost - a.totalCost);
}

function aggregateTools(traces: Trace[], withGaps: boolean): ToolStats[] {
  const map = new Map<string, ToolStats & { tokens: number[]; gaps: number[] }>();
  for (const trace of traces) {
    const gaps = withGaps ? gapsAfter(trace.steps) : new Map<number, number>();
    for (const step of trace.steps) {
      if (step.type !== "llm") continue;
      for (const tc of step.toolCalls) {
        const entry = map.get(tc.name) ?? {
          name: tc.name, calls: 0, failed: 0, unanswered: 0, measured: 0,
          avgResultTokens: null, maxResultTokens: null, sentTokens: 0, medianGapMs: null, tokens: [], gaps: [],
        };
        entry.calls++;
        if (tc.error) entry.failed++;
        if (tc.unanswered) entry.unanswered++;
        if (tc.result) {
          entry.measured++;
          entry.tokens.push(tc.result.tokens);
          entry.sentTokens += tc.result.tokens * tc.result.sends;
        }
        map.set(tc.name, entry);
      }
      // Only count the gap when the step called a single tool, since otherwise the tools share it.
      const gap = gaps.get(step.id);
      if (step.toolCalls.length === 1 && gap !== undefined) map.get(step.toolCalls[0].name)!.gaps.push(gap);
    }
  }

  return [...map.values()]
    .map(({ tokens, gaps, ...stats }) => ({
      ...stats,
      avgResultTokens: tokens.length > 0 ? Math.round(tokens.reduce((a, b) => a + b, 0) / tokens.length) : null,
      // Use reduce rather than Math.max(...), because thousands of runs can go over the argument limit.
      maxResultTokens: tokens.length > 0 ? tokens.reduce((a, b) => Math.max(a, b)) : null,
      medianGapMs: gaps.length > 0 ? medianOf(gaps) : null,
    }))
    .sort((a, b) => b.sentTokens - a.sentTokens || b.calls - a.calls || a.name.localeCompare(b.name));
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function aggregateByModel(traces: Trace[]): AggregateEntry[] {
  const map = new Map<string, AggregateEntry>();

  for (const trace of traces) {
    for (const step of trace.steps) {
      if (step.type !== "llm") continue;
      const llm = step as LLMStep;
      const existing = map.get(llm.model);
      const unpriced = isUnpricedCall(llm) ? 1 : 0;
      if (existing) {
        existing.totalCost += llm.costUsd ?? 0;
        existing.count++;
        existing.unpriced += unpriced;
      } else {
        map.set(llm.model, { key: llm.model, totalCost: llm.costUsd ?? 0, count: 1, unpriced });
      }
    }
  }

  return [...map.values()].sort((a, b) => b.totalCost - a.totalCost);
}
