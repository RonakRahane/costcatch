/**
 * Compare-last + show renderer tests.
 *
 * Tests the semantic step-matching strategy (match by model+tool-names
 * fingerprint, not by index) and the show renderer backward compatibility.
 */

import { describe, it, expect } from "vitest";
import { matchSteps } from "../../../src/core/compare-last.js";
import { renderShow } from "../../../src/renderers/show.js";
import type { Trace, LLMStep, StepContent } from "../../../src/types/trace.js";

function makeTrace(steps: Partial<LLMStep>[]): Trace {
  return {
    runId: "test-run",
    script: "test.py",
    runtime: "python",
    durationMs: 5000,
    totalCostUsd: 0.10,
    startedAt: new Date().toISOString(),
    command: "python test.py",
    summary: {
      llmCalls: steps.length,
      toolCalls: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalSteps: steps.length,
    },
    warnings: [],
    steps: steps.map((s, i) => ({
      type: "llm" as const,
      id: i + 1,
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
      ...s,
    })),
  };
}

describe("matchSteps — semantic step matching", () => {
  it("matches steps by model + tool names, not index", () => {
    const before = makeTrace([
      { model: "gpt-4o", toolCalls: [{ name: "search", input: {} }] },
      { model: "gpt-4o", toolCalls: [] },
    ]);
    const after = makeTrace([
      { model: "gpt-4o", toolCalls: [] },  // was step 2 in before
      { model: "gpt-4o", toolCalls: [{ name: "search", input: {} }] },  // was step 1
      { model: "gpt-4o", toolCalls: [{ name: "calculate", input: {} }] },  // NEW
    ]);

    const pairs = matchSteps(before, after);

    // The search-calling step should match with the search-calling step
    const searchPair = pairs.find(
      (p) => p.before?.toolCalls.some((tc) => tc.name === "search") &&
             p.after?.toolCalls.some((tc) => tc.name === "search"),
    );
    expect(searchPair).toBeDefined();

    // The new calculate step should have no 'before'
    const newStep = pairs.find(
      (p) => p.before === null && p.after?.toolCalls.some((tc) => tc.name === "calculate"),
    );
    expect(newStep).toBeDefined();
  });

  it("handles identical step counts", () => {
    const before = makeTrace([{ model: "gpt-4o" }, { model: "gpt-4o" }]);
    const after = makeTrace([{ model: "gpt-4o" }, { model: "gpt-4o" }]);

    const pairs = matchSteps(before, after);
    expect(pairs).toHaveLength(2);
    expect(pairs.every((p) => p.before !== null && p.after !== null)).toBe(true);
  });

  it("handles removed steps", () => {
    const before = makeTrace([
      { model: "gpt-4o", toolCalls: [{ name: "search", input: {} }] },
      { model: "gpt-4o", toolCalls: [] },
    ]);
    const after = makeTrace([
      { model: "gpt-4o", toolCalls: [] },
    ]);

    const pairs = matchSteps(before, after);
    const removed = pairs.find((p) => p.after === null);
    expect(removed).toBeDefined();
    expect(removed!.before!.toolCalls[0].name).toBe("search");
  });

  it("handles empty traces", () => {
    const before = makeTrace([]);
    const after = makeTrace([]);
    expect(matchSteps(before, after)).toHaveLength(0);
  });
});

describe("renderShow — backward compatibility", () => {
  it("shows 'no content captured' for old traces without content", () => {
    const trace = makeTrace([
      { model: "gpt-4o", content: null },
    ]);

    const output = renderShow(trace, { useColor: false });
    expect(output).toContain("no content captured");
    expect(output).toContain("re-run");
  });

  it("renders content when available", () => {
    const content: StepContent = {
      system: "You are helpful.",
      messages: [{ role: "user", content: "Hello!" }],
      output: "Hi there!",
      truncated: false,
    };
    const trace = makeTrace([
      { model: "gpt-4o", content },
    ]);

    const output = renderShow(trace, { useColor: false });
    expect(output).toContain("You are helpful.");
    expect(output).toContain("Hello!");
    expect(output).toContain("Hi there!");
  });

  it("renders error information", () => {
    const trace = makeTrace([
      {
        model: "gpt-4o",
        statusCode: 429,
        error: { type: "rate_limit_error", message: "Too many requests" },
        content: null,
      },
    ]);

    const output = renderShow(trace, { useColor: false });
    expect(output).toContain("429");
    expect(output).toContain("rate_limit_error");
    expect(output).toContain("Too many requests");
  });

  it("grep filters to matching steps only", () => {
    const trace = makeTrace([
      {
        id: 1,
        model: "gpt-4o",
        content: {
          system: null,
          messages: [{ role: "user", content: "Search for cats" }],
          output: "Found 10 cats.",
          truncated: false,
        },
      },
      {
        id: 2,
        model: "gpt-4o",
        content: {
          system: null,
          messages: [{ role: "user", content: "Search for dogs" }],
          output: "Found 5 dogs.",
          truncated: false,
        },
      },
    ]);

    const output = renderShow(trace, { grep: "cats", useColor: false });
    expect(output).toContain("cats");
    expect(output).not.toContain("dogs");
  });

  it("renders retry markers", () => {
    const trace = makeTrace([
      { id: 1, model: "gpt-4o", content: null },
      { id: 2, model: "gpt-4o", content: null, retryOf: 1 },
    ]);

    const output = renderShow(trace, { step: 2, useColor: false });
    expect(output).toContain("RETRY of step 1");
  });
});
