/**
 * Generic (fallback) provider parser.
 *
 * Catches any OpenAI-compatible endpoint not matched by a specific provider.
 * This includes: LiteLLM proxies, vLLM, text-generation-inference,
 * Anyscale, Together.ai, Fireworks, and any other provider that uses
 * the OpenAI chat completions format.
 *
 * Uses the same parsing logic as OpenAI since these all follow the same spec.
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

export const genericProvider: Provider = {
  name: "generic",

  // Match any URL with /chat/completions or /v1/messages
  urlPatterns: [
    /\/chat\/completions/,
    /\/v1\/completions/,
    /\/v1\/messages/,
  ],

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

    // Try OpenAI-style token fields first, then Anthropic-style
    let inputTokens = usage ? getNumber(usage, "prompt_tokens") : null;
    let outputTokens = usage ? getNumber(usage, "completion_tokens") : null;

    if (inputTokens === null && usage) {
      inputTokens = getNumber(usage, "input_tokens");
    }
    if (outputTokens === null && usage) {
      outputTokens = getNumber(usage, "output_tokens");
    }

    const finishReason = firstChoice
      ? getString(firstChoice, "finish_reason", "unknown")
      : "unknown";

    const toolCalls = message ? parseOpenAIToolCalls(message) : [];

    return {
      provider: "generic",
      model: getString(body, "model", request.model),
      inputTokens,
      outputTokens,
      cachedTokens: null,
      toolCalls,
      isStreaming: request.isStreaming,
      finishReason,
    };
  },
};
