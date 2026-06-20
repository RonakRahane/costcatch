// Parser for OpenAI chat completions and the Responses API, on api.openai.com and Azure.

import type { Provider, ParsedRequest, ParsedLLMCall } from "../types/provider.js";
import {
  getObject,
  parseBodyRequest,
  parseOpenAICachedTokens,
  parseOpenAICompatibleResponse,
} from "./base.js";

export const openaiProvider: Provider = {
  name: "openai",

  urlPatterns: [
    /api\.openai\.com/,
    /\.openai\.azure\.com/,
    /\.azure-api\.net.*openai/,
  ],

  parseRequest: parseBodyRequest,

  parseResponse(body: unknown, request: ParsedRequest): ParsedLLMCall {
    const call = parseOpenAICompatibleResponse("openai", body, request);
    return {
      ...call,
      // This reads the same field the shared parser already read, so it never changes the result.
      cachedTokens: call.cachedTokens ?? parseOpenAICachedTokens(getObject(body, "usage")),
    };
  },
};
