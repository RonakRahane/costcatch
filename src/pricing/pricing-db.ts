// Looks up model prices in ~/.costcatch/pricing.json, layered over the bundled prices.

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import fallbackPrices from "./fallback-prices.json" with { type: "json" };

// All rates are USD per token.
export interface Rates {
  inputCostPerToken: number;
  outputCostPerToken: number;
  cacheReadCostPerToken?: number;
  cacheWriteCostPerToken?: number;
  cacheWrite1hCostPerToken?: number;
}

// Once the prompt is over aboveTokens, these rates apply to the whole call.
export interface LongContextTier {
  aboveTokens: number;
  rates: Partial<Rates>;
}

export interface ModelPricing extends Rates {
  // Sorted lowest threshold first.
  longContext?: LongContextTier[];
  serviceTiers?: Record<string, { rates: Partial<Rates>; longContext?: LongContextTier[] }>;
  // Token price multipliers keyed by a condition the response reports, like Anthropic's us or fast.
  multipliers?: Record<string, number>;
  webSearchCostPerQuery?: number;
}

const RATE_FIELDS: Record<string, keyof Rates> = {
  input_cost_per_token: "inputCostPerToken",
  output_cost_per_token: "outputCostPerToken",
  cache_read_input_token_cost: "cacheReadCostPerToken",
  cache_creation_input_token_cost_above_1hr: "cacheWrite1hCostPerToken",
  cache_creation_input_token_cost: "cacheWriteCostPerToken",
};

// Batch and other variants are left out because they never apply to a call costcatch sees.
export const PRICE_KEY =
  /^(input_cost_per_token|output_cost_per_token|cache_read_input_token_cost|cache_creation_input_token_cost_above_1hr|cache_creation_input_token_cost)(?:_above_(\d+)k_tokens)?(?:_(flex|priority))?$/;

export const PRICE_EXTRAS = ["search_context_cost_per_query", "provider_specific_entry"] as const;

const STANDARD_SERVICE_TIERS = new Set(["", "default", "standard", "auto", "on_demand"]);

// promptTokens includes cached tokens. A wrong price is worse than none, so return null when unsure.
export function ratesFor(pricing: ModelPricing, promptTokens: number, serviceTier?: string | null): Rates | null {
  const tier = (serviceTier ?? "").trim().toLowerCase();
  let card: Rates = pricing;
  let longContext = pricing.longContext;
  if (!STANDARD_SERVICE_TIERS.has(tier)) {
    const own = pricing.serviceTiers?.[tier];
    if (!own) return null;
    const isLong = (tiers?: LongContextTier[]) => tiers?.some((t) => promptTokens > t.aboveTokens) ?? false;
    if (isLong(pricing.longContext) && !isLong(own.longContext)) return null;
    card = { ...baseRates(pricing), ...own.rates };
    longContext = own.longContext;
  }
  const above = longContext?.filter((t) => promptTokens > t.aboveTokens).at(-1);
  return above ? { ...baseRates(card), ...above.rates } : baseRates(card);
}

function baseRates(r: Rates): Rates {
  const out: Rates = { inputCostPerToken: r.inputCostPerToken, outputCostPerToken: r.outputCostPerToken };
  if (r.cacheReadCostPerToken !== undefined) out.cacheReadCostPerToken = r.cacheReadCostPerToken;
  if (r.cacheWriteCostPerToken !== undefined) out.cacheWriteCostPerToken = r.cacheWriteCostPerToken;
  if (r.cacheWrite1hCostPerToken !== undefined) out.cacheWrite1hCostPerToken = r.cacheWrite1hCostPerToken;
  return out;
}

export type PricingSource = "cache" | "bundled";

interface PricingIndex {
  byName: Map<string, ModelPricing>;
  // Longest first, which the prefix fallback relies on.
  sortedKeys: string[];
  source: PricingSource;
  // The cache file's mtime in epoch ms, or null for bundled prices.
  loadedAtMs: number | null;
}

const MAX_CACHE_BYTES = 32 * 1024 * 1024;

const PROVIDER_PREFIXES = new Set([
  "openai", "azure", "azure_ai", "anthropic", "bedrock", "vertex_ai",
  "vertex_ai-language-models", "gemini", "google", "groq", "mistral",
  "openrouter", "ollama", "ollama_chat", "together_ai", "deepseek", "cohere",
  "cohere_chat", "fireworks_ai", "xai", "perplexity", "anyscale", "deepinfra",
  "replicate", "cloudflare", "voyage", "databricks", "watsonx", "sagemaker",
  "nvidia_nim", "cerebras", "sambanova", "friendliai", "text-completion-openai",
]);

const BOUNDARY = new Set(["-", "/", ":", "@", "_"]);

let index: PricingIndex | null = null;

// COSTCATCH_HOME lets tests avoid reading a developer's real cache.
function getCachePath(): string {
  const home = process.env.COSTCATCH_HOME || os.homedir();
  return path.join(home, ".costcatch", "pricing.json");
}

function normalizeModel(model: string): string {
  let out = model.trim().toLowerCase();
  for (let i = 0; i < 3; i++) {
    const slash = out.indexOf("/");
    if (slash <= 0) break;
    if (!PROVIDER_PREFIXES.has(out.slice(0, slash))) break;
    out = out.slice(slash + 1);
  }
  return out;
}

function* suffixVariants(model: string): Generator<string> {
  const strippers: RegExp[] = [
    /-\d{4}-\d{2}-\d{2}$/,
    /-\d{8}$/,
    /-\d{6}$/,
    /-latest$/,
    /-preview$/,
    /-preview-\d{2}-\d{2}$/,
    /-v\d+(?:\.\d+)*$/,
  ];

  let current = model;
  for (let round = 0; round < 4; round++) {
    let changed = false;
    for (const re of strippers) {
      const next = current.replace(re, "");
      if (next !== current) {
        current = next;
        changed = true;
        yield current;
      }
    }
    if (!changed) return;
  }
}

const isRate = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

function readEntry(entry: unknown): ModelPricing | null {
  if (entry === null || typeof entry !== "object") return null;
  const e = entry as Record<string, unknown>;
  const input = e.input_cost_per_token;
  const output = e.output_cost_per_token;
  if (!isRate(input) || !isRate(output)) return null;

  const pricing: ModelPricing = { inputCostPerToken: input, outputCostPerToken: output };
  for (const [key, value] of Object.entries(e)) {
    const m = PRICE_KEY.exec(key);
    if (!m || !isRate(value)) continue;
    const [, name, above, tier] = m;
    const field = RATE_FIELDS[name];
    const card = tier ? ((pricing.serviceTiers ??= {})[tier] ??= { rates: {} }) : null;
    if (above) {
      const tiers = card ? (card.longContext ??= []) : (pricing.longContext ??= []);
      const aboveTokens = Number(above) * 1000;
      let at = tiers.find((t) => t.aboveTokens === aboveTokens);
      if (!at) tiers.push((at = { aboveTokens, rates: {} }));
      at.rates[field] = value;
    } else if (card) {
      card.rates[field] = value;
    } else {
      pricing[field] = value;
    }
  }
  pricing.longContext?.sort((a, b) => a.aboveTokens - b.aboveTokens);
  for (const card of Object.values(pricing.serviceTiers ?? {})) card.longContext?.sort((a, b) => a.aboveTokens - b.aboveTokens);

  const search = e.search_context_cost_per_query;
  if (search !== null && typeof search === "object") {
    const sizes = Object.values(search as Record<string, unknown>);
    if (sizes.length > 0 && sizes.every((v) => isRate(v) && v === sizes[0])) pricing.webSearchCostPerQuery = sizes[0] as number;
  }
  const extra = e.provider_specific_entry;
  if (extra !== null && typeof extra === "object") {
    for (const [condition, factor] of Object.entries(extra as Record<string, unknown>)) {
      if (isRate(factor) && factor > 0) (pricing.multipliers ??= {})[condition.toLowerCase()] = factor;
    }
  }
  return pricing;
}

function readCache(): { data: Record<string, unknown>; mtimeMs: number } | null {
  const cachePath = getCachePath();
  try {
    const stat = fs.statSync(cachePath);
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_CACHE_BYTES) return null;
    const parsed = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return { data: parsed as Record<string, unknown>, mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

function buildIndex(): PricingIndex {
  if (index) return index;

  // Layer the cache over the bundled prices so a partial refresh can't lose models.
  const cache = readCache();
  const raw: Record<string, unknown> = {
    ...(fallbackPrices as Record<string, unknown>),
    ...(cache ? cache.data : {}),
  };

  const byName = new Map<string, ModelPricing>();
  for (const [model, entry] of Object.entries(raw)) {
    const pricing = readEntry(entry);
    if (!pricing) continue;

    const key = model.toLowerCase();
    byName.set(key, pricing);

    // Also index the name without its provider prefix, but never over a real key.
    const stripped = normalizeModel(model);
    if (stripped !== key && !byName.has(stripped)) byName.set(stripped, pricing);
  }

  index = {
    byName,
    sortedKeys: [...byName.keys()].sort((a, b) => b.length - a.length || (a < b ? -1 : 1)),
    source: cache ? "cache" : "bundled",
    loadedAtMs: cache ? cache.mtimeMs : null,
  };
  return index;
}

// namespace is the serving provider's LiteLLM prefix, since hosts price the same model differently.
export function getModelPricing(model: string, namespace?: string): ModelPricing | null {
  if (!model) return null;
  const db = buildIndex();

  if (namespace) {
    const own = db.byName.get(`${namespace}/${model.toLowerCase()}`);
    if (own) return own;
  }

  const exact = db.byName.get(model);
  if (exact) return exact;

  const lower = model.toLowerCase();
  const lowerHit = db.byName.get(lower);
  if (lowerHit) return lowerHit;

  const normalized = normalizeModel(model);
  const normalizedHit = db.byName.get(normalized);
  if (normalizedHit) return normalizedHit;

  for (const variant of suffixVariants(normalized)) {
    const hit = db.byName.get(variant);
    if (hit) return hit;
  }

  // Only a release marker may follow the key, since suffixes like -pro or -mini are different models.
  for (const key of db.sortedKeys) {
    if (key.length >= normalized.length) continue;
    if (!normalized.startsWith(key)) continue;
    if (!BOUNDARY.has(normalized[key.length])) continue;
    if (!RELEASE_REMAINDER.test(normalized.slice(key.length))) continue;
    return db.byName.get(key)!;
  }

  // If only dated releases are listed, take one only when exactly one matches.
  const dated = db.sortedKeys.filter(
    (key) =>
      key.length > normalized.length &&
      key.startsWith(normalized) &&
      RELEASE_SUFFIX_ONLY.test(key.slice(normalized.length)),
  );
  if (dated.length === 1) return db.byName.get(dated[0])!;

  return null;
}

const RELEASE_SUFFIX_ONLY = /^-(?:\d{4}-\d{2}-\d{2}|\d{8}|\d{6}|latest|v\d+(?:\.\d+)*)$/;

const RELEASE_REMAINDER =
  /^(?:-\d{4}-\d{2}-\d{2}|[-@]\d{8}|-\d{6}|-\d{3,4}|-latest|-preview(?:-\d{2}-\d{2})?|-exp(?:-\d{4})?|-v\d+(?:[.:]\d+)*|:beta|:\d+)+$/;

export function getPricingInfo(): { source: PricingSource; ageDays: number | null; models: number } {
  const db = buildIndex();
  const ageDays =
    db.loadedAtMs === null ? null : Math.floor((Date.now() - db.loadedAtMs) / 86_400_000);
  return { source: db.source, ageDays, models: db.byName.size };
}

export function savePricingCache(data: Record<string, unknown>): boolean {
  const cachePath = getCachePath();
  const dir = path.dirname(cachePath);
  const tmp = `${cachePath}.${process.pid}.tmp`;

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data), { encoding: "utf-8", mode: 0o600 });
    fs.renameSync(tmp, cachePath);
    resetPricingDb();
    return true;
  } catch {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {}
    return false;
  }
}

export function pricingCachePath(): string {
  return getCachePath();
}

export function resetPricingDb(): void {
  index = null;
}
