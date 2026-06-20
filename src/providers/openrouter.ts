// OpenRouter can route to a different model, so the model and cost in its reply take priority.

import type { Provider, ParsedRequest, ParsedLLMCall } from "../types/provider.js";
import {
  getNumber,
  getObject,
  parseBodyRequest,
  parseOpenAICachedTokens,
  parseOpenAICompatibleResponse,
  unwrapResponsesApi,
} from "./base.js";

export const openrouterProvider: Provider = {
  name: "openrouter",

  urlPatterns: [/openrouter\.ai/],

  parseRequest: parseBodyRequest,

  parseResponse(body: unknown, request: ParsedRequest): ParsedLLMCall {
    const call = parseOpenAICompatibleResponse("openrouter", body, request);

    // A streamed Responses API call keeps its usage inside the final event.
    const usage = getObject(unwrapResponsesApi(body) ?? body, "usage");

    const cachedTokens =
      call.cachedTokens ?? parseOpenAICachedTokens(usage) ?? getNumber(usage, "cache_read_input_tokens");

    let reportedCostUsd: number | null = null;
    if (usage) {
      const cost = getNumber(usage, "cost");
      // BYOK calls are billed by the upstream provider, so a zero cost there means unknown. A zero
      // on a non-BYOK call is a free model, which pricing by name would get wrong.
      const byok = (usage as Record<string, unknown>).is_byok;
      if (cost !== null && cost >= 0 && (cost > 0 ? byok !== true : byok === false)) reportedCostUsd = cost;
    }

    return { ...call, cachedTokens, reportedCostUsd };
  },
};

