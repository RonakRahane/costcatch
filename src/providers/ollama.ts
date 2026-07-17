/**
 * Ollama provider parser.
 *
 * Handles: localhost:11434 (default Ollama port)
 * Response format: Ollama's native /api/chat format.
 *
 * Key differences:
 * - Token fields: prompt_eval_count / eval_count
 * - No cost (local models are free)
 * - Response has `message` at top level (not inside choices[])
 */

import type { Provider, ParsedRequest, ParsedLLMCall } from "../types/provider.js";
import type { ToolCall } from "../types/trace.js";
import { getString, getNumber, getObject, getArray, getBoolean } from "./base.js";

export const ollamaProvider: Provider = {
  name: "ollama",

  urlPatterns: [
    /localhost:11434/,
    /127\.0\.0\.1:11434/,
    /host\.docker\.internal:11434/,
  ],

  parseRequest(body: unknown): ParsedRequest {
    return {
      model: getString(body, "model", "unknown"),
      isStreaming: getBoolean(body, "stream"),
    };
  },

  parseResponse(body: unknown, request: ParsedRequest): ParsedLLMCall {
    // Ollama uses different token field names
    const inputTokens = getNumber(body, "prompt_eval_count");
    const outputTokens = getNumber(body, "eval_count");

    // Ollama's message is at the top level, not inside choices
    const message = getObject(body, "message");
    const toolCalls = message ? parseOllamaToolCalls(message) : [];

    // Ollama uses "done_reason" or just "done": true
    const doneReason = getString(body, "done_reason", "stop");

    return {
      provider: "ollama",
      model: getString(body, "model", request.model),
      inputTokens,
      outputTokens,
      cachedTokens: null,
      toolCalls,
      isStreaming: request.isStreaming,
      finishReason: doneReason,
    };
  },
};

/**
 * Parse tool calls from Ollama's format.
 * Ollama tool calls are in the message.tool_calls array,
 * similar to OpenAI but with arguments as an object (not a string).
 */
function parseOllamaToolCalls(message: Record<string, unknown>): ToolCall[] {
  const toolCallsRaw = getArray(message, "tool_calls");
  const result: ToolCall[] = [];

  for (const tc of toolCallsRaw) {
    const fn = getObject(tc, "function");
    if (!fn) continue;

    const name = getString(fn, "name", "unknown");
    // Ollama passes arguments as an object, not a JSON string
    const args = getObject(fn, "arguments");
    result.push({ name, input: args ?? {} });
  }

  return result;
}
