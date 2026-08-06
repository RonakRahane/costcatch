/**
 * OpenRouter provider parser.
 *
 * Handles: openrouter.ai/api/v1
 * Response format: OpenAI-compatible, but the response's `model` field
 * contains the actual model used (since OpenRouter routes to 200+ models).
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

export const openrouterProvider: Provider = {
  name: "openrouter",

  urlPatterns: [/openrouter\.ai/],

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

    const inputTokens = usage ? getNumber(usage, "prompt_tokens") : null;
    const outputTokens = usage ? getNumber(usage, "completion_tokens") : null;

    // OpenRouter returns prompt-cache stats in two possible places:
    //   1. usage.prompt_tokens_details.cached_tokens  (OpenAI-style)
    //   2. usage.cache_read_input_tokens              (Anthropic-style passthrough)
    let cachedTokens: number | null = null;
    if (usage) {
      const promptDetails = getObject(usage, "prompt_tokens_details");
      if (promptDetails) {
        cachedTokens = getNumber(promptDetails, "cached_tokens");
      }
      // Fallback: Anthropic-style cache field
      if (cachedTokens === null) {
        cachedTokens = getNumber(usage, "cache_read_input_tokens");
      }
    }

    const finishReason = firstChoice
      ? getString(firstChoice, "finish_reason", "unknown")
      : "unknown";

    const toolCalls = message ? parseOpenAIToolCalls(message) : [];

    // OpenRouter's response `model` field contains the actual model used,
    // which may differ from what was requested (e.g. fallback routing).
    const actualModel = getString(body, "model", request.model);

    return {
      provider: "openrouter",
      model: actualModel,
      inputTokens,
      outputTokens,
      cachedTokens,
      toolCalls,
      isStreaming: request.isStreaming,
      finishReason,
    };
  },
};

