// Parser for Gemini on Google AI and Vertex AI. Claude on Vertex AI replies in Anthropic's format.

import type { Provider, ParsedRequest, ParsedLLMCall } from "../types/provider.js";
import type { ToolCall } from "../types/trace.js";
import { getString, getNumber, getObject, getArray, getBoolean, parseOpenAICompatibleResponse } from "./base.js";
import { anthropicProvider, isAnthropicMessage } from "./anthropic.js";

export const googleProvider: Provider = {
  name: "google",

  urlPatterns: [
    /generativelanguage\.googleapis\.com/,
    /aiplatform\.googleapis\.com/,
  ],

  parseRequest(body: unknown, url?: string): ParsedRequest {
    // Gemini puts the model in the URL path, as in /v1beta/models/gemini-2.0-flash:generateContent.
    const fromUrl = url ? extractGeminiModel(url) : null;
    const fromBody = getString(body, "model", "");
    return {
      model: fromUrl ?? (fromBody ? stripModelsPrefix(fromBody) : "gemini"),
      // Claude on Vertex AI streams from :streamRawPredict.
      isStreaming: url ? /:stream(?:GenerateContent|RawPredict)\b/.test(url) : getBoolean(body, "stream"),
    };
  },

  parseResponse(body: unknown, request: ParsedRequest): ParsedLLMCall {
    if (isAnthropicMessage(body)) return { ...anthropicProvider.parseResponse(body, request), provider: "google" };
    if (Array.isArray((body as Record<string, unknown> | null)?.choices)) {
      return parseOpenAICompatibleResponse("google", body, request);
    }

    const usageMetadata = getObject(body, "usageMetadata");
    const candidates = getArray(body, "candidates");
    const firstCandidate = candidates.length > 0
      ? (candidates[0] as Record<string, unknown>)
      : null;

    // Gemini leaves out zero counts, so a missing count is 0 when usage is present.
    const count = (key: string): number => getNumber(usageMetadata, key) ?? 0;
    const prompt = usageMetadata ? getNumber(usageMetadata, "promptTokenCount") : null;
    // Tool-use prompt tokens (URL context, grounding) are billed as input on top of the prompt.
    const inputTokens = prompt === null ? null : prompt + count("toolUsePromptTokenCount");
    const thoughts = usageMetadata ? count("thoughtsTokenCount") : 0;
    // Thinking tokens are not in candidatesTokenCount but are billed as output, so add them.
    const outputTokens = usageMetadata && prompt !== null ? count("candidatesTokenCount") + thoughts : null;
    const cachedTokens = usageMetadata ? getNumber(usageMetadata, "cachedContentTokenCount") : null;
    const reasoningTokens = usageMetadata && thoughts > 0 ? thoughts : null;

    // A blocked prompt has no candidates, only promptFeedback.blockReason.
    const blockReason = getString(getObject(body, "promptFeedback"), "blockReason");
    const rawFinishReason = firstCandidate
      ? getString(firstCandidate, "finishReason", "UNKNOWN")
      : blockReason
        ? `PROMPT_${blockReason}`
        : "UNKNOWN";
    const finishReason = rawFinishReason.toLowerCase();

    const toolCalls = parseGeminiToolCalls(firstCandidate);

    return {
      provider: "google",
      model: request.model,
      inputTokens,
      outputTokens,
      cachedTokens,
      reasoningTokens,
      toolCalls,
      isStreaming: request.isStreaming,
      finishReason,
    };
  },
};

function extractGeminiModel(url: string): string | null {
  const match = /\/models\/([^/:?#]+)/.exec(url);
  if (!match) return null;
  const model = decodeURIComponent(match[1]).trim();
  return model.length > 0 ? model : null;
}

function stripModelsPrefix(model: string): string {
  return model.startsWith("models/") ? model.slice("models/".length) : model;
}

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
    const id = getString(functionCall, "id");
    result.push(id ? { name, input: args ?? {}, id } : { name, input: args ?? {} });
  }

  return result;
}
