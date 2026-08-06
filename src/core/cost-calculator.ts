/**
 * Cost calculator.
 *
 * Computes USD cost for LLM calls using the pricing database.
 * Never throws — returns null if pricing is unavailable.
 */

import { getModelPricing } from "../pricing/pricing-db.js";

/**
 * Standard cache discount multiplier.
 *
 * Most providers (OpenAI, Anthropic via OpenRouter, Google) charge 50% of the
 * input rate for cache-read tokens. Anthropic direct charges 10% but that is
 * handled by the Anthropic provider converting their field into our canonical
 * `cachedTokens` count — the discount stays uniform here so we don't need a
 * provider→discount lookup table that can silently drift.
 */
const CACHE_DISCOUNT = 0.5;

/**
 * Calculate the cost of a single LLM call in USD.
 *
 * @param model - Model identifier (e.g. "gpt-4o", "claude-sonnet-4-6")
 * @param inputTokens - Number of input/prompt tokens (null if unknown)
 * @param outputTokens - Number of output/completion tokens (null if unknown)
 * @param cachedTokens - Number of prompt-cache-read tokens (null if not reported)
 * @returns Cost in USD, or null if model pricing is unknown or tokens are unavailable
 */
export function calculateStepCost(
  model: string,
  inputTokens: number | null,
  outputTokens: number | null,
  cachedTokens: number | null = null,
): number | null {
  if (inputTokens === null || outputTokens === null) return null;

  const pricing = getModelPricing(model);
  if (!pricing) return null;

  // Cache-aware input cost: non-cached tokens at full rate, cached at discount.
  const cached = cachedTokens ?? 0;
  const nonCached = Math.max(0, inputTokens - cached);
  const inputCost =
    nonCached * pricing.inputCostPerToken +
    cached * pricing.inputCostPerToken * CACHE_DISCOUNT;
  const outputCost = outputTokens * pricing.outputCostPerToken;

  // Round to 8 decimal places for micro-dollar precision
  return Math.round((inputCost + outputCost) * 100_000_000) / 100_000_000;
}

/**
 * Format a USD cost for display with sub-cent precision.
 *
 * @example
 * formatCost(0.00222)  // "$0.00222"
 * formatCost(0.004)    // "$0.00400"
 * formatCost(1.84)     // "$1.84"
 * formatCost(0.000094) // "$0.00009"
 * formatCost(null)     // "$?.??"
 */
export function formatCost(costUsd: number | null): string {
  if (costUsd === null) return "$?.??";
  if (costUsd === 0) return "$0.00";

  // Show enough decimals for micro-dollar precision
  if (costUsd < 0.0001) return `$${costUsd.toFixed(5)}`;
  if (costUsd < 0.01) return `$${costUsd.toFixed(5)}`;
  return `$${costUsd.toFixed(2)}`;
}

/**
 * Format a cost projection at scale.
 *
 * @example
 * formatProjection(0.18, 100) // "at 100 runs/day = $540/month"
 */
export function formatProjection(costPerRun: number, runsPerDay: number): string {
  const monthlyTotal = costPerRun * runsPerDay * 30;
  if (monthlyTotal < 1) return `at ${runsPerDay} runs/day = $${monthlyTotal.toFixed(2)}/month`;
  return `at ${runsPerDay} runs/day = $${Math.round(monthlyTotal).toLocaleString()}/month`;
}

