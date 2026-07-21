// Parser for Cohere Chat v2 and Embed replies.

import type { Provider, ParsedRequest, ParsedLLMCall } from "../types/provider.js";
import type { ToolCall } from "../types/trace.js";
import { getString, getNumber, getObject, getArray, parseBodyRequest, parseOpenAIToolCalls } from "./base.js";

export const cohereProvider: Provider = {
  name: "cohere",

  // Older SDK versions still call api.cohere.ai.
  urlPatterns: [/api\.cohere\.com/, /api\.cohere\.ai/],

  parseRequest: parseBodyRequest,

  parseResponse(body: unknown, request: ParsedRequest): ParsedLLMCall {
    const usage = getObject(body, "usage");
    // Prefer billed_units, because tokens also counts Cohere's own prompt template.
    const tokens = (usage ? getObject(usage, "billed_units") : null) ?? (usage ? getObject(usage, "tokens") : null);

    let inputTokens = tokens ? getNumber(tokens, "input_tokens") : null;
    let outputTokens = tokens ? getNumber(tokens, "output_tokens") : null;

    if (inputTokens === null) {
      const meta = getObject(body, "meta");
      if (meta) {
        const billedUnits = getObject(meta, "billed_units");
        if (billedUnits) {
          inputTokens = getNumber(billedUnits, "input_tokens");
          // Only embeddings leave out output_tokens, so defaulting to 0 here is safe.
          if (inputTokens !== null) outputTokens = getNumber(billedUnits, "output_tokens") ?? 0;
        }
        // Older SDK versions put the counts in meta.tokens.
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
      reasoningTokens: null,
      cachedTokens: null,
      toolCalls,
      isStreaming: request.isStreaming,
      finishReason,
      usage: usage ?? getObject(body, "meta"),
    };
  },
};

// Chat v2 puts tool calls on message.tool_calls. v1 put { name, parameters } at the top level.
function parseCohereToolCalls(body: unknown): ToolCall[] {
  const message = getObject(body, "message");
  if (message && getArray(message, "tool_calls").length > 0) return parseOpenAIToolCalls(message);

  const toolCallsRaw = getArray(body, "tool_calls");
  const result: ToolCall[] = [];

  for (const tc of toolCallsRaw) {
    const name = getString(tc, "name", "unknown");
    const parameters = getObject(tc, "parameters");
    result.push({ name, input: parameters ?? {} });
  }

  return result;
}

