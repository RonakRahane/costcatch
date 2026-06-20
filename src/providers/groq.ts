// Groq replies in the OpenAI chat completions format.

import type { Provider, ParsedRequest, ParsedLLMCall } from "../types/provider.js";
import { parseBodyRequest, parseOpenAICompatibleResponse } from "./base.js";

export const groqProvider: Provider = {
  name: "groq",

  urlPatterns: [/api\.groq\.com/],

  parseRequest: parseBodyRequest,

  parseResponse(body: unknown, request: ParsedRequest): ParsedLLMCall {
    return parseOpenAICompatibleResponse("groq", body, request);
  },
};
