/**
 * Gemini model resolution.
 *
 * Gemini names the model in the URL PATH, not the request body. The parser used
 * to read only the body, so every Gemini call was labelled "gemini" with an
 * unknown price — the cost column was permanently `$?.??` for Google users.
 */

import { describe, it, expect } from "vitest";
import { googleProvider } from "../../../src/providers/google.js";
import { buildTrace } from "../../../src/core/trace-builder.js";
import type { LLMStep, RawHttpCall } from "../../../src/types/trace.js";

const GENERATIVE_LANGUAGE =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
const VERTEX =
  "https://us-central1-aiplatform.googleapis.com/v1/projects/p/locations/us-central1/publishers/google/models/gemini-1.5-pro:streamGenerateContent";

describe("googleProvider.parseRequest", () => {
  it("reads the model from a Generative Language URL", () => {
    expect(googleProvider.parseRequest({}, GENERATIVE_LANGUAGE).model).toBe("gemini-2.0-flash");
  });

  it("reads the model from a Vertex AI URL", () => {
    expect(googleProvider.parseRequest({}, VERTEX).model).toBe("gemini-1.5-pro");
  });

  it("detects streaming from the method suffix", () => {
    expect(googleProvider.parseRequest({}, VERTEX).isStreaming).toBe(true);
    expect(googleProvider.parseRequest({}, GENERATIVE_LANGUAGE).isStreaming).toBe(false);
  });

  it("ignores query strings and fragments", () => {
    const url = `${GENERATIVE_LANGUAGE}?key=secret&alt=sse`;
    expect(googleProvider.parseRequest({}, url).model).toBe("gemini-2.0-flash");
  });

  it("falls back to the body when the URL names no model", () => {
    const url = "https://generativelanguage.googleapis.com/v1beta/generateContent";
    expect(googleProvider.parseRequest({ model: "models/gemini-1.5-flash" }, url).model).toBe(
      "gemini-1.5-flash",
    );
  });

  it("falls back to a generic label when nothing names a model", () => {
    expect(googleProvider.parseRequest({}, "https://generativelanguage.googleapis.com/v1beta/x").model).toBe(
      "gemini",
    );
  });
});

describe("Gemini calls end up priced", () => {
  it("resolves a real model name and a non-null cost through buildTrace", () => {
    const call: RawHttpCall = {
      url: GENERATIVE_LANGUAGE,
      method: "POST",
      requestBody: { contents: [{ role: "user", parts: [{ text: "hi" }] }] },
      responseBody: {
        candidates: [{ content: { parts: [{ text: "hello" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 },
      },
      statusCode: 200,
      startMs: 1000,
      endMs: 1500,
      isStreaming: false,
    };

    const trace = buildTrace([call], "agent.py", "python", "python agent.py", new Date().toISOString());
    const step = trace.steps[0] as LLMStep;

    expect(step.provider).toBe("google");
    expect(step.model).toBe("gemini-2.0-flash");
    expect(step.inputTokens).toBe(100);
    expect(step.outputTokens).toBe(20);
    // The point of the fix: a real model name means a real price.
    expect(step.costUsd).not.toBeNull();
    expect(trace.totalCostUsd).not.toBeNull();
  });
});
