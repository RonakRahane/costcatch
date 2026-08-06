/**
 * Provider interface types.
 *
 * Every LLM provider (OpenAI, Anthropic, Groq, etc.) implements the Provider
 * interface. The registry auto-detects which provider to use based on URL.
 */

import type { ToolCall } from "./trace.js";

// ---------------------------------------------------------------------------
// Parsed LLM Call (provider output)
// ---------------------------------------------------------------------------

/** Standardized output from any provider's response parser. */
export interface ParsedLLMCall {
  /** Provider name (e.g. "openai", "anthropic") */
  provider: string;
  /** Model identifier (e.g. "gpt-4o", "claude-sonnet-4-6") */
  model: string;
  /** Input/prompt tokens — null if not available */
  inputTokens: number | null;
  /** Output/completion tokens — null if not available */
  outputTokens: number | null;
  /** Cached tokens (prompt caching) — null if not reported */
  cachedTokens: number | null;
  /** Tool calls extracted from the response */
  toolCalls: ToolCall[];
  /** Whether this was a streaming response */
  isStreaming: boolean;
  /** Finish reason (e.g. "stop", "end_turn", "tool_use") */
  finishReason: string;
}

// ---------------------------------------------------------------------------
// Provider Interface
// ---------------------------------------------------------------------------

/** Request metadata extracted from the HTTP request body. */
export interface ParsedRequest {
  /** Model requested */
  model: string;
  /** Whether streaming was requested */
  isStreaming: boolean;
}

/**
 * A provider knows how to:
 * 1. Identify itself by URL pattern
 * 2. Parse the request body to extract model + streaming info
 * 3. Parse the response body into a standardized ParsedLLMCall
 */
export interface Provider {
  /** Human-readable provider name */
  name: string;

  /** URL patterns this provider matches */
  urlPatterns: RegExp[];

  /**
   * Extract model and streaming flag from the request.
   *
   * `url` is supplied because not every provider puts the model in the body:
   * Gemini encodes it in the path (`/v1beta/models/<model>:generateContent`)
   * and Azure encodes the deployment name the same way. Providers that only
   * need the body may omit the parameter.
   */
  parseRequest(body: unknown, url?: string): ParsedRequest;

  /** Parse the response body into a standardized format. */
  parseResponse(body: unknown, request: ParsedRequest): ParsedLLMCall;
}
