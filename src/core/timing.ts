// Splits a run's time between LLM calls and the program's own work. Older traces get null.
import type { Step } from "../types/trace.js";

export interface TimeSplit {
  // Time with at least one LLM call in flight, so overlapping calls count once.
  llmMs: number;
  // The rest of the time between the first call's start and the last call's end.
  betweenMs: number;
}

export function timeSplit(steps: Step[]): TimeSplit | null {
  if (steps.length === 0 || steps.some((s) => s.offsetMs === undefined)) return null;
  const spans = steps
    .map((s) => [s.offsetMs!, s.offsetMs! + s.durationMs] as const)
    .sort((a, b) => a[0] - b[0]);

  let llmMs = 0;
  let [start, end] = spans[0];
  let last = end;
  for (const [s, e] of spans.slice(1)) {
    last = Math.max(last, e);
    if (s > end) {
      llmMs += end - start;
      [start, end] = [s, e];
    } else {
      end = Math.max(end, e);
    }
  }
  llmMs += end - start;
  const span = last - spans[0][0];
  return { llmMs, betweenMs: Math.max(0, span - llmMs) };
}

// The gap after each step, by step id. Steps that overlap another call are left out.
export function gapsAfter(steps: Step[]): Map<number, number> {
  const gaps = new Map<number, number>();
  if (steps.some((s) => s.offsetMs === undefined)) return gaps;
  const ordered = [...steps].sort((a, b) => a.offsetMs! - b.offsetMs!);
  let earlierEnd = -Infinity;
  for (let i = 0; i < ordered.length - 1; i++) {
    const start = ordered[i].offsetMs!;
    const end = start + ordered[i].durationMs;
    const nextStart = ordered[i + 1].offsetMs!;
    if (start >= earlierEnd && nextStart >= end) gaps.set(ordered[i].id, nextStart - end);
    earlierEnd = Math.max(earlierEnd, end);
  }
  return gaps;
}
