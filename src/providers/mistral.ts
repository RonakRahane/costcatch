/**
 * Mistral provider parser.
 *
 * Handles: api.mistral.ai
 * Response format: OpenAI-compatible (drop-in).
 */

import type { Provider, ParsedRequest, ParsedLLMCall } from "../types/provider.js";
import {
  getString,
  getNumber,
  getObject,
  getArray,
  getBoolean,
  parseOpenAIToolCalls,
} from "./base.js";

export const mistralProvider: Provider = {
  name: "mistral",

  urlPatterns: [/api\.mistral\.ai/],

  parseRequest(body: unknown): ParsedRequest {
    return {
      model: getString(body, "model", "unknown"),
      isStreaming: getBoolean(body, "stream"),
    };
  },

  parseResponse(body: unknown, request: ParsedRequest): ParsedLLMCall {
    const usage = getObject(body, "usage");
    const choices = getArray(body, "choices");
    const firstChoice = choices.length > 0 ? (choices[0] as Record<string, unknown>) : null;
    const message = firstChoice ? getObject(firstChoice, "message") : null;

    return {
      provider: "mistral",
      model: getString(body, "model", request.model),
      inputTokens: usage ? getNumber(usage, "prompt_tokens") : null,
      outputTokens: usage ? getNumber(usage, "completion_tokens") : null,
      cachedTokens: null,
      toolCalls: message ? parseOpenAIToolCalls(message) : [],
      isStreaming: request.isStreaming,
      finishReason: firstChoice ? getString(firstChoice, "finish_reason", "unknown") : "unknown",
    };
  },
};
