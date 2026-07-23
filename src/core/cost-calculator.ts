// Prices LLM calls in USD and formats the amounts. A call that can't be priced costs null.

import { getModelPricing, ratesFor, type ModelPricing } from "../pricing/pricing-db.js";
import type { BillingDetail } from "../types/provider.js";

// Used when no cache-read rate is listed. Half price matches OpenAI and Google, and Anthropic lists its own.
const CACHE_DISCOUNT = 0.5;

const CACHE_WRITE_MULTIPLIER = 1.25;

const CACHE_WRITE_1H_MULTIPLIER = 2;

// OpenAI charges 2.5x input for 12-hour cache writes, and no price list includes that rate.
const CACHE_WRITE_12H_MULTIPLIER = 2.5;

const LIST_PRICE_CONDITIONS = new Set(["", "global", "standard"]);

// Anthropic charges 1.1x for US-only inference. Older models reject that option, so a US call always paid it.
const DOCUMENTED_MULTIPLIERS: Record<string, number> = { us: 1.1 };

// Returns null when pricing or token counts are missing, or a billing option has no listed price.
export function calculateStepCost(
  model: string,
  inputTokens: number | null,
  outputTokens: number | null,
  cachedTokens: number | null = null,
  cacheWriteTokens: number | null = null,
  namespace?: string,
  billing: BillingDetail = {},
): number | null {
  if (inputTokens === null || outputTokens === null) return null;

  const pricing = getModelPricing(model, namespace);
  if (!pricing) return null;
  // Long-context tiers count the whole prompt, including cache reads and writes.
  const rates = ratesFor(pricing, inputTokens, billing.serviceTier);
  if (!rates) return null;
  const multiplier = priceMultiplier(pricing, billing);
  if (multiplier === null) return null;
  const searches = billing.webSearches ?? 0;
  if (searches > 0 && pricing.webSearchCostPerQuery === undefined) return null;

  // The providers report inputTokens as the total, with cached tokens counted inside it.
  const cached = Math.min(cachedTokens ?? 0, inputTokens);
  const written = Math.min(cacheWriteTokens ?? 0, inputTokens - cached);
  const writtenForAnHour = Math.min(billing.cacheWrite1hTokens ?? 0, written);
  const writtenFor12Hours = Math.min(billing.cacheWrite12hTokens ?? 0, written - writtenForAnHour);
  const nonCached = inputTokens - cached - written;
  const readRate = rates.cacheReadCostPerToken ?? rates.inputCostPerToken * CACHE_DISCOUNT;
  // OpenAI only charges for cache writes on some models, so an unlisted OpenAI write rate is unknown.
  const writeRate =
    rates.cacheWriteCostPerToken ?? (billing.cacheWritesNeedListedRate ? null : rates.inputCostPerToken * CACHE_WRITE_MULTIPLIER);
  if (written > 0 && writeRate === null) return null;
  const hourRate = rates.cacheWrite1hCostPerToken ?? rates.inputCostPerToken * CACHE_WRITE_1H_MULTIPLIER;
  const twelveHourRate = rates.inputCostPerToken * CACHE_WRITE_12H_MULTIPLIER;
  const inputCost =
    nonCached * rates.inputCostPerToken +
    cached * readRate +
    (written - writtenForAnHour - writtenFor12Hours) * (writeRate ?? 0) +
    writtenForAnHour * hourRate +
    writtenFor12Hours * twelveHourRate;
  const outputCost = outputTokens * rates.outputCostPerToken;
  // Web searches are a flat fee, so the token multipliers don't apply to them.
  const searchCost = searches * (pricing.webSearchCostPerQuery ?? 0);

  return roundUsd((inputCost + outputCost) * multiplier + searchCost);
}

function priceMultiplier(pricing: ModelPricing, billing: BillingDetail): number | null {
  let multiplier = 1;
  for (const condition of [billing.inferenceGeo, billing.speed]) {
    const key = (condition ?? "").trim().toLowerCase();
    if (LIST_PRICE_CONDITIONS.has(key)) continue;
    const factor = pricing.multipliers?.[key] ?? DOCUMENTED_MULTIPLIERS[key];
    if (factor === undefined) return null;
    multiplier *= factor;
  }
  return multiplier;
}

// Both --max-cost checks use this. Rounding coarser than ten places distorts cheap-model costs.
export function roundUsd(costUsd: number): number {
  return Math.round(costUsd * 1e10) / 1e10;
}

export function formatCost(costUsd: number | null): string {
  if (costUsd === null) return "$?.??";
  if (costUsd === 0) return "$0.00";
  if (costUsd >= 0.01) return `$${costUsd.toFixed(2)}`;

  const magnitude = Math.floor(Math.log10(Math.abs(costUsd)));
  const decimals = Math.min(20, Math.max(5, -magnitude + 1));
  return `$${costUsd.toFixed(decimals)}`;
}

export function formatTotalCost(totalCostUsd: number | null, unpricedCalls: number = 0): string {
  if (totalCostUsd === null) return formatCost(null);
  return unpricedCalls > 0 ? `≥${formatCost(totalCostUsd)}` : formatCost(totalCostUsd);
}

export function formatProjection(costPerRun: number, runsPerDay: number): string {
  const monthlyTotal = costPerRun * runsPerDay * 30;
  const rate = `at ${runsPerDay} run${runsPerDay === 1 ? "" : "s"}/day`;
  return `${rate} = $${monthlyTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/month`;
}

