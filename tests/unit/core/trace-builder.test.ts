/**
 * Trace builder tests — content capture and error/retry wiring.
 *
 * Verifies that buildTrace:
 *   - Captures content (system, messages, output) from raw HTTP calls
 *   - Detects errors from non-2xx status codes
 *   - Marks retries correctly (same fingerprint → retryOf)
 *   - Handles captureContent=false (opt-out)
 *   - Is backward-compatible with old calls missing statusCode
 */

import { describe, it, expect } from "vitest";
import { buildTrace } from "../../../src/core/trace-builder.js";
import type { RawHttpCall, LLMStep } from "../../../src/types/trace.js";

function makeRawCall(overrides: Partial<RawHttpCall> = {}): RawHttpCall {
  return {
    url: "https://api.openai.com/v1/chat/completions",
    method: "POST",
    requestBody: {
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hello!" },
      ],
    },
    responseBody: {
      choices: [{ message: { role: "assistant", content: "Hi!" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
      model: "gpt-4o",
    },
    statusCode: 200,
    startMs: 1000,
    endMs: 2000,
    isStreaming: false,
    ...overrides,
  };
}

describe("buildTrace — content capture", () => {
  it("captures content by default", () => {
    const trace = buildTrace([makeRawCall()], "test.py", "python", "python test.py", new Date().toISOString());
    const step = trace.steps[0] as LLMStep;

    expect(step.content).not.toBeNull();
    expect(step.content!.system).toBe("You are helpful.");
    expect(step.content!.messages).toHaveLength(1);
    expect(step.content!.messages[0].role).toBe("user");
    expect(step.content!.messages[0].content).toBe("Hello!");
    expect(step.content!.output).toBe("Hi!");
  });

  it("skips content when captureContent=false", () => {
    const trace = buildTrace(
      [makeRawCall()], "test.py", "python", "python test.py",
      new Date().toISOString(), { captureContent: false },
    );
    const step = trace.steps[0] as LLMStep;
    expect(step.content).toBeNull();
  });
});

describe("buildTrace — error detection", () => {
  it("captures error for non-2xx status code", () => {
    const call = makeRawCall({
      statusCode: 429,
      responseBody: {
        error: { message: "Rate limit exceeded", type: "rate_limit_error" },
      },
    });
    const trace = buildTrace([call], "test.py", "python", "python test.py", new Date().toISOString());
    const step = trace.steps[0] as LLMStep;

    expect(step.statusCode).toBe(429);
    expect(step.error).not.toBeNull();
    expect(step.error!.type).toBe("rate_limit_error");
    expect(step.error!.message).toContain("Rate limit exceeded");
  });

  it("does NOT set error for HTTP 200", () => {
    const trace = buildTrace([makeRawCall()], "test.py", "python", "python test.py", new Date().toISOString());
    const step = trace.steps[0] as LLMStep;
    expect(step.error).toBeNull();
  });
});

describe("buildTrace — retry detection", () => {
  it("marks a second call with the same fingerprint as retryOf", () => {
    const call1 = makeRawCall({ startMs: 1000, endMs: 2000 });
    const call2 = makeRawCall({ startMs: 3000, endMs: 4000 });

    const trace = buildTrace(
      [call1, call2], "test.py", "python", "python test.py",
      new Date().toISOString(),
    );

    const step1 = trace.steps[0] as LLMStep;
    const step2 = trace.steps[1] as LLMStep;

    expect(step1.retryOf).toBeNull();
    expect(step2.retryOf).toBe(step1.id);
  });

  it("does NOT mark different prompts as retries", () => {
    const call1 = makeRawCall({
      requestBody: {
        model: "gpt-4o",
        messages: [{ role: "user", content: "First question" }],
      },
      startMs: 1000,
      endMs: 2000,
    });
    const call2 = makeRawCall({
      requestBody: {
        model: "gpt-4o",
        messages: [{ role: "user", content: "Different question" }],
      },
      startMs: 3000,
      endMs: 4000,
    });

    const trace = buildTrace(
      [call1, call2], "test.py", "python", "python test.py",
      new Date().toISOString(),
    );

    const step2 = trace.steps[1] as LLMStep;
    expect(step2.retryOf).toBeNull();
  });
});
