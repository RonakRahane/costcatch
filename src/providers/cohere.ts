/**
 * Cohere provider parser.
 *
 * Handles: api.cohere.com
 * Response format: Cohere's Chat v2 API.
 *
 * Key differences:
 * - Token fields: usage.tokens.input_tokens / output_tokens
 * - Tool calls: tool_calls array at top level with name + parameters
 * - Finish reason: finish_reason at top level
 */

import type { Provider, ParsedRequest, ParsedLLMCall } from "../types/provider.js";
import type { ToolCall } from "../types/trace.js";
import { getString, getNumber, getObject, getArray, getBoolean } from "./base.js";

export const cohereProvider: Provider = {
  name: "cohere",

  urlPatterns: [/api\.cohere\.com/],

  parseRequest(body: unknown): ParsedRequest {
    return {
      model: getString(body, "model", "unknown"),
      isStreaming: getBoolean(body, "stream"),
    };
  },

  parseResponse(body: unknown, request: ParsedRequest): ParsedLLMCall {
    // Cohere v2 nests tokens under usage.tokens
    const usage = getObject(body, "usage");
    const tokens = usage ? getObject(usage, "tokens") : null;

    const inputTokens = tokens ? getNumber(tokens, "input_tokens") : null;
    const outputTokens = tokens ? getNumber(tokens, "output_tokens") : null;

    const finishReason = getString(body, "finish_reason", "unknown");
    const toolCalls = parseCohereToolCalls(body);

    return {
      provider: "cohere",
      model: request.model,
      inputTokens,
      outputTokens,
      cachedTokens: null,
      toolCalls,
      isStreaming: request.isStreaming,
      finishReason,
    };
  },
};

/**
 * Parse tool calls from Cohere's format.
 * Cohere uses a top-level tool_calls array with name + parameters.
 */
function parseCohereToolCalls(body: unknown): ToolCall[] {
  const toolCallsRaw = getArray(body, "tool_calls");
  const result: ToolCall[] = [];

  for (const tc of toolCallsRaw) {
    const name = getString(tc, "name", "unknown");
    const parameters = getObject(tc, "parameters");
    result.push({ name, input: parameters ?? {} });
  }

  return result;
}
