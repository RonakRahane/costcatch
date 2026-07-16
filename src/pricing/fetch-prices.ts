/**
 * Pricing fetcher.
 *
 * Downloads the latest model pricing from LiteLLM's GitHub repository.
 * This is an optional network call — the tool works offline with bundled prices.
 */

import { savePricingCache } from "./pricing-db.js";

/** URL of LiteLLM's community-maintained pricing database. */
const LITELLM_PRICING_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

/**
 * Fetch the latest pricing data from LiteLLM and cache it locally.
 *
 * Returns true if the fetch succeeded, false otherwise.
 * Never throws — failures are expected (offline, rate-limited, etc.).
 */
export async function fetchLatestPricing(): Promise<boolean> {
  try {
    const response = await fetch(LITELLM_PRICING_URL, {
      signal: AbortSignal.timeout(10_000), // 10s timeout
    });

    if (!response.ok) return false;

    const data = await response.json();

    if (typeof data !== "object" || data === null) return false;

    // LiteLLM's JSON has model entries with input_cost_per_token and output_cost_per_token.
    // Filter to only include entries that have pricing data.
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

    savePricingCache(pricingData);
    return true;
  } catch {
    // Network error, timeout, parse error — all non-critical.
    return false;
  }
}
