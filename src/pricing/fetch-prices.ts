/**
 * Pricing fetcher.
 *
 * Downloads the latest model pricing from LiteLLM's GitHub repository and
 * OpenRouter's model API. This is an optional network call — the tool works
 * offline with bundled prices.
 */

import { savePricingCache } from "./pricing-db.js";

/** URL of LiteLLM's community-maintained pricing database. */
const LITELLM_PRICING_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

/** OpenRouter's model listing API — returns per-token pricing for all models. */
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

/**
 * Fetch pricing from LiteLLM (primary source).
 * Returns a map of model→{input_cost_per_token, output_cost_per_token} or null.
 */
async function fetchLiteLLM(): Promise<Record<string, Record<string, number>> | null> {
  try {
    const response = await fetch(LITELLM_PRICING_URL, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;

    const data = await response.json();
    if (typeof data !== "object" || data === null) return null;

    const pricingData: Record<string, Record<string, number>> = {};
    for (const [model, entry] of Object.entries(data)) {
      if (entry === null || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const inputCost = e.input_cost_per_token;
      const outputCost = e.output_cost_per_token;
      if (typeof inputCost === "number" && typeof outputCost === "number") {
        pricingData[model] = {
          input_cost_per_token: inputCost,
          output_cost_per_token: outputCost,
        };
      }
    }
    return pricingData;
  } catch {
    return null;
  }
}

/**
 * Fetch pricing from OpenRouter's model API (secondary source).
 *
 * OpenRouter returns pricing as cost-per-token strings in `pricing.prompt`
 * and `pricing.completion`. We index them under both the raw model id
 * (`openrouter/openai/gpt-4o`) and the bare name (`gpt-4o`).
 */
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

      const promptCost = Number(pricing.prompt);
      const completionCost = Number(pricing.completion);
      if (!Number.isFinite(promptCost) || !Number.isFinite(completionCost)) continue;

      // Index under the OpenRouter model ID
      pricingData[id] = {
        input_cost_per_token: promptCost,
        output_cost_per_token: completionCost,
      };

      // Also index under the bare model name for direct API users
      // e.g. "openai/gpt-4o" → "gpt-4o"
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

/**
 * Fetch the latest pricing data from LiteLLM + OpenRouter and cache locally.
 *
 * Returns true if at least one source succeeded, false otherwise.
 * Never throws — failures are expected (offline, rate-limited, etc.).
 */
export async function fetchLatestPricing(): Promise<boolean> {
  const [litellm, openrouter] = await Promise.all([
    fetchLiteLLM(),
    fetchOpenRouter(),
  ]);

  if (!litellm && !openrouter) return false;

  // Merge: start with LiteLLM as base, overlay OpenRouter entries.
  // OpenRouter prices are the actual billing source for openrouter/ models.
  const merged: Record<string, Record<string, number>> = {
    ...(litellm ?? {}),
    ...(openrouter ?? {}),
  };

  savePricingCache(merged);
  return true;
}

