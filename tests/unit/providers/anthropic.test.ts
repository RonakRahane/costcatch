import { describe, it, expect } from "vitest";
import { anthropicProvider } from "../../../src/providers/anthropic.js";
import mockResponse from "../../fixtures/mock-anthropic-response.json";

describe("Anthropic Provider", () => {
  describe("urlPatterns", () => {
    it("matches api.anthropic.com", () => {
      const matches = anthropicProvider.urlPatterns.some((p) =>
        p.test("https://api.anthropic.com/v1/messages"),
      );
      expect(matches).toBe(true);
    });

    it("does not match OpenAI", () => {
      const matches = anthropicProvider.urlPatterns.some((p) =>
        p.test("https://api.openai.com/v1/chat/completions"),
      );
      expect(matches).toBe(false);
    });
  });

  describe("parseRequest", () => {
    it("extracts model and streaming flag", () => {
      const result = anthropicProvider.parseRequest({
        model: "claude-sonnet-4-20250514",
        stream: false,
      });

      expect(result.model).toBe("claude-sonnet-4-20250514");
      expect(result.isStreaming).toBe(false);
    });
  });

  describe("parseResponse", () => {
    it("extracts input and output tokens (Anthropic field names)", () => {
      const request = { model: "claude-sonnet-4-20250514", isStreaming: false };
      const result = anthropicProvider.parseResponse(mockResponse, request);

      expect(result.inputTokens).toBe(2847);
      expect(result.outputTokens).toBe(124);
    });

    it("extracts cache_read_input_tokens as cachedTokens", () => {
      const request = { model: "claude-sonnet-4-20250514", isStreaming: false };
      const result = anthropicProvider.parseResponse(mockResponse, request);

      expect(result.cachedTokens).toBe(512);
    });

    it("extracts tool_use content blocks as tool calls", () => {
      const request = { model: "claude-sonnet-4-20250514", isStreaming: false };
      const result = anthropicProvider.parseResponse(mockResponse, request);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe("web_search");
      expect(result.toolCalls[0].input).toEqual({ query: "Tesla Q4 2024 revenue" });
    });

    it("uses stop_reason instead of finish_reason", () => {
      const request = { model: "claude-sonnet-4-20250514", isStreaming: false };
      const result = anthropicProvider.parseResponse(mockResponse, request);

      expect(result.finishReason).toBe("tool_use");
    });

    it("sets provider to anthropic", () => {
      const request = { model: "claude-sonnet-4-20250514", isStreaming: false };
      const result = anthropicProvider.parseResponse(mockResponse, request);

      expect(result.provider).toBe("anthropic");
    });

    it("handles response with text content (no tool calls)", () => {
      const textResponse = {
        model: "claude-sonnet-4-20250514",
        content: [{ type: "text", text: "Hello world" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 50 },
      };

      const request = { model: "claude-sonnet-4-20250514", isStreaming: false };
      const result = anthropicProvider.parseResponse(textResponse, request);

      expect(result.toolCalls).toHaveLength(0);
      expect(result.finishReason).toBe("end_turn");
      expect(result.inputTokens).toBe(100);
    });
  });
});
