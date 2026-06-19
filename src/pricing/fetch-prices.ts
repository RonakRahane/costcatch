// Fetches LiteLLM and OpenRouter prices into the user's pricing cache.

import { savePricingCache, PRICE_KEY, PRICE_EXTRAS } from "./pricing-db.js";

const LITELLM_PRICING_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

async function fetchLiteLLM(): Promise<Record<string, Record<string, unknown>> | null> {
  try {
    const response = await fetch(LITELLM_PRICING_URL, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;

    const data = await response.json();
    if (typeof data !== "object" || data === null) return null;

    const pricingData: Record<string, Record<string, unknown>> = {};
    for (const [model, entry] of Object.entries(data)) {
      if (entry === null || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      if (typeof e.input_cost_per_token !== "number" || typeof e.output_cost_per_token !== "number") continue;
      const kept: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(e)) {
        if (typeof value === "number" && PRICE_KEY.test(key)) kept[key] = value;
      }
      for (const key of PRICE_EXTRAS) {
        const value = e[key];
        if (value !== null && typeof value === "object" && !Array.isArray(value)) kept[key] = value;
      }
      pricingData[model] = kept;
    }
    return pricingData;
  } catch {
    return null;
  }
}

async function fetchOpenRouter(): Promise<Record<string, Record<string, number>> | null> {
  try {
    const response = await fetch(OPENROUTER_MODELS_URL, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;

    const json = await response.json();
    if (typeof json !== "object" || json === null) return null;
    const data = (json as Record<string, unknown>).data;
    if (!Array.isArray(data)) return null;

    const pricingData: Record<string, Record<string, number>> = {};
    for (const model of data) {
      if (model === null || typeof model !== "object") continue;
      const m = model as Record<string, unknown>;
      const id = m.id;
      const pricing = m.pricing as Record<string, unknown> | undefined;
      if (typeof id !== "string" || !pricing) continue;

      // Number(null) and Number("") are both 0, which would make a model with no listed price look free.
      const rate = (v: unknown): number =>
        (typeof v === "string" && v.trim() !== "") || typeof v === "number" ? Number(v) : Number.NaN;
      const promptCost = rate(pricing.prompt);
      const completionCost = rate(pricing.completion);
      if (!Number.isFinite(promptCost) || !Number.isFinite(completionCost)) continue;
      if (promptCost < 0 || completionCost < 0) continue;

      pricingData[id] = {
        input_cost_per_token: promptCost,
        output_cost_per_token: completionCost,
      };

      const slashIdx = id.lastIndexOf("/");
      if (slashIdx > 0) {
        const bare = id.slice(slashIdx + 1);
        if (!pricingData[bare]) {
          pricingData[bare] = {
            input_cost_per_token: promptCost,
            output_cost_per_token: completionCost,
          };
        }
      }
    }
    return pricingData;
  } catch {
    return null;
  }
}

export type FetchPricingResult = "saved" | "unreachable" | "unwritable";

export async function fetchLatestPricing(): Promise<FetchPricingResult> {
  const [litellm, openrouter] = await Promise.all([
    fetchLiteLLM(),
    fetchOpenRouter(),
  ]);

  if (!litellm && !openrouter) return "unreachable";

  // Outside its own openrouter/ keys, OpenRouter only fills gaps. If its bare aliases
  // won, direct OpenAI calls would be priced at OpenRouter's rate.
  const merged: Record<string, Record<string, unknown>> = { ...(litellm ?? {}) };
  for (const [key, value] of Object.entries(openrouter ?? {})) {
    if (key.startsWith("openrouter/") || !(key in merged)) merged[key] = value;
  }

  return savePricingCache(merged) ? "saved" : "unwritable";
}

