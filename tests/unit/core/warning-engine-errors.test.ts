/**
 * Warning engine tests — focused on error/retry detection and edge cases.
 *
 * Complements the existing warning-engine.test.ts (which covers context growth,
 * duplicates, cost concentration, latency spikes).
 */

import { describe, it, expect } from "vitest";
import { detectWarnings } from "../../../src/core/warning-engine.js";
import type { LLMStep, Step } from "../../../src/types/trace.js";

function makeLLMStep(overrides: Partial<LLMStep> = {}): LLMStep {
  return {
    type: "llm",
    id: 1,
    durationMs: 1000,
    provider: "openai",
    model: "gpt-4o",
    inputTokens: 100,
    outputTokens: 50,
    cachedTokens: null,
    costUsd: 0.01,
    toolCalls: [],
    isStreaming: false,
    finishReason: "stop",
    statusCode: 200,
    error: null,
    content: null,
    retryOf: null,
    ...overrides,
  };
}

describe("detectWarnings — error detection", () => {
  it("flags HTTP 429 as critical http_error", () => {
    const steps: Step[] = [
      makeLLMStep({
        id: 1,
        statusCode: 429,
        error: { type: "rate_limit_error", message: "Too many requests" },
      }),
    ];

    const warnings = detectWarnings(steps);
    const httpError = warnings.find((w) => w.code === "http_error");
    expect(httpError).toBeDefined();
    expect(httpError!.severity).toBe("critical");
    expect(httpError!.message).toContain("HTTP 429");
    expect(httpError!.message).toContain("rate_limit_error");
  });

  it("flags HTTP 500 with no error body", () => {
    const steps: Step[] = [
      makeLLMStep({ id: 1, statusCode: 500, error: null }),
    ];

    const warnings = detectWarnings(steps);
    const httpError = warnings.find((w) => w.code === "http_error");
    expect(httpError).toBeDefined();
    expect(httpError!.message).toContain("HTTP 500");
  });

  it("does NOT flag HTTP 200 as error", () => {
    const steps: Step[] = [
      makeLLMStep({ id: 1, statusCode: 200 }),
    ];

    const warnings = detectWarnings(steps);
    const httpError = warnings.find((w) => w.code === "http_error");
    expect(httpError).toBeUndefined();
  });

  it("does NOT flag steps with no statusCode (backward compat)", () => {
    const steps: Step[] = [
      makeLLMStep({ id: 1, statusCode: undefined }),
    ];

    const warnings = detectWarnings(steps);
    const httpError = warnings.find((w) => w.code === "http_error");
    expect(httpError).toBeUndefined();
  });
});

describe("detectWarnings — retry detection", () => {
  it("flags a retry after a failed step as 'warn'", () => {
    const steps: Step[] = [
      makeLLMStep({
        id: 1,
        statusCode: 429,
        error: { type: "rate_limit_error", message: "Too many requests" },
      }),
      makeLLMStep({
        id: 2,
        statusCode: 200,
        retryOf: 1,
      }),
    ];

    const warnings = detectWarnings(steps);
    const retry = warnings.find((w) => w.code === "retry");
    expect(retry).toBeDefined();
    expect(retry!.severity).toBe("warn");
    expect(retry!.message).toContain("retried step 1");
    expect(retry!.message).toContain("which failed");
  });

  it("flags a redundant re-send (same prompt, no prior error) as 'info'", () => {
    const steps: Step[] = [
      makeLLMStep({ id: 1, statusCode: 200 }),
      makeLLMStep({ id: 2, statusCode: 200, retryOf: 1 }),
    ];

    const warnings = detectWarnings(steps);
    const retry = warnings.find((w) => w.code === "retry");
    expect(retry).toBeDefined();
    expect(retry!.severity).toBe("info");
    expect(retry!.message).toContain("re-sends the same prompt");
  });

  it("does NOT flag non-retry steps", () => {
    const steps: Step[] = [
      makeLLMStep({ id: 1 }),
      makeLLMStep({ id: 2 }),
    ];

    const warnings = detectWarnings(steps);
    const retry = warnings.find((w) => w.code === "retry");
    expect(retry).toBeUndefined();
  });
});

describe("detectWarnings — sorting", () => {
  it("sorts critical before warn before info", () => {
    const steps: Step[] = [
      makeLLMStep({
        id: 1,
        statusCode: 429,
        error: { type: "rate_limit_error", message: "Too many requests" },
      }),
      makeLLMStep({ id: 2, retryOf: 1, statusCode: 200 }),
      makeLLMStep({ id: 3, durationMs: 20_000, statusCode: 200 }),
    ];

    const warnings = detectWarnings(steps);
    if (warnings.length > 1) {
      const severities = warnings.map((w) => w.severity);
      const critIdx = severities.indexOf("critical");
      const warnIdx = severities.indexOf("warn");
      const infoIdx = severities.indexOf("info");
      if (critIdx >= 0 && warnIdx >= 0) expect(critIdx).toBeLessThan(warnIdx);
      if (warnIdx >= 0 && infoIdx >= 0) expect(warnIdx).toBeLessThan(infoIdx);
    }
  });
});

describe("detectWarnings — empty input", () => {
  it("returns no warnings for an empty step list", () => {
    expect(detectWarnings([])).toHaveLength(0);
  });

  it("returns no warnings for a single healthy step", () => {
    const warnings = detectWarnings([makeLLMStep()]);
    const critical = warnings.filter((w) => w.severity === "critical");
    expect(critical).toHaveLength(0);
  });
});
