/**
 * Pricing database loader.
 *
 * Three-tier pricing strategy:
 * 1. Fresh — fetched from LiteLLM GitHub (on init / weekly refresh)
 * 2. Cached — stored in ~/.costcatch/pricing.json
 * 3. Bundled — fallback-prices.json shipped with the package
 *
 * All prices are in USD per token.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import fallbackPrices from "./fallback-prices.json" with { type: "json" };

/** Per-model pricing entry. */
export interface ModelPricing {
  inputCostPerToken: number;
  outputCostPerToken: number;
}

/** The in-memory pricing map: model name → pricing. */
let pricingMap: Map<string, ModelPricing> | null = null;

/** Path to the user's cached pricing file. */
function getCachePath(): string {
  const dir = path.join(os.homedir(), ".costcatch");
  return path.join(dir, "pricing.json");
}

/**
 * Load the pricing database.
 *
 * Tries cached file first, falls back to bundled data.
 * Always succeeds — never throws.
 */
export function loadPricingDb(): Map<string, ModelPricing> {
  if (pricingMap) return pricingMap;

  pricingMap = new Map<string, ModelPricing>();

  // Try cached pricing first
  const cachePath = getCachePath();
  let rawData: Record<string, Record<string, unknown>> | null = null;

  try {
    if (fs.existsSync(cachePath)) {
      const content = fs.readFileSync(cachePath, "utf-8");
      rawData = JSON.parse(content);
    }
  } catch {
    // Cached file corrupt or unreadable — fall through to bundled
  }

  // Use bundled fallback if no cached data
  if (!rawData) {
    rawData = fallbackPrices as Record<string, Record<string, unknown>>;
  }

  // Parse into the pricing map
  for (const [model, entry] of Object.entries(rawData)) {
    const inputCost = entry.input_cost_per_token;
    const outputCost = entry.output_cost_per_token;

    if (typeof inputCost === "number" && typeof outputCost === "number") {
      pricingMap.set(model, {
        inputCostPerToken: inputCost,
        outputCostPerToken: outputCost,
      });
    }
  }

  return pricingMap;
}

/**
 * Look up pricing for a specific model.
 *
 * Tries exact match first, then partial match (model names often have
 * version suffixes like "gpt-4o-2024-08-06" that should match "gpt-4o").
 *
 * Returns null if no pricing found — caller should show $?.?? to the user.
 */
export function getModelPricing(model: string): ModelPricing | null {
  const db = loadPricingDb();

  // Exact match
  if (db.has(model)) return db.get(model)!;

  // Partial match: try stripping date suffixes and version numbers
  // e.g. "gpt-4o-2024-08-06" → "gpt-4o"
  for (const [key, pricing] of db) {
    if (model.startsWith(key) || key.startsWith(model)) {
      return pricing;
    }
  }

  return null;
}

/**
 * Save fetched pricing data to the cache.
 * Creates ~/.costcatch/ directory if it doesn't exist.
 */
export function savePricingCache(data: Record<string, unknown>): void {
  const cachePath = getCachePath();
  const dir = path.dirname(cachePath);

  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), "utf-8");
  } catch {
    // Non-critical: if we can't cache, we'll use bundled prices next time.
  }
}

/** Clear the in-memory pricing cache. Used for testing. */
export function resetPricingDb(): void {
  pricingMap = null;
}
