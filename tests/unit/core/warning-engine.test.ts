import { describe, it, expect } from "vitest";
import { detectWarnings } from "../../../src/core/warning-engine.js";
import type { LLMStep } from "../../../src/types/trace.js";

function makeLLMStep(overrides: Partial<LLMStep> & { id: number }): LLMStep {
  return {
    type: "llm", durationMs: 1000, provider: "openai", model: "gpt-4o",
    inputTokens: 100, outputTokens: 50, cachedTokens: null, costUsd: 0.001,
    toolCalls: [], isStreaming: false, finishReason: "stop", ...overrides,
  };
}

describe("Warning Engine", () => {
  it("warns when context grows 3x+", () => {
    const steps = [makeLLMStep({ id: 1, inputTokens: 1000 }), makeLLMStep({ id: 2, inputTokens: 4000 })];
    const w = detectWarnings(steps).find((w) => w.code === "context_growth");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("warn");
  });

  it("flags critical when context grows 10x+", () => {
    const steps = [makeLLMStep({ id: 1, inputTokens: 1000 }), makeLLMStep({ id: 2, inputTokens: 12000 })];
    const w = detectWarnings(steps).find((w) => w.code === "context_growth");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("critical");
  });

  it("detects duplicate tool calls", () => {
    const steps = [
      makeLLMStep({ id: 1, toolCalls: [{ name: "search", input: { q: "Tesla" } }] }),
      makeLLMStep({ id: 2, toolCalls: [{ name: "search", input: { q: "Tesla" } }] }),
    ];
    expect(detectWarnings(steps).find((w) => w.code === "duplicate_tool_call")).toBeDefined();
  });

  it("warns on cost concentration", () => {
    const steps = [makeLLMStep({ id: 1, costUsd: 0.01 }), makeLLMStep({ id: 2, costUsd: 1.5 })];
    expect(detectWarnings(steps).find((w) => w.code === "cost_concentration")).toBeDefined();
  });

  it("detects latency spikes", () => {
    const steps = [makeLLMStep({ id: 1, durationMs: 15000 })];
    expect(detectWarnings(steps, 10000).find((w) => w.code === "latency_spike")).toBeDefined();
  });
});
