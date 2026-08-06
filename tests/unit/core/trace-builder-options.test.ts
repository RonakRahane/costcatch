/**
 * buildTrace options: provider filtering and the latency threshold.
 *
 * Both used to be broken in ways that produced confidently wrong output:
 *   · `--filter` was applied to the rendered steps only, so `summary`,
 *     `totalCostUsd` and `warnings` still described the unfiltered run.
 *   · `--threshold` was parsed, typed, threaded through RunFlags… and never
 *     read, so it silently did nothing.
 */

import { describe, it, expect } from "vitest";
import { buildTrace } from "../../../src/core/trace-builder.js";
import type { LLMStep, RawHttpCall } from "../../../src/types/trace.js";

function openaiCall(startMs: number, tokens: number, durationMs = 100): RawHttpCall {
  return {
    url: "https://api.openai.com/v1/chat/completions",
    method: "POST",
    requestBody: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
    responseBody: {
      model: "gpt-4o",
      usage: { prompt_tokens: tokens, completion_tokens: 10 },
      choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
    },
    statusCode: 200,
    startMs,
    endMs: startMs + durationMs,
    isStreaming: false,
  };
}

function anthropicCall(startMs: number, tokens: number): RawHttpCall {
  return {
    url: "https://api.anthropic.com/v1/messages",
    method: "POST",
    requestBody: { model: "claude-sonnet-4-20250514", messages: [{ role: "user", content: "hi" }] },
    responseBody: {
      model: "claude-sonnet-4-20250514",
      usage: { input_tokens: tokens, output_tokens: 10 },
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
    },
    statusCode: 200,
    startMs,
    endMs: startMs + 100,
    isStreaming: false,
  };
}

const build = (calls: RawHttpCall[], options = {}) =>
  buildTrace(calls, "agent.py", "python", "python agent.py", "2026-05-15T14:32:17.000Z", options);

describe("providerFilter", () => {
  const calls = [openaiCall(1000, 100), anthropicCall(1100, 200), openaiCall(1200, 300)];

  it("keeps only the requested provider's steps", () => {
    const trace = build(calls, { providerFilter: "openai" });
    expect(trace.steps).toHaveLength(2);
    expect((trace.steps as LLMStep[]).every((s) => s.provider === "openai")).toBe(true);
  });

  it("makes the summary agree with the visible steps", () => {
    const trace = build(calls, { providerFilter: "openai" });
    expect(trace.summary.llmCalls).toBe(2);
    expect(trace.summary.totalInputTokens).toBe(400); // 100 + 300, no Anthropic
  });

  it("makes the total cost agree with the visible steps", () => {
    const all = build(calls);
    const filtered = build(calls, { providerFilter: "openai" });
    expect(all.totalCostUsd).not.toBeNull();
    expect(filtered.totalCostUsd).not.toBeNull();
    expect(filtered.totalCostUsd!).toBeLessThan(all.totalCostUsd!);
  });

  it("renumbers steps contiguously from 1", () => {
    const trace = build(calls, { providerFilter: "openai" });
    expect((trace.steps as LLMStep[]).map((s) => s.id)).toEqual([1, 2]);
  });

  it("is case-insensitive", () => {
    expect(build(calls, { providerFilter: "OpenAI" }).steps).toHaveLength(2);
  });

  it("yields an empty trace for a provider that never appears", () => {
    const trace = build(calls, { providerFilter: "cohere" });
    expect(trace.steps).toHaveLength(0);
    expect(trace.summary.llmCalls).toBe(0);
  });
});

describe("latencyThresholdMs", () => {
  const slow = [openaiCall(1000, 100, 3_000)];

  it("does not warn below the default threshold", () => {
    const trace = build(slow);
    expect(trace.warnings.find((w) => w.code === "latency_spike")).toBeUndefined();
  });

  it("warns once the caller lowers the threshold", () => {
    const trace = build(slow, { latencyThresholdMs: 1_000 });
    const warning = trace.warnings.find((w) => w.code === "latency_spike");
    expect(warning).toBeDefined();
    expect(warning!.stepIds).toEqual([1]);
  });

  it("ignores a nonsensical threshold rather than warning on everything", () => {
    expect(build(slow, { latencyThresholdMs: 0 }).warnings.find((w) => w.code === "latency_spike")).toBeUndefined();
    expect(build(slow, { latencyThresholdMs: Number.NaN }).warnings.find((w) => w.code === "latency_spike")).toBeUndefined();
  });
});

describe("captureContent", () => {
  it("captures conversation content by default", () => {
    const step = build([openaiCall(1000, 100)]).steps[0] as LLMStep;
    expect(step.content?.messages[0]?.content).toBe("hi");
  });

  it("skips content when the caller opts out (the live-frame hot path)", () => {
    const step = build([openaiCall(1000, 100)], { captureContent: false }).steps[0] as LLMStep;
    expect(step.content).toBeNull();
  });
});
