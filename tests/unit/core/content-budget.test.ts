/**
 * Per-trace content budget and PII opt-out.
 *
 * Chat APIs resend the whole history every turn, so storing full content per
 * step grows with the square of the run length — the exact workload this tool
 * targets. The budget bounds a saved trace without hiding that it did so.
 */

import { describe, it, expect } from "vitest";
import { buildTrace } from "../../../src/core/trace-builder.js";
import type { LLMStep, RawHttpCall } from "../../../src/types/trace.js";

/** A call whose prompt is `chars` characters long. */
function bigCall(startMs: number, chars: number, text = "x"): RawHttpCall {
  return {
    url: "https://api.openai.com/v1/chat/completions",
    method: "POST",
    requestBody: { model: "gpt-4o", messages: [{ role: "user", content: text.repeat(chars) }] },
    responseBody: {
      model: "gpt-4o",
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
    },
    statusCode: 200,
    startMs,
    endMs: startMs + 10,
    isStreaming: false,
  };
}

const build = (calls: RawHttpCall[], options = {}) =>
  buildTrace(calls, "agent.py", "python", "python agent.py", "2026-05-15T14:32:17.000Z", options);

describe("per-trace content budget", () => {
  // Each message is capped at 4,000 chars, so ~2,000 steps of maximum-length
  // messages is what it takes to exhaust the 8M budget. Built once and shared:
  // rebuilding per test made this file dominate the suite's runtime.
  const manyLargeCalls = Array.from({ length: 2_400 }, (_, i) => bigCall(1000 + i, 5_000));
  const trace = build(manyLargeCalls);

  it("keeps content for the first steps", () => {
    const first = trace.steps[0] as LLMStep;
    expect(first.content?.messages[0]?.content.length).toBeGreaterThan(1_000);
  });

  it("stops storing content once the budget is spent", () => {
    const last = trace.steps[trace.steps.length - 1] as LLMStep;
    expect(last.content?.messages).toEqual([]);
  });

  it("says the content was dropped rather than implying the call was empty", () => {
    const last = trace.steps[trace.steps.length - 1] as LLMStep;
    expect(last.content?.truncated).toBe(true);
  });

  it("keeps every metric on the steps that lost their content", () => {
    const last = trace.steps[trace.steps.length - 1] as LLMStep;
    expect(last.inputTokens).toBe(10);
    expect(last.outputTokens).toBe(5);
    expect(last.costUsd).not.toBeNull();
    expect(trace.summary.llmCalls).toBe(manyLargeCalls.length);
  });

  it("bounds the serialized trace", () => {
    const size = JSON.stringify(trace).length;
    // Without a budget this would be ~2,400 × 4,000 ≈ 10M characters of content
    // on top of the metadata; the cap keeps it near the 8M budget.
    expect(size).toBeLessThan(12_000_000);
  });

  it("does not interfere with an ordinary short run", () => {
    const trace = build([bigCall(1000, 20), bigCall(1010, 20)]);
    for (const step of trace.steps as LLMStep[]) {
      expect(step.content?.truncated).toBe(false);
      expect(step.content?.messages).toHaveLength(1);
    }
  });
});

describe("redactPii", () => {
  const withPii = [
    {
      ...bigCall(1000, 1),
      requestBody: {
        model: "gpt-4o",
        messages: [{ role: "user", content: "mail me at dev@example.com, key sk-abcdefghijklmnopqrstuvwxyz01" }],
      },
    } as RawHttpCall,
  ];

  it("redacts PII by default", () => {
    const step = build(withPii).steps[0] as LLMStep;
    expect(step.content?.messages[0].content).toContain("«email»");
    expect(step.content?.messages[0].content).not.toContain("dev@example.com");
  });

  it("keeps PII when the user opts out", () => {
    const step = build(withPii, { redactPii: false }).steps[0] as LLMStep;
    expect(step.content?.messages[0].content).toContain("dev@example.com");
  });

  it("still redacts secrets even with --no-redact", () => {
    // PII is a preference; a leaked API key in a shared trace is not.
    const step = build(withPii, { redactPii: false }).steps[0] as LLMStep;
    expect(step.content?.messages[0].content).toContain("«redacted»");
    expect(step.content?.messages[0].content).not.toContain("sk-abcdefghijklmnopqrstuvwxyz01");
  });
});
