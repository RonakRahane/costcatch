/**
 * Cohere provider parser.
 *
 * Handles: api.cohere.com
 * Response format: Cohere's Chat v2 API + Embed API.
 *
 * Key differences:
 * - Chat tokens: usage.tokens.input_tokens / output_tokens
 * - Embed tokens: meta.billed_units.input_tokens (output = 0)
 * - Tool calls: tool_calls array at top level with name + parameters
 * - Finish reason: finish_reason at top level
 */

import type { Provider, ParsedRequest, ParsedLLMCall } from "../types/provider.js";
import type { ToolCall } from "../types/trace.js";
import { getString, getNumber, getObject, getArray, getBoolean } from "./base.js";

export const cohereProvider: Provider = {
  name: "cohere",

  // Cohere serves the same API from both hosts; older SDK versions use .ai.
  urlPatterns: [/api\.cohere\.com/, /api\.cohere\.ai/],

  parseRequest(body: unknown, _url?: string): ParsedRequest {
    return {
      model: getString(body, "model", "unknown"),
      isStreaming: getBoolean(body, "stream"),
    };
  },

  parseResponse(body: unknown, request: ParsedRequest): ParsedLLMCall {
    // ── Try Chat v2 format first: usage.tokens.{input_tokens, output_tokens}
    const usage = getObject(body, "usage");
    const tokens = usage ? getObject(usage, "tokens") : null;

    let inputTokens = tokens ? getNumber(tokens, "input_tokens") : null;
    let outputTokens = tokens ? getNumber(tokens, "output_tokens") : null;

    // ── Embedding format: meta.billed_units.input_tokens (no output)
    if (inputTokens === null) {
      const meta = getObject(body, "meta");
      if (meta) {
        const billedUnits = getObject(meta, "billed_units");
        if (billedUnits) {
          inputTokens = getNumber(billedUnits, "input_tokens");
          // Embeddings produce no output tokens
          if (inputTokens !== null) outputTokens = 0;
        }
        // Fallback: meta.tokens.input_tokens (some SDK versions)
        if (inputTokens === null) {
          const metaTokens = getObject(meta, "tokens");
          if (metaTokens) {
            inputTokens = getNumber(metaTokens, "input_tokens");
            if (inputTokens !== null) outputTokens = getNumber(metaTokens, "output_tokens") ?? 0;
          }
        }
      }
    }

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

