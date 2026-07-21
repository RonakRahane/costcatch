// The interface every provider adapter implements.
import type { ToolCall } from "./trace.js";

export interface ParsedLLMCall {
  provider: string;
  model: string;
  // Includes cached tokens and cache writes. Null when the provider didn't report usage.
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  // Already counted in outputTokens. Null when not reported.
  reasoningTokens: number | null;
  // Prompt-cache writes, already counted in inputTokens but billed at a higher rate.
  cacheWriteTokens?: number | null;
  toolCalls: ToolCall[];
  isStreaming: boolean;
  finishReason: string;
  // What the provider says it charged, which beats our price table when present.
  reportedCostUsd?: number | null;
  billing?: BillingDetail;
  usage?: Record<string, unknown> | null;
}

// A field the response didn't report means list price.
export interface BillingDetail {
  // Anthropic's one-hour cache writes, already counted in cacheWriteTokens.
  cacheWrite1hTokens?: number | null;
  serviceTier?: string | null;
  inferenceGeo?: string | null;
  speed?: string | null;
  webSearches?: number | null;
}

export interface ParsedRequest {
  model: string;
  isStreaming: boolean;
}

export interface Provider {
  name: string;
  urlPatterns: RegExp[];

  // url is for providers that put the model in the path, like Gemini and Azure deployments.
  parseRequest(body: unknown, url?: string): ParsedRequest;

  parseResponse(body: unknown, request: ParsedRequest): ParsedLLMCall;
}
