// Fallback for endpoints no other provider matched, like LiteLLM, vLLM or an Anthropic-format proxy.

import type { Provider, ParsedRequest, ParsedLLMCall } from "../types/provider.js";
import { getNumber, getObject, parseBodyRequest, parseOpenAICompatibleResponse } from "./base.js";
import { anthropicProvider, isAnthropicMessage } from "./anthropic.js";

export const genericProvider: Provider = {
  name: "generic",

  urlPatterns: [
    /\/chat\/completions/,
    /\/v1\/completions/,
    /\/v1\/messages/,
  ],

  parseRequest: parseBodyRequest,

  parseResponse(body: unknown, request: ParsedRequest): ParsedLLMCall {
    // The Anthropic parser is the one that adds cache tokens back into the input count.
    if (isAnthropicMessage(body)) return { ...anthropicProvider.parseResponse(body, request), provider: "generic" };

    const call = parseOpenAICompatibleResponse("generic", body, request);

    const usage = getObject(body, "usage");
    return {
      ...call,
      inputTokens: call.inputTokens ?? getNumber(usage, "input_tokens"),
      outputTokens: call.outputTokens ?? getNumber(usage, "output_tokens"),
    };
  },
};
