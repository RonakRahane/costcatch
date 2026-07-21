// Parser for Ollama's native /api/chat on port 11434. Local calls cost nothing.

import type { Provider, ParsedRequest, ParsedLLMCall } from "../types/provider.js";
import type { ToolCall } from "../types/trace.js";
import { getString, getNumber, getObject, getArray, parseBodyRequest, parseOpenAICompatibleResponse } from "./base.js";

export const ollamaProvider: Provider = {
  name: "ollama",

  // Match the port on any host, since docker-compose setups use names like http://ollama:11434.
  urlPatterns: [/:11434(?:[/?#]|$)/],

  parseRequest: parseBodyRequest,

  parseResponse(body: unknown, request: ParsedRequest): ParsedLLMCall {
    if (Array.isArray((body as Record<string, unknown> | null)?.choices)) {
      return { ...parseOpenAICompatibleResponse("ollama", body, request), reportedCostUsd: 0 };
    }

    const inputTokens = getNumber(body, "prompt_eval_count");
    const outputTokens = getNumber(body, "eval_count");

    const message = getObject(body, "message");
    const toolCalls = message ? parseOllamaToolCalls(message) : [];

    // Older builds send only "done": true, with no done_reason.
    const doneReason = getString(body, "done_reason", "stop");

    return {
      provider: "ollama",
      // Report 0 rather than unknown, or --max-cost would refuse to evaluate the run.
      reportedCostUsd: 0,
      model: getString(body, "model", request.model),
      inputTokens,
      outputTokens,
      reasoningTokens: null,
      cachedTokens: null,
      toolCalls,
      isStreaming: request.isStreaming,
      finishReason: doneReason,
      usage: ollamaUsage(body),
    };
  },
};

// Ollama reports these at the top level. Durations are in nanoseconds.
const OLLAMA_USAGE = new Set(["total_duration", "load_duration", "prompt_eval_count", "prompt_eval_duration", "eval_count", "eval_duration"]);

function ollamaUsage(body: unknown): Record<string, unknown> | null {
  if (body === null || typeof body !== "object") return null;
  const usage = Object.fromEntries(Object.entries(body).filter(([key]) => OLLAMA_USAGE.has(key)));
  return Object.keys(usage).length > 0 ? usage : null;
}

// Same as OpenAI's tool_calls, except arguments is an object instead of a JSON string.
function parseOllamaToolCalls(message: Record<string, unknown>): ToolCall[] {
  const toolCallsRaw = getArray(message, "tool_calls");
  const result: ToolCall[] = [];

  for (const tc of toolCallsRaw) {
    const fn = getObject(tc, "function");
    if (!fn) continue;

    const name = getString(fn, "name", "unknown");
    const args = getObject(fn, "arguments");
    result.push({ name, input: args ?? {} });
  }

  return result;
}
