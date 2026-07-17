/**
 * Anthropic provider parser.
 *
 * Handles: api.anthropic.com
 * Response format: Anthropic Messages API (different from OpenAI).
 *
 * Key differences from OpenAI:
 * - Token fields: input_tokens / output_tokens (not prompt_tokens / completion_tokens)
 * - Tool calls: content blocks with type "tool_use" (not message.tool_calls)
 * - Finish reason: stop_reason (not finish_reason)
 * - Prompt caching: usage.cache_creation_input_tokens / cache_read_input_tokens
 */

import type { Provider, ParsedRequest, ParsedLLMCall } from "../types/provider.js";
import type { ToolCall } from "../types/trace.js";
import { getString, getNumber, getObject, getArray, getBoolean } from "./base.js";

export const anthropicProvider: Provider = {
  name: "anthropic",

  urlPatterns: [/api\.anthropic\.com/],

  parseRequest(body: unknown): ParsedRequest {
    return {
      model: getString(body, "model", "unknown"),
      isStreaming: getBoolean(body, "stream"),
    };
  },

  parseResponse(body: unknown, request: ParsedRequest): ParsedLLMCall {
    const usage = getObject(body, "usage");

    // Anthropic uses input_tokens / output_tokens
    const inputTokens = usage ? getNumber(usage, "input_tokens") : null;
    const outputTokens = usage ? getNumber(usage, "output_tokens") : null;

    // Anthropic prompt caching: cache_read_input_tokens
    let cachedTokens: number | null = null;
    if (usage) {
      cachedTokens = getNumber(usage, "cache_read_input_tokens");
    }

    // Anthropic uses stop_reason instead of finish_reason
    const stopReason = getString(body, "stop_reason", "unknown");

    // Extract tool calls from content blocks
    const toolCalls = parseAnthropicToolCalls(body);

    return {
      provider: "anthropic",
      model: getString(body, "model", request.model),
      inputTokens,
      outputTokens,
      cachedTokens,
      toolCalls,
      isStreaming: request.isStreaming,
      finishReason: stopReason,
    };
  },
};

/**
 * Parse tool calls from Anthropic's content block format.
 *
 * Anthropic returns tool calls as content blocks with type "tool_use":
 * ```json
 * { "content": [{ "type": "tool_use", "name": "search", "input": { "q": "..." } }] }
 * ```
 */
function parseAnthropicToolCalls(body: unknown): ToolCall[] {
  const content = getArray(body, "content");
  const result: ToolCall[] = [];

  for (const block of content) {
    if (getString(block, "type") !== "tool_use") continue;

    const name = getString(block, "name", "unknown");
    const inputObj = getObject(block, "input");
    const input: Record<string, unknown> = inputObj ?? {};

    result.push({ name, input });
  }

  return result;
}
