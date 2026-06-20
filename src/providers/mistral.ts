// Mistral replies in the OpenAI chat completions format.

import type { Provider, ParsedRequest, ParsedLLMCall } from "../types/provider.js";
import { parseBodyRequest, parseOpenAICompatibleResponse } from "./base.js";

export const mistralProvider: Provider = {
  name: "mistral",

  urlPatterns: [/api\.mistral\.ai/],

  parseRequest: parseBodyRequest,

  parseResponse(body: unknown, request: ParsedRequest): ParsedLLMCall {
    return parseOpenAICompatibleResponse("mistral", body, request);
  },
};
