/**
 * OpenAI provider parser.
 *
 * Handles: api.openai.com and Azure OpenAI (*.openai.azure.com).
 * Response format: standard OpenAI chat completions.
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

export const openaiProvider: Provider = {
  name: "openai",

  urlPatterns: [
    /api\.openai\.com/,
    /\.openai\.azure\.com/,
    /\.azure-api\.net.*openai/,
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

    // Extract token counts from usage object
    const inputTokens = usage ? getNumber(usage, "prompt_tokens") : null;
    const outputTokens = usage ? getNumber(usage, "completion_tokens") : null;

    // OpenAI reports cached tokens under usage.prompt_tokens_details.cached_tokens
    let cachedTokens: number | null = null;
    if (usage) {
      const promptDetails = getObject(usage, "prompt_tokens_details");
      if (promptDetails) {
        cachedTokens = getNumber(promptDetails, "cached_tokens");
      }
    }

    // Extract finish reason
    const finishReason = firstChoice
      ? getString(firstChoice, "finish_reason", "unknown")
      : "unknown";

    // Extract tool calls from the assistant message
    const toolCalls = message ? parseOpenAIToolCalls(message) : [];

    return {
      provider: "openai",
      model: getString(body, "model", request.model),
      inputTokens,
      outputTokens,
      cachedTokens,
      toolCalls,
      isStreaming: request.isStreaming,
      finishReason,
    };
  },
};
