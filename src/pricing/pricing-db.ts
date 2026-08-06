/**
 * Pricing database loader + model resolution.
 *
 * Three-tier pricing strategy:
 *   1. Fresh   — fetched from LiteLLM on `costcatch init`
 *   2. Cached  — stored in ~/.costcatch/pricing.json
 *   3. Bundled — fallback-prices.json shipped with the package
 *
 * All prices are USD per token.
 *
 * ── Why resolution is fussy ────────────────────────────────────────────────
 * This is a cost tool, so a *wrong* price is worse than *no* price: users make
 * budget decisions from these numbers and a silent 16× error is invisible.
 *
 * The previous implementation matched with
 * `model.startsWith(key) || key.startsWith(model)` over an unordered Map. With
 * the bundled data that resolved `gpt-4o-mini-2024-07-18` to the `gpt-4o` entry
 * — $2.50/Mtok instead of $0.15/Mtok — purely because `gpt-4o` happened to be
 * inserted first. The rules below are ordered strictly most-specific-first and
 * only ever fall back to a LESS specific key, never a more specific one.
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

/** Where the active pricing data came from. */
export type PricingSource = "cache" | "bundled";

interface PricingIndex {
  /** Exact keys, plus provider-prefix-stripped aliases. */
  byName: Map<string, ModelPricing>;
  /** Keys sorted longest-first, for token-boundary prefix fallback. */
  sortedKeys: string[];
  source: PricingSource;
  /** Epoch ms of the cache file, when the cache was used. */
  loadedAtMs: number | null;
}

/** Refuse to parse a pricing cache larger than this (LiteLLM's is ~1 MB). */
const MAX_CACHE_BYTES = 32 * 1024 * 1024;

/**
 * Provider namespaces LiteLLM prepends to model keys
 * (e.g. `anthropic/claude-sonnet-4`, `openrouter/openai/gpt-4o`).
 * Stripping them lets a bare `claude-sonnet-4` from the wire match, and
 * indexing both forms lets a namespaced wire value match a bare key.
 */
const PROVIDER_PREFIXES = new Set([
  "openai", "azure", "azure_ai", "anthropic", "bedrock", "vertex_ai",
  "vertex_ai-language-models", "gemini", "google", "groq", "mistral",
  "openrouter", "ollama", "ollama_chat", "together_ai", "deepseek", "cohere",
  "cohere_chat", "fireworks_ai", "xai", "perplexity", "anyscale", "deepinfra",
  "replicate", "cloudflare", "voyage", "databricks", "watsonx", "sagemaker",
  "nvidia_nim", "cerebras", "sambanova", "friendliai", "text-completion-openai",
]);

/** Characters that legitimately end a model-name token. */
const BOUNDARY = new Set(["-", "/", ":", "@", "_"]);

let index: PricingIndex | null = null;

/** Path to the user's cached pricing file. */
function getCachePath(): string {
  return path.join(os.homedir(), ".costcatch", "pricing.json");
}

/** Lowercase and strip any leading provider namespaces. */
function normalizeModel(model: string): string {
  let out = model.trim().toLowerCase();
  // `openrouter/openai/gpt-4o` needs two passes.
  for (let i = 0; i < 3; i++) {
    const slash = out.indexOf("/");
    if (slash <= 0) break;
    if (!PROVIDER_PREFIXES.has(out.slice(0, slash))) break;
    out = out.slice(slash + 1);
  }
  return out;
}

/**
 * Progressively strip release suffixes so a dated model falls back to its
 * family entry: `claude-3-5-sonnet-20241022` → `claude-3-5-sonnet`.
 * Yields the most specific form first.
 */
function* suffixVariants(model: string): Generator<string> {
  const strippers: RegExp[] = [
    /-\d{4}-\d{2}-\d{2}$/, // -2024-08-06
    /-\d{8}$/, // -20250514
    /-\d{6}$/, // -202505
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

function readEntry(entry: unknown): ModelPricing | null {
  if (entry === null || typeof entry !== "object") return null;
  const e = entry as Record<string, unknown>;
  const input = e.input_cost_per_token;
  const output = e.output_cost_per_token;
  if (typeof input !== "number" || typeof output !== "number") return null;
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  if (input < 0 || output < 0) return null;
  return { inputCostPerToken: input, outputCostPerToken: output };
}

/** Read the user's pricing cache, or null if absent/unusable. */
function readCache(): { data: Record<string, unknown>; mtimeMs: number } | null {
  const cachePath = getCachePath();
  try {
    const stat = fs.statSync(cachePath);
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_CACHE_BYTES) return null;
    const parsed = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return { data: parsed as Record<string, unknown>, mtimeMs: stat.mtimeMs };
  } catch {
    // Missing, corrupt, or unreadable — fall through to the bundled snapshot.
    return null;
  }
}

/**
 * Load and index the pricing database. Always succeeds — never throws.
 * Result is memoized; call {@link resetPricingDb} to force a reload.
 */
export function loadPricingDb(): Map<string, ModelPricing> {
  return buildIndex().byName;
}

function buildIndex(): PricingIndex {
  if (index) return index;

  const cache = readCache();
  const raw: Record<string, unknown> = cache ? cache.data : (fallbackPrices as Record<string, unknown>);

  const byName = new Map<string, ModelPricing>();
  for (const [model, entry] of Object.entries(raw)) {
    const pricing = readEntry(entry);
    if (!pricing) continue;

    const key = model.toLowerCase();
    byName.set(key, pricing);

    // Index the provider-stripped alias too, but never let it shadow a real
    // key: `openai/gpt-4o` must not overwrite the canonical `gpt-4o` entry.
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

/**
 * Look up pricing for a model, or null when we cannot price it confidently.
 *
 * Resolution order (each step strictly less specific than the last):
 *   1. exact key
 *   2. normalized key (lowercased, provider namespace stripped)
 *   3. release-suffix variants: `-20250514`, `-2024-08-06`, `-latest`, `-vN`
 *   4. longest key that is a prefix of the model AT A TOKEN BOUNDARY
 *
 * Step 4's boundary requirement is what stops `gpt-4o-mini` from resolving to
 * `gpt-4o` (next char `-`… but `gpt-4o-mini` is longer and wins) and stops
 * `gpt-4omni` from resolving to `gpt-4o` at all. We never match a key that is
 * MORE specific than the model — that direction can only ever guess wrong.
 */
export function getModelPricing(model: string): ModelPricing | null {
  if (!model) return null;
  const db = buildIndex();

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

  // Longest token-boundary prefix. sortedKeys is longest-first, so the first
  // match is the most specific one — and the result is deterministic
  // regardless of JSON key order.
  for (const key of db.sortedKeys) {
    if (key.length >= normalized.length) continue;
    if (!normalized.startsWith(key)) continue;
    if (!BOUNDARY.has(normalized[key.length])) continue;
    return db.byName.get(key)!;
  }

  return null;
}

/** Where the active pricing data came from, and how old it is. */
export function getPricingInfo(): { source: PricingSource; ageDays: number | null; models: number } {
  const db = buildIndex();
  const ageDays =
    db.loadedAtMs === null ? null : Math.floor((Date.now() - db.loadedAtMs) / 86_400_000);
  return { source: db.source, ageDays, models: db.byName.size };
}

/**
 * Persist fetched pricing to the cache.
 *
 * Written to a sibling temp file and renamed, so an interrupted write can never
 * leave a half-JSON file that every later run has to fail to parse.
 */
export function savePricingCache(data: Record<string, unknown>): void {
  const cachePath = getCachePath();
  const dir = path.dirname(cachePath);
  const tmp = `${cachePath}.${process.pid}.tmp`;

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data), { encoding: "utf-8", mode: 0o600 });
    fs.renameSync(tmp, cachePath);
    resetPricingDb();
  } catch {
    // Non-critical: if we can't cache, we'll use bundled prices next time.
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* best effort */
    }
  }
}

/** Clear the in-memory pricing index. Used after a refresh and by tests. */
export function resetPricingDb(): void {
  index = null;
}
