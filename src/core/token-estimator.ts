/**
 * Token estimator — zero-dependency token-count approximation.
 *
 * WHY character-based estimation?
 * ──────────────────────────────
 * The alternative is shipping tiktoken (~2 MB WASM), @anthropic-ai/tokenizer,
 * or Google's SentencePiece bindings. Each is >1 MB, requires native builds on
 * some platforms, and only covers ONE provider. That directly violates
 * costcatch's zero-setup, no-dependency mandate.
 *
 * Instead we use empirically-validated chars-per-token ratios:
 *
 *   Tokenizer          │ Models                        │ Ratio (en)
 *   ───────────────────┼───────────────────────────────┼───────────
 *   cl100k_base        │ GPT-4, GPT-4-turbo, o1, o3   │ ~4.0
 *   o200k_base         │ GPT-4o, GPT-4o-mini           │ ~4.0
 *   Claude BPE (≤4.6)  │ Claude 3, Sonnet 4, Opus 4    │ ~3.6
 *   Claude BPE (≥4.7)  │ Claude 4.7+, Sonnet 5         │ ~2.8  (30–35% more granular)
 *   SentencePiece      │ Gemini 1.5/2.0/2.5            │ ~4.0
 *   Llama BPE          │ Llama 3.x, Mistral, Mixtral   │ ~3.9
 *   DeepSeek BPE       │ DeepSeek v2/v3                │ ~3.8
 *   Cohere BPE         │ Command-R, Command-R+         │ ~3.9
 *
 * These ratios yield ±10–15% accuracy for English prose. That's MORE than
 * enough for cost estimation — even provider billing dashboards round.
 *
 * The ratios are adjusted for content type:
 *   - Code          → ratio × 0.75 (more single-char tokens: {, }, =, ;)
 *   - JSON/XML      → ratio × 0.80 (structural tokens)
 *   - CJK-heavy     → ratio × 0.55 (multi-byte chars → more tokens)
 *   - Mixed content → weighted blend
 *
 * Sources:
 *   - OpenAI Cookbook: "How to count tokens" (2024)
 *   - Anthropic docs: "Understanding tokens" (2025)
 *   - Google AI: "Gemini tokenization" (2025)
 *   - LiteLLM community tokenizer benchmarks (2025)
 *   - Anthropic blog: new tokenizer in Claude 4.7+ produces ~30–35% more
 *     tokens for the same text (2026)
 */

// ---------------------------------------------------------------------------
// Tokenizer family definitions
// ---------------------------------------------------------------------------

/** Known tokenizer families mapped to their chars-per-token ratio. */
export interface TokenizerFamily {
  /** Human-readable tokenizer name */
  name: string;
  /** Average characters per token for English prose */
  charsPerToken: number;
  /** Models that use this tokenizer */
  models: readonly string[];
}

/**
 * Master tokenizer registry.
 *
 * ORDER MATTERS: during lookup, more-specific model prefixes must come first
 * so "gpt-4o-mini" matches before "gpt-4o" and "gpt-4" before "gpt-3.5".
 *
 * Updated 2026-07: includes the new Anthropic tokenizer split (4.7+).
 */
export const TOKENIZER_FAMILIES: readonly TokenizerFamily[] = [
  // ── OpenAI ──
  {
    name: "o200k_base",
    charsPerToken: 4.0,
    models: ["gpt-4o-mini", "gpt-4o", "o4-mini"],
  },
  {
    name: "cl100k_base",
    charsPerToken: 4.0,
    models: ["gpt-4-turbo", "gpt-4", "gpt-3.5-turbo", "o1", "o1-mini", "o3", "o3-mini"],
  },

  // ── Anthropic ──
  // Newer models (4.7+) use a more granular tokenizer: ~30-35% more tokens
  {
    name: "claude-bpe-v2",
    charsPerToken: 2.8,
    models: ["claude-opus-4.7", "claude-sonnet-5"],
  },
  // Current-gen models
  {
    name: "claude-bpe-v1",
    charsPerToken: 3.6,
    models: [
      "claude-sonnet-4", "claude-opus-4",
      "claude-3-5-sonnet", "claude-3-5-haiku",
      "claude-3-opus", "claude-3-sonnet", "claude-3-haiku",
    ],
  },

  // ── Google ──
  {
    name: "sentencepiece-gemini",
    charsPerToken: 4.0,
    models: ["gemini-2.5", "gemini-2.0", "gemini-1.5-pro", "gemini-1.5-flash", "gemini-1.0"],
  },

  // ── Meta / Llama ──
  {
    name: "llama-bpe",
    charsPerToken: 3.9,
    models: ["llama-3.3", "llama-3.1", "llama-3", "llama-2"],
  },

  // ── Mistral ──
  {
    name: "mistral-bpe",
    charsPerToken: 3.9,
    models: ["mistral-large", "mistral-small", "mistral-medium", "mixtral", "mistral-7b"],
  },

  // ── DeepSeek ──
  {
    name: "deepseek-bpe",
    charsPerToken: 3.8,
    models: ["deepseek-chat", "deepseek-reasoner", "deepseek-coder", "deepseek-v2"],
  },

  // ── Cohere ──
  {
    name: "cohere-bpe",
    charsPerToken: 3.9,
    models: ["command-r-plus", "command-r", "command"],
  },
] as const;

/** Default ratio when model can't be identified */
const DEFAULT_CHARS_PER_TOKEN = 4.0;
const DEFAULT_FAMILY_NAME = "generic-bpe";

// ---------------------------------------------------------------------------
// Content-type detection heuristics
// ---------------------------------------------------------------------------

/** Content profile for adjusting the base ratio. */
export interface ContentProfile {
  /** Fraction of text that looks like code (0–1) */
  codeFraction: number;
  /** Fraction of text that looks like JSON/XML (0–1) */
  structuredFraction: number;
  /** Fraction of text that is CJK characters (0–1) */
  cjkFraction: number;
  /** Detected content type label */
  contentType: "prose" | "code" | "structured" | "mixed";
}

/** Multipliers applied to the base chars-per-token ratio. */
const CONTENT_MULTIPLIERS = {
  code: 0.75,
  structured: 0.80,
  cjk: 0.55,
} as const;

// CJK Unicode ranges (Han, Hiragana, Katakana, Hangul)
const CJK_REGEX = /[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\u3040-\u309F\u30A0-\u30FF]/g;

// Code indicators: braces, semicolons, arrows, common syntax
const CODE_INDICATORS = /[{}\[\];=><|&!~^%]|\/\/|\/\*|\*\/|=>|->|\bfunction\b|\bconst\b|\blet\b|\bvar\b|\bclass\b|\bimport\b|\bdef\b|\breturn\b/g;

// Structured data: JSON/XML brackets, colons, quotes patterns
const STRUCTURED_INDICATORS = /^\s*[\[{]|"[^"]+"\s*:|<\/?[a-zA-Z]/gm;

/**
 * Analyze text to determine its content profile.
 * This profile adjusts the chars-per-token ratio for better accuracy.
 */
export function analyzeContent(text: string): ContentProfile {
  if (text.length === 0) {
    return { codeFraction: 0, structuredFraction: 0, cjkFraction: 0, contentType: "prose" };
  }

  const totalChars = text.length;

  // CJK fraction
  const cjkMatches = text.match(CJK_REGEX);
  const cjkFraction = cjkMatches ? cjkMatches.length / totalChars : 0;

  // Code fraction: density of code-like tokens
  const codeMatches = text.match(CODE_INDICATORS);
  const codeScore = codeMatches ? codeMatches.length : 0;
  // Normalize: ~1 code indicator per 15 chars is "mostly code"
  const codeFraction = Math.min(1, codeScore / (totalChars / 15));

  // Structured fraction
  const structuredMatches = text.match(STRUCTURED_INDICATORS);
  const structuredScore = structuredMatches ? structuredMatches.length : 0;
  const structuredFraction = Math.min(1, structuredScore / (totalChars / 40));

  // Determine dominant type
  let contentType: ContentProfile["contentType"] = "prose";
  if (codeFraction > 0.4) contentType = "code";
  else if (structuredFraction > 0.4) contentType = "structured";
  else if (codeFraction > 0.15 || structuredFraction > 0.15 || cjkFraction > 0.1) contentType = "mixed";

  return { codeFraction, structuredFraction, cjkFraction, contentType };
}

/**
 * Compute the effective chars-per-token ratio, adjusted for content type.
 */
function adjustedRatio(baseRatio: number, profile: ContentProfile): number {
  // Weighted blend of multipliers
  let multiplier = 1.0;

  if (profile.cjkFraction > 0.1) {
    multiplier -= (1 - CONTENT_MULTIPLIERS.cjk) * profile.cjkFraction;
  }
  if (profile.codeFraction > 0.1) {
    multiplier -= (1 - CONTENT_MULTIPLIERS.code) * profile.codeFraction * 0.5;
  }
  if (profile.structuredFraction > 0.1) {
    multiplier -= (1 - CONTENT_MULTIPLIERS.structured) * profile.structuredFraction * 0.5;
  }

  // Clamp: never go below 40% or above 100% of base ratio
  multiplier = Math.max(0.4, Math.min(1.0, multiplier));

  return baseRatio * multiplier;
}

// ---------------------------------------------------------------------------
// Core estimation API
// ---------------------------------------------------------------------------

/** Result of a token estimation. */
export interface TokenEstimate {
  /** Estimated token count */
  tokens: number;
  /** Character count of the input */
  chars: number;
  /** The chars-per-token ratio used (after content adjustment) */
  charsPerToken: number;
  /** Base ratio before content adjustment */
  baseCharsPerToken: number;
  /** Confidence level of the estimate */
  confidence: "high" | "medium" | "low";
  /** Accuracy margin as a fraction (e.g. 0.10 = ±10%) */
  margin: number;
  /** The tokenizer family used */
  tokenizerFamily: string;
  /** Content profile detected */
  contentProfile: ContentProfile;
}

/** Result of a per-section breakdown. */
export interface SectionEstimate {
  /** Section label (heading text or "Section N") */
  label: string;
  /** Estimated tokens for this section */
  tokens: number;
  /** Character count for this section */
  chars: number;
  /** Fraction of total tokens (0–1) */
  fraction: number;
}

/** Full estimation result for one model. */
export interface EstimateResult {
  /** Model name */
  model: string;
  /** Token estimate details */
  estimate: TokenEstimate;
  /** Cost in USD (input tokens only) */
  costUsd: number | null;
  /** Per-section breakdown (only when requested) */
  sections: SectionEstimate[] | null;
}

/**
 * Resolve a model name to its tokenizer family.
 *
 * Uses prefix matching: "claude-sonnet-4-20250514" matches "claude-sonnet-4".
 * Returns the default family if no match is found.
 */
export function getTokenizerFamily(model: string): { name: string; charsPerToken: number } {
  const normalizedModel = model.toLowerCase();

  for (const family of TOKENIZER_FAMILIES) {
    for (const prefix of family.models) {
      if (normalizedModel.startsWith(prefix) || normalizedModel.includes(prefix)) {
        return { name: family.name, charsPerToken: family.charsPerToken };
      }
    }
  }

  return { name: DEFAULT_FAMILY_NAME, charsPerToken: DEFAULT_CHARS_PER_TOKEN };
}

/**
 * Estimate token count for a text string and a specific model.
 *
 * @param text  - The prompt text to estimate
 * @param model - Model identifier (e.g. "gpt-4o", "claude-sonnet-4")
 */
export function estimateTokens(text: string, model: string): TokenEstimate {
  const chars = text.length;

  if (chars === 0) {
    const family = getTokenizerFamily(model);
    return {
      tokens: 0,
      chars: 0,
      charsPerToken: family.charsPerToken,
      baseCharsPerToken: family.charsPerToken,
      confidence: "high",
      margin: 0,
      tokenizerFamily: family.name,
      contentProfile: { codeFraction: 0, structuredFraction: 0, cjkFraction: 0, contentType: "prose" },
    };
  }

  const family = getTokenizerFamily(model);
  const profile = analyzeContent(text);
  const effectiveRatio = adjustedRatio(family.charsPerToken, profile);

  const tokens = Math.ceil(chars / effectiveRatio);

  // Confidence based on content complexity
  let confidence: TokenEstimate["confidence"] = "high";
  let margin = 0.10; // ±10% default

  if (profile.cjkFraction > 0.3) {
    confidence = "low";
    margin = 0.25;
  } else if (profile.contentType === "mixed" || profile.codeFraction > 0.3) {
    confidence = "medium";
    margin = 0.15;
  }

  return {
    tokens,
    chars,
    charsPerToken: effectiveRatio,
    baseCharsPerToken: family.charsPerToken,
    confidence,
    margin,
    tokenizerFamily: family.name,
    contentProfile: profile,
  };
}

// ---------------------------------------------------------------------------
// Section breakdown
// ---------------------------------------------------------------------------

/**
 * Break text into sections and estimate tokens per section.
 *
 * Detection strategy (in priority order):
 *   1. Markdown headings (# / ## / ###) — when present
 *   2. Blank-line-separated blocks — fallback
 *
 * This provides the per-section breakdown bars shown in the UI.
 */
export function estimateSections(
  text: string,
  model: string,
): SectionEstimate[] {
  if (text.trim().length === 0) return [];

  const family = getTokenizerFamily(model);

  // Try markdown headings first
  const headingPattern = /^(#{1,6})\s+(.+)$/gm;
  const headings = [...text.matchAll(headingPattern)];

  let rawSections: Array<{ label: string; text: string }>;

  if (headings.length >= 2) {
    // Split by headings
    rawSections = [];
    for (let i = 0; i < headings.length; i++) {
      const start = headings[i].index!;
      const end = i + 1 < headings.length ? headings[i + 1].index! : text.length;
      const sectionText = text.slice(start, end);
      rawSections.push({
        label: headings[i][2].trim(),
        text: sectionText,
      });
    }
    // Text before the first heading
    const preamble = text.slice(0, headings[0].index!).trim();
    if (preamble.length > 0) {
      rawSections.unshift({ label: "Preamble", text: preamble });
    }
  } else {
    // Fall back to blank-line-separated blocks
    const blocks = text.split(/\n\s*\n/).filter((b) => b.trim().length > 0);
    rawSections = blocks.map((block, i) => {
      // Use the first line as the label (truncated)
      const firstLine = block.trim().split("\n")[0].slice(0, 50);
      return {
        label: firstLine || `Section ${i + 1}`,
        text: block,
      };
    });
  }

  // Estimate tokens for each section
  const sectionEstimates = rawSections.map((sec) => {
    const profile = analyzeContent(sec.text);
    const effectiveRatio = adjustedRatio(family.charsPerToken, profile);
    const tokens = Math.ceil(sec.text.length / effectiveRatio);
    return {
      label: sec.label,
      tokens,
      chars: sec.text.length,
      fraction: 0, // computed below
    };
  });

  // Calculate fractions
  const totalTokens = sectionEstimates.reduce((sum, s) => sum + s.tokens, 0);
  if (totalTokens > 0) {
    for (const sec of sectionEstimates) {
      sec.fraction = sec.tokens / totalTokens;
    }
  }

  return sectionEstimates;
}
