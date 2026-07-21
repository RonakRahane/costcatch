// Parser for Anthropic Messages API replies.

import type { Provider, ParsedRequest, ParsedLLMCall } from "../types/provider.js";
import type { ToolCall } from "../types/trace.js";
import {
  getString,
  getNumber,
  getObject,
  getArray,
  parseBodyRequest,
  parseOpenAICompatibleResponse,
  unwrapResponsesApi,
} from "./base.js";

// A Messages API reply from any host, such as a proxy or Vertex AI. OpenAI replies share field
// names, so this needs `type: "message"` or `input_tokens` without `prompt_tokens`.
export function isAnthropicMessage(body: unknown): boolean {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return false;
  const rec = body as Record<string, unknown>;
  if (!Array.isArray(rec.content) || unwrapResponsesApi(body) !== null) return false;
  if (rec.type === "message") return true;
  const usage = getObject(body, "usage");
  return usage !== null && typeof usage.input_tokens === "number" && !("prompt_tokens" in usage);
}

export const anthropicProvider: Provider = {
  name: "anthropic",

  urlPatterns: [/api\.anthropic\.com/],

  parseRequest: parseBodyRequest,

  parseResponse(body: unknown, request: ParsedRequest): ParsedLLMCall {
    // The OpenAI-compatible endpoint replies in OpenAI's format, and a reassembled stream also
    // carries an OpenAI-shaped copy, so check the shape.
    if (!isAnthropicMessage(body) && Array.isArray((body as Record<string, unknown> | null)?.choices)) {
      return parseOpenAICompatibleResponse("anthropic", body, request);
    }

    const usage = getObject(body, "usage");

    const outputTokens = usage ? getNumber(usage, "output_tokens") : null;

    // input_tokens leaves out cache reads and writes, so add them back to match OpenAI's totals.
    const cachedTokens = usage ? getNumber(usage, "cache_read_input_tokens") : null;
    const cacheWrite = usage ? getNumber(usage, "cache_creation_input_tokens") : null;
    const rawInput = usage ? getNumber(usage, "input_tokens") : null;
    const inputTokens =
      rawInput === null ? null : rawInput + (cachedTokens ?? 0) + (cacheWrite ?? 0);

    const stopReason = getString(body, "stop_reason", "unknown");

    const toolCalls = parseAnthropicToolCalls(body);

    return {
      provider: "anthropic",
      model: getString(body, "model", request.model),
      inputTokens,
      outputTokens,
      cachedTokens,
      cacheWriteTokens: cacheWrite,
      // Thinking tokens are already counted in output_tokens.
      reasoningTokens: usage ? getNumber(getObject(usage, "output_tokens_details"), "thinking_tokens") : null,
      toolCalls,
      isStreaming: request.isStreaming,
      finishReason: stopReason,
      billing: {
        cacheWrite1hTokens: getNumber(getObject(usage, "cache_creation"), "ephemeral_1h_input_tokens"),
        serviceTier: getString(usage, "service_tier") || null,
        inferenceGeo: getString(usage, "inference_geo") || null,
        speed: getString(usage, "speed") || null,
        // Web searches are billed per search on top of tokens. Web fetches cost only their tokens.
        webSearches: getNumber(getObject(usage, "server_tool_use"), "web_search_requests"),
      },
      usage,
    };
  },
};

function parseAnthropicToolCalls(body: unknown): ToolCall[] {
  const content = getArray(body, "content");
  const result: ToolCall[] = [];

  for (const block of content) {
    if (getString(block, "type") !== "tool_use") continue;

    const name = getString(block, "name", "unknown");
    const inputObj = getObject(block, "input");
    const input: Record<string, unknown> = inputObj ?? {};
    const id = getString(block, "id");

    result.push(id ? { name, input, id } : { name, input });
  }

  return result;
}
