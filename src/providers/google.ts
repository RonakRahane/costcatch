/**
 * Google Gemini provider parser.
 *
 * Handles: generativelanguage.googleapis.com
 * Response format: Google's custom generateContent format.
 *
 * Key differences from OpenAI:
 * - Token fields: usageMetadata.promptTokenCount / candidatesTokenCount
 * - Content in candidates[0].content.parts
 * - Tool calls: parts with functionCall field
 * - Finish reason: candidates[0].finishReason (STOP, MAX_TOKENS, etc.)
 */

import type { Provider, ParsedRequest, ParsedLLMCall } from "../types/provider.js";
import type { ToolCall } from "../types/trace.js";
import { getString, getNumber, getObject, getArray, getBoolean } from "./base.js";

export const googleProvider: Provider = {
  name: "google",

  urlPatterns: [
    /generativelanguage\.googleapis\.com/,
    /aiplatform\.googleapis\.com/,
  ],

  parseRequest(body: unknown, url?: string): ParsedRequest {
    // Gemini names the model in the PATH, not the body:
    //   /v1beta/models/gemini-2.0-flash:generateContent
    // Reading only the body left every Gemini call labelled "gemini" with an
    // unknown price, so the URL is the primary source here.
    const fromUrl = url ? extractGeminiModel(url) : null;
    const fromBody = getString(body, "model", "");
    return {
      model: fromUrl ?? (fromBody ? stripModelsPrefix(fromBody) : "gemini"),
      isStreaming: url ? url.includes(":streamGenerateContent") : getBoolean(body, "stream"),
    };
  },

  parseResponse(body: unknown, request: ParsedRequest): ParsedLLMCall {
    const usageMetadata = getObject(body, "usageMetadata");
    const candidates = getArray(body, "candidates");
    const firstCandidate = candidates.length > 0
      ? (candidates[0] as Record<string, unknown>)
      : null;

    // Token counts
    const inputTokens = usageMetadata ? getNumber(usageMetadata, "promptTokenCount") : null;
    const outputTokens = usageMetadata ? getNumber(usageMetadata, "candidatesTokenCount") : null;
    const cachedTokens = usageMetadata ? getNumber(usageMetadata, "cachedContentTokenCount") : null;

    // Finish reason — Gemini uses uppercase (STOP, MAX_TOKENS, SAFETY)
    const rawFinishReason = firstCandidate
      ? getString(firstCandidate, "finishReason", "UNKNOWN")
      : "UNKNOWN";
    const finishReason = rawFinishReason.toLowerCase();

    // Tool calls from content parts
    const toolCalls = parseGeminiToolCalls(firstCandidate);

    return {
      provider: "google",
      model: request.model,
      inputTokens,
      outputTokens,
      cachedTokens,
      toolCalls,
      isStreaming: request.isStreaming,
      finishReason,
    };
  },
};

/**
 * Pull the model id out of a Gemini endpoint URL.
 *
 * Covers both the Generative Language API and Vertex AI:
 *   https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent
 *   https://us-central1-aiplatform.googleapis.com/v1/projects/p/locations/l/publishers/google/models/gemini-1.5-pro:streamGenerateContent
 *
 * Returns null when the path does not name a model, so the caller can fall back
 * to the body rather than inventing a value.
 */
function extractGeminiModel(url: string): string | null {
  const match = /\/models\/([^/:?#]+)/.exec(url);
  if (!match) return null;
  const model = decodeURIComponent(match[1]).trim();
  return model.length > 0 ? model : null;
}

/** `models/gemini-2.0-flash` → `gemini-2.0-flash`. */
function stripModelsPrefix(model: string): string {
  return model.startsWith("models/") ? model.slice("models/".length) : model;
}

/**
 * Parse tool calls from Gemini's content parts format.
 *
 * Gemini returns tool calls as parts with a functionCall field:
 * ```json
 * { "content": { "parts": [{ "functionCall": { "name": "...", "args": { ... } } }] } }
 * ```
 */
function parseGeminiToolCalls(candidate: Record<string, unknown> | null): ToolCall[] {
  if (!candidate) return [];

  const content = getObject(candidate, "content");
  if (!content) return [];

  const parts = getArray(content, "parts");
  const result: ToolCall[] = [];

  for (const part of parts) {
    const functionCall = getObject(part, "functionCall");
    if (!functionCall) continue;

    const name = getString(functionCall, "name", "unknown");
    const args = getObject(functionCall, "args");
    result.push({ name, input: args ?? {} });
  }

  return result;
}
