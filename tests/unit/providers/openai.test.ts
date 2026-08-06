import { describe, it, expect } from "vitest";
import { openaiProvider } from "../../../src/providers/openai.js";
import mockResponse from "../../fixtures/mock-openai-response.json";

describe("OpenAI Provider", () => {
  describe("urlPatterns", () => {
    it("matches api.openai.com", () => {
      const matches = openaiProvider.urlPatterns.some((p) =>
        p.test("https://api.openai.com/v1/chat/completions"),
      );
      expect(matches).toBe(true);
    });

    it("matches Azure OpenAI", () => {
      const matches = openaiProvider.urlPatterns.some((p) =>
        p.test("https://my-resource.openai.azure.com/openai/deployments/gpt-4o/chat/completions"),
      );
      expect(matches).toBe(true);
    });

    it("does not match Anthropic", () => {
      const matches = openaiProvider.urlPatterns.some((p) =>
        p.test("https://api.anthropic.com/v1/messages"),
      );
      expect(matches).toBe(false);
    });
  });

  describe("parseRequest", () => {
    it("extracts model and streaming flag", () => {
      const result = openaiProvider.parseRequest({
        model: "gpt-4o",
        stream: true,
        messages: [{ role: "user", content: "Hello" }],
      });

      expect(result.model).toBe("gpt-4o");
      expect(result.isStreaming).toBe(true);
    });

    it("defaults streaming to false", () => {
      const result = openaiProvider.parseRequest({ model: "gpt-4o" });
      expect(result.isStreaming).toBe(false);
    });
  });

  describe("parseResponse", () => {
    it("extracts token counts from usage", () => {
      const request = { model: "gpt-4o", isStreaming: false };
      const result = openaiProvider.parseResponse(mockResponse, request);

      expect(result.inputTokens).toBe(1203);
      expect(result.outputTokens).toBe(87);
    });

    it("extracts cached tokens from prompt_tokens_details", () => {
      const request = { model: "gpt-4o", isStreaming: false };
      const result = openaiProvider.parseResponse(mockResponse, request);

      expect(result.cachedTokens).toBe(256);
    });

    it("extracts tool calls with parsed arguments", () => {
      const request = { model: "gpt-4o", isStreaming: false };
      const result = openaiProvider.parseResponse(mockResponse, request);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe("web_search");
      expect(result.toolCalls[0].input).toEqual({ query: "Tesla Q4 2024 revenue" });
    });

    it("extracts finish reason", () => {
      const request = { model: "gpt-4o", isStreaming: false };
      const result = openaiProvider.parseResponse(mockResponse, request);

      expect(result.finishReason).toBe("tool_calls");
    });

    it("extracts model from response (may differ from request)", () => {
      const request = { model: "gpt-4o", isStreaming: false };
      const result = openaiProvider.parseResponse(mockResponse, request);

      expect(result.model).toBe("gpt-4o-2024-08-06");
    });

    it("handles missing usage gracefully", () => {
      const request = { model: "gpt-4o", isStreaming: true };
      const result = openaiProvider.parseResponse({ choices: [] }, request);

      expect(result.inputTokens).toBeNull();
      expect(result.outputTokens).toBeNull();
    });

    it("sets provider to openai", () => {
      const request = { model: "gpt-4o", isStreaming: false };
      const result = openaiProvider.parseResponse(mockResponse, request);

      expect(result.provider).toBe("openai");
    });
  });
});
