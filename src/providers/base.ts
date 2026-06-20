// Shared JSON helpers and the parsers for OpenAI chat completions and the Responses API.

import type { ToolCall } from "../types/trace.js";
import type { ParsedRequest, ParsedLLMCall, BillingDetail } from "../types/provider.js";

export function getString(obj: unknown, key: string, fallback: string = ""): string {
  if (obj !== null && typeof obj === "object" && key in obj) {
    const val = (obj as Record<string, unknown>)[key];
    return typeof val === "string" ? val : fallback;
  }
  return fallback;
}

export function getNumber(obj: unknown, key: string): number | null {
  if (obj !== null && typeof obj === "object" && key in obj) {
    const val = (obj as Record<string, unknown>)[key];
    return typeof val === "number" ? val : null;
  }
  return null;
}

export function getObject(obj: unknown, key: string): Record<string, unknown> | null {
  if (obj !== null && typeof obj === "object" && key in obj) {
    const val = (obj as Record<string, unknown>)[key];
    return val !== null && typeof val === "object" ? (val as Record<string, unknown>) : null;
  }
  return null;
}

export function getBoolean(obj: unknown, key: string, fallback: boolean = false): boolean {
  if (obj !== null && typeof obj === "object" && key in obj) {
    const val = (obj as Record<string, unknown>)[key];
    return typeof val === "boolean" ? val : fallback;
  }
  return fallback;
}

export function getArray(obj: unknown, key: string): unknown[] {
  if (obj !== null && typeof obj === "object" && key in obj) {
    const val = (obj as Record<string, unknown>)[key];
    return Array.isArray(val) ? val : [];
  }
  return [];
}

export function parseOpenAIToolCalls(message: unknown): ToolCall[] {
  const toolCallsRaw = getArray(message, "tool_calls");
  const result: ToolCall[] = [];

  for (const tc of toolCallsRaw) {
    const fn = getObject(tc, "function");
    if (!fn) continue;

    const name = getString(fn, "name", "unknown");
    const call: ToolCall = { name, ...parseToolArguments(getString(fn, "arguments", "{}")) };
    const id = getString(tc, "id");
    result.push(id ? { ...call, id } : call);
  }

  return result;
}

function parseToolArguments(argsStr: string): Pick<ToolCall, "input" | "invalidArguments"> {
  // Some providers send empty arguments for a tool with no parameters.
  if (argsStr.trim() === "") return { input: {} };
  try {
    const parsed = JSON.parse(argsStr);
    // null, arrays and plain values parse fine but break Object.entries in the renderers.
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) return { input: parsed as Record<string, unknown> };
  } catch {
  }
  return { input: { _raw: argsStr }, invalidArguments: true };
}

// reasoning_tokens is already part of completion_tokens, so it must not be added to the cost.
export function parseOpenAIReasoningTokens(usage: Record<string, unknown> | null): number | null {
  if (!usage) return null;
  const details = getObject(usage, "completion_tokens_details");
  return details ? getNumber(details, "reasoning_tokens") : null;
}

export function parseOpenAICachedTokens(usage: Record<string, unknown> | null): number | null {
  if (!usage) return null;
  const details = getObject(usage, "prompt_tokens_details");
  return details ? getNumber(details, "cached_tokens") : null;
}

export function parseBodyRequest(body: unknown): ParsedRequest {
  return {
    model: getString(body, "model", "unknown"),
    isStreaming: getBoolean(body, "stream"),
  };
}

// Cache reads are part of prompt_tokens. DeepSeek reports them as prompt_cache_hit_tokens.
export function parseOpenAICompatibleResponse(
  provider: string,
  body: unknown,
  request: ParsedRequest,
): ParsedLLMCall {
  const response = unwrapResponsesApi(body);
  if (response) return parseResponsesApi(provider, response, request);

  const usage = getObject(body, "usage");
  const choices = getArray(body, "choices");
  const firstChoice = choices.length > 0 ? (choices[0] as Record<string, unknown>) : null;
  const message = firstChoice ? getObject(firstChoice, "message") : null;

  return {
    provider,
    model: getString(body, "model", request.model),
    inputTokens: usage ? getNumber(usage, "prompt_tokens") : null,
    outputTokens: usage ? getNumber(usage, "completion_tokens") : null,
    cachedTokens: parseOpenAICachedTokens(usage) ?? (usage ? getNumber(usage, "prompt_cache_hit_tokens") : null),
    reasoningTokens: parseOpenAIReasoningTokens(usage),
    toolCalls: message ? parseOpenAIToolCalls(message) : [],
    isStreaming: request.isStreaming,
    finishReason: firstChoice ? getString(firstChoice, "finish_reason", "unknown") : "unknown",
    ...openAIBilling(provider, body),
  };
}

// Only OpenAI prices service tiers differently. Groq also sends service_tier but does not.
function openAIBilling(provider: string, body: unknown): { billing?: BillingDetail } {
  if (provider !== "openai") return {};
  const tier = getString(body, "service_tier");
  return tier ? { billing: { serviceTier: tier } } : {};
}

// A streamed Responses API call ends with a `response.*` event that wraps the finished response.
export function unwrapResponsesApi(body: unknown): Record<string, unknown> | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (record.object === "response") return record;
  if (typeof record.type === "string" && record.type.startsWith("response.")) {
    return getObject(record, "response");
  }
  return null;
}

// In the Responses API, cache reads are part of input_tokens and reasoning is part of output_tokens.
function parseResponsesApi(
  provider: string,
  response: Record<string, unknown>,
  request: ParsedRequest,
): ParsedLLMCall {
  const usage = getObject(response, "usage");

  // Only tools the program runs itself. Hosted tools like web search run on OpenAI's side.
  const toolCalls: ToolCall[] = [];
  for (const item of getArray(response, "output")) {
    const type = getString(item, "type");
    // Use call_id, not id, because that is what the matching output item refers to.
    const callId = getString(item, "call_id");
    const withId = (call: ToolCall): ToolCall => (callId ? { ...call, id: callId } : call);
    if (type === "function_call") {
      toolCalls.push(withId({
        name: getString(item, "name", "unknown"),
        ...parseToolArguments(getString(item, "arguments", "{}")),
      }));
    } else if (type === "custom_tool_call") {
      toolCalls.push(withId({ name: getString(item, "name", "unknown"), input: { input: getString(item, "input") } }));
    }
  }

  const incompleteReason = getString(getObject(response, "incomplete_details"), "reason");

  return {
    provider,
    model: getString(response, "model", request.model),
    inputTokens: getNumber(usage, "input_tokens"),
    outputTokens: getNumber(usage, "output_tokens"),
    cachedTokens: getNumber(getObject(usage, "input_tokens_details"), "cached_tokens"),
    reasoningTokens: getNumber(getObject(usage, "output_tokens_details"), "reasoning_tokens"),
    toolCalls,
    isStreaming: request.isStreaming,
    finishReason: incompleteReason || getString(response, "status", "unknown"),
    ...openAIBilling(provider, response),
  };
}
