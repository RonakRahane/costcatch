/**
 * Scaling probe for the trace pipeline.
 *
 * Not a vitest `bench` — a plain test that fails if building a trace stops
 * being roughly linear in the number of steps. Long agent loops are the
 * workload costcatch exists for, so a quadratic stage here is a product bug,
 * not a micro-optimization.
 *
 * Run with `npx vitest run tests/bench`.
 */

import { describe, it, expect } from "vitest";
import { buildTrace } from "../../../src/core/trace-builder.js";
import { detectWarnings } from "../../../src/core/warning-engine.js";
import type { RawHttpCall, Step } from "../../../src/types/trace.js";

function calls(n: number, messageChars: number, identical: boolean): RawHttpCall[] {
  return Array.from({ length: n }, (_, i) => ({
    url: "https://api.openai.com/v1/chat/completions",
    method: "POST",
    requestBody: {
      model: "gpt-4o",
      // `identical` reproduces the worst case for retry detection: an agent
      // loop that re-sends a near-identical prompt every turn.
      messages: [{ role: "user", content: (identical ? "x" : String(i)).repeat(messageChars) }],
    },
    responseBody: {
      model: "gpt-4o",
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
    },
    statusCode: 200,
    startMs: 1000 + i,
    endMs: 1010 + i,
    isStreaming: false,
  }));
}

function timeMs(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

const build = (input: RawHttpCall[]) =>
  buildTrace(input, "agent.py", "python", "python agent.py", "2026-05-15T14:32:17.000Z");

describe("trace pipeline scaling", () => {
  it("stays near-linear as step count grows 4×", () => {
    const small = calls(250, 500, true);
    const large = calls(1_000, 500, true);

    build(small); // warm up the JIT so the ratio measures the algorithm
    const tSmall = timeMs(() => build(small));
    const tLarge = timeMs(() => build(large));

    // Perfectly linear is 4×. Quadratic would be ~16×. Allow generous headroom
    // for CI noise while still catching an accidental all-pairs loop.
    const ratio = tLarge / Math.max(tSmall, 1);
    expect(ratio).toBeLessThan(9);
  }, 120_000);

  it("builds a 2,000-step trace in reasonable time", () => {
    const elapsed = timeMs(() => build(calls(2_000, 500, true)));
    expect(elapsed).toBeLessThan(20_000);
  }, 120_000);

  it("detects warnings on 2,000 identical steps without blowing up", () => {
    // Every step is a "retry" of the first, which is the pathological input for
    // the retry and duplicate detectors.
    const trace = build(calls(2_000, 200, true));
    const elapsed = timeMs(() => detectWarnings(trace.steps as Step[]));
    expect(elapsed).toBeLessThan(5_000);
  }, 120_000);
});
