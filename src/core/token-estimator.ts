// Estimates token counts from text features, using weights fitted on real tokenizer counts.

import { COMMON_WORDS } from "./common-words.js";
import { FITTED_FAMILIES, type ContentBucket, type FittedFamily } from "./tokenizer-families.js";

export type { ContentBucket } from "./tokenizer-families.js";

// First match wins. Unmeasured models use their family's weights but the generic margins.
export const MODEL_FAMILIES: readonly { pattern: RegExp; family: string; measured: boolean }[] = [
  // Claude 4.7 and later count the same as Haiku 5.5.
  { pattern: /^claude-(?:(?:haiku|sonnet|opus|fable)-5|opus-4-[78])(?![0-9])/, family: "claude-bpe-v2", measured: true },
  { pattern: /^claude-(?:sonnet-4-[56]|opus-4-[56]|haiku-4-5)(?![0-9])/, family: "claude-bpe-v1", measured: true },
  { pattern: /^claude-/, family: "claude-bpe-v1", measured: false },
  { pattern: /^(?:gpt-4o|chatgpt-4o|gpt-4-1(?:$|-)|gpt-4-5|gpt-5|gpt-oss|o[134](?:$|-)|codex-)/, family: "o200k_base", measured: true },
  { pattern: /^(?:gpt-4(?:$|-)|gpt-3-5|text-embedding-(?:3|ada))/, family: "cl100k_base", measured: true },
  // Google says Gemma 3 uses Gemini 2.0's tokenizer.
  { pattern: /^(?:gemma-?3|gemini-2-0)(?![0-9])/, family: "gemini-sp", measured: true },
  { pattern: /^(?:gemini|gemma)/, family: "gemini-sp", measured: false },
  { pattern: /^(?:meta-)?llama-?3(?![0-9])/, family: "llama-3", measured: true },
  { pattern: /^qwen-?2(?![0-9])/, family: "qwen", measured: true },
  { pattern: /^(?:qwen|qwq)/, family: "qwen", measured: false },
  { pattern: /^deepseek-(?:chat|reasoner|v3|r1)/, family: "deepseek-v3", measured: true },
  { pattern: /^deepseek/, family: "deepseek-v3", measured: false },
  { pattern: /^(?:open-)?(?:mistral|mixtral|ministral|pixtral|codestral|devstral|magistral)/, family: "mistral", measured: true },
  { pattern: /^command-r/, family: "cohere-command-r", measured: true },
  { pattern: /^command/, family: "cohere-command-r", measured: false },
];

const GENERIC = "generic";

// Lowercases a model id, strips host prefixes and version suffixes, and turns version dots into hyphens.
export function canonicalModel(model: string): string {
  let id = model.trim().toLowerCase();
  id = id.slice(id.lastIndexOf("/") + 1);
  id = id.replace(/^(?:[a-z]{2,6}\.)?(?:anthropic|meta|mistral|cohere|deepseek|qwen|openai|google)\./, "");
  id = id.replace(/@.*$/, "").replace(/:[a-z0-9.-]*$/, "").replace(/-v\d+$/, "");
  return id.replace(/(\d)\.(?=\d)/g, "$1-");
}

const familyByName = new Map(FITTED_FAMILIES.map((f) => [f.name, f]));

function fitted(name: string): FittedFamily {
  return familyByName.get(name) ?? familyByName.get(GENERIC)!;
}

// Each fraction is a share of the text from 0 to 1.
export interface ContentProfile {
  codeFraction: number;
  structuredFraction: number;
  cjkFraction: number;
  contentType: "prose" | "code" | "structured" | "mixed";
}

const CJK_REGEX = /[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\u3040-\u309F\u30A0-\u30FF]/g;

const CODE_INDICATORS = /[{}\[\];=><|&!~^%]|\/\/|\/\*|\*\/|=>|->|\bfunction\b|\bconst\b|\blet\b|\bvar\b|\bclass\b|\bimport\b|\bdef\b|\breturn\b/g;

// Use [ \t]* rather than \s*, because \s matches newlines and makes runs of blank lines quadratic.
const STRUCTURED_INDICATORS = /^[ \t]*[\[{]|"[^"]+"\s*:|<\/?[a-zA-Z]/gm;

export function analyzeContent(text: string): ContentProfile {
  if (text.length === 0) {
    return { codeFraction: 0, structuredFraction: 0, cjkFraction: 0, contentType: "prose" };
  }

  const totalChars = text.length;

  const cjkMatches = text.match(CJK_REGEX);
  const cjkFraction = cjkMatches ? cjkMatches.length / totalChars : 0;

  const codeMatches = text.match(CODE_INDICATORS);
  const codeScore = codeMatches ? codeMatches.length : 0;
  const codeFraction = Math.min(1, codeScore / (totalChars / 15));

  const structuredMatches = text.match(STRUCTURED_INDICATORS);
  const structuredScore = structuredMatches ? structuredMatches.length : 0;
  const structuredFraction = Math.min(1, structuredScore / (totalChars / 40));

  let contentType: ContentProfile["contentType"] = "prose";
  if (codeFraction > 0.4) contentType = "code";
  else if (structuredFraction > 0.4) contentType = "structured";
  else if (codeFraction > 0.15 || structuredFraction > 0.15 || cjkFraction > 0.1) contentType = "mixed";

  return { codeFraction, structuredFraction, cjkFraction, contentType };
}

export interface TokenEstimate {
  tokens: number;
  chars: number;
  charsPerToken: number;
  // The family's characters per token on English prose.
  baseCharsPerToken: number;
  confidence: "high" | "medium" | "low";
  // Largest relative error measured on text like this, so 0.10 means plus or minus 10%.
  margin: number;
  // Only set below 50 tokens, where the margin is a count of tokens instead of a share.
  marginTokens?: number;
  tokenizerFamily: string;
  // When false, the margin is the generic one.
  measured: boolean;
  contentBucket: ContentBucket;
  contentProfile: ContentProfile;
}

export interface SectionEstimate {
  label: string;
  tokens: number;
  chars: number;
  fraction: number;
}

export interface EstimateResult {
  model: string;
  estimate: TokenEstimate;
  // Covers input tokens only.
  costUsd: number | null;
  // Null unless a breakdown was asked for.
  sections: SectionEstimate[] | null;
}

// Changing how any of these is counted means refitting the weights.
export const FEATURES = [
  "words",
  "letters",
  "uncommonLetters",
  "upper",
  "caseBreaks",
  "longWordLetters", // letters past the sixth in a word
  "accentWords",
  "digitRuns",
  "digits",
  "newlines",
  "spaceRuns", // two or more spaces or tabs in a row
  "indentSpaces", // the spaces and tabs in those runs
  "symbols",
  "symbolRuns",
  "latinExt",
  "cyrillic",
  "arabic",
  "devanagari",
  "han",
  "kana",
  "hangul",
  "cjkPunct",
  "otherLetters",
  "otherWords",
  "emoji",
  "otherChars",
] as const;

export type Feature = (typeof FEATURES)[number];
export type TextFeatures = Record<Feature, number>;

const ANY_LETTER = /\p{L}/u;

type Kind = "latin" | "digit" | "space" | "newline" | "symbol" | "word" | "cjk" | "other";

// Also adds the code point to its counters in f.
function classify(cp: number, ch: string, sameRun: number, f: TextFeatures): Kind {
  if ((cp >= 0x61 && cp <= 0x7a) || (cp >= 0x41 && cp <= 0x5a)) {
    f.letters++;
    if (cp < 0x61) f.upper++;
    return "latin";
  }
  if (cp >= 0x30 && cp <= 0x39) {
    f.digits++;
    return "digit";
  }
  if (cp === 0x20 || cp === 0x09) return "space";
  if (cp === 0x0a) {
    f.newlines++;
    return "newline";
  }
  if (cp < 0x80) {
    if (cp > 0x20 && cp < 0x7f) {
      // Long runs like ===== merge into a few tokens, so each symbol past the third counts as an eighth.
      f.symbols += sameRun > 3 ? 1 / 8 : 1;
      return "symbol";
    }
    return "other";
  }
  if ((cp >= 0xc0 && cp <= 0x24f && cp !== 0xd7 && cp !== 0xf7) || (cp >= 0x1e00 && cp <= 0x1eff)) {
    f.latinExt++;
    return "latin";
  }
  if (cp >= 0x0400 && cp <= 0x052f) {
    f.cyrillic++;
    return "word";
  }
  if ((cp >= 0x0600 && cp <= 0x06ff) || (cp >= 0x0750 && cp <= 0x077f) || (cp >= 0x08a0 && cp <= 0x08ff) || (cp >= 0xfb50 && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff)) {
    f.arabic++;
    return "word";
  }
  if (cp >= 0x0900 && cp <= 0x097f) {
    f.devanagari++;
    return "word";
  }
  if ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0x20000 && cp <= 0x2fa1f)) {
    f.han++;
    return "cjk";
  }
  if ((cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0x31f0 && cp <= 0x31ff) || (cp >= 0xff66 && cp <= 0xff9f)) {
    f.kana++;
    return "cjk";
  }
  if ((cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x3130 && cp <= 0x318f)) {
    f.hangul++;
    return "cjk";
  }
  if ((cp >= 0x3000 && cp <= 0x303f) || (cp >= 0xff00 && cp <= 0xff65)) {
    f.cjkPunct++;
    return "other";
  }
  if (cp >= 0x1f000 || (cp >= 0x2600 && cp <= 0x27bf)) {
    f.emoji++;
    return "other";
  }
  if (ANY_LETTER.test(ch)) {
    f.otherLetters++;
    return "word";
  }
  f.otherChars++;
  return "other";
}

export function textFeatures(text: string): TextFeatures & { codePoints: number; distinct: number; blanks: number } {
  const f = Object.fromEntries(FEATURES.map((k) => [k, 0])) as TextFeatures;
  let codePoints = 0;
  let blanks = 0;
  // Stops tracking distinct characters once there are enough to rule out repetitive text.
  const seen = new Set<number>();
  let prev: Kind = "other";
  let prevLower = false;
  let spaces = 0;
  let wordLength = 0;
  let wordAccented = false;
  let pieceStart = -1;
  let prevCp = -1;
  let sameRun = 0;
  const endPiece = (at: number) => {
    if (pieceStart >= 0 && !COMMON_WORDS.has(text.slice(pieceStart, at).toLowerCase())) f.uncommonLetters += at - pieceStart;
    pieceStart = -1;
  };

  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const size = cp > 0xffff ? 2 : 1;
    const ch = size === 2 ? text.slice(i, i + 2) : text[i];
    sameRun = cp === prevCp ? sameRun + 1 : 1;
    const kind = classify(cp, ch, sameRun, f);
    const lower = (cp >= 0x61 && cp <= 0x7a) || (kind === "latin" && cp >= 0x80 && ch !== ch.toUpperCase());

    if (kind === "latin") {
      if (prev !== "latin") {
        f.words++;
        wordLength = 0;
        wordAccented = false;
        pieceStart = i;
      } else if (cp >= 0x41 && cp <= 0x5a && prevLower) {
        f.caseBreaks++;
        endPiece(i);
        pieceStart = i;
      }
      if (++wordLength > 6) f.longWordLetters++;
      if (cp >= 0x80 && !wordAccented) {
        f.accentWords++;
        wordAccented = true;
      }
    } else {
      if (prev === "latin") endPiece(i);
      if (kind !== prev) {
        if (kind === "digit") f.digitRuns++;
        else if (kind === "symbol") f.symbolRuns++;
        else if (kind === "word") f.otherWords++;
      }
    }

    if (kind === "space") {
      spaces++;
      if (spaces === 2) {
        f.spaceRuns++;
        f.indentSpaces += 2;
      } else if (spaces > 2) {
        f.indentSpaces++;
      }
    } else {
      spaces = 0;
    }
    prev = kind;
    prevLower = kind === "latin" && lower;
    prevCp = cp;
    codePoints++;
    if (kind === "space" || kind === "newline" || cp === 0x0d) blanks++;
    if (seen.size <= REPETITIVE_MAX_DISTINCT) seen.add(cp);
    i += size;
  }
  if (prev === "latin") endPiece(text.length);
  return { ...f, codePoints, distinct: seen.size, blanks };
}

const REPETITIVE_MAX_DISTINCT = 3;

// Must match bucket() in scripts/token-calibration/fit.py.
export function contentBucket(f: TextFeatures, codePoints: number, distinct: number, blanks: number): ContentBucket {
  const n = Math.max(codePoints, 1);
  if (distinct <= REPETITIVE_MAX_DISTINCT && n >= 100) return "repetitive";
  const letters = Math.max(f.letters + f.latinExt, 1);
  if ((f.han + f.kana + f.hangul + f.cjkPunct) / n >= 0.2) return "cjk";
  if ((f.cyrillic + f.arabic + f.devanagari + f.otherLetters) / n >= 0.2) return "script";
  if ((f.digits + f.symbols) / n >= 0.3 || f.letters / n < 0.3) return "data";
  if (n >= 200 && blanks / n < 0.02) return "dense";
  if (f.uncommonLetters / letters >= 0.9) return "uncommon";
  if (f.symbols / n >= 0.07 || f.indentSpaces / n >= 0.05) return "code";
  return "prose";
}

export function getTokenizerFamily(model: string): { name: string; charsPerToken: number; measured: boolean } {
  const id = canonicalModel(model);
  const hit = MODEL_FAMILIES.find((m) => m.pattern.test(id));
  const family = fitted(hit?.family ?? GENERIC);
  return { name: family.name, charsPerToken: family.proseCharsPerToken, measured: hit?.measured ?? false };
}

const EMPTY_PROFILE: ContentProfile = { codeFraction: 0, structuredFraction: 0, cjkFraction: 0, contentType: "prose" };

const SHORT_TOKENS = 50;
const LARGE_TOKENS = 200;

export function estimateTokens(text: string, model: string): TokenEstimate {
  const { name, measured } = getTokenizerFamily(model);
  const family = fitted(name);
  // An unmeasured model could use any tokenizer, so only the generic margin is safe.
  const margins = measured ? family : fitted(GENERIC);
  const base = { chars: text.length, baseCharsPerToken: family.proseCharsPerToken, tokenizerFamily: family.name, measured };

  if (text.length === 0) {
    return { ...base, tokens: 0, charsPerToken: family.proseCharsPerToken, confidence: "high", margin: 0, contentBucket: "prose", contentProfile: EMPTY_PROFILE };
  }

  const { codePoints, distinct, blanks, ...features } = textFeatures(text);
  const bucket = contentBucket(features, codePoints, distinct, blanks);

  let tokens: number;
  let margin: number;
  let marginTokens: number | undefined;
  if (bucket === "dense" || bucket === "repetitive") {
    tokens = Math.max(1, Math.round(codePoints / family.charsPerToken[bucket]));
    margin = margins.margins[bucket].large;
  } else {
    let sum = 0;
    for (const [feature, weight] of Object.entries(family.weights)) sum += weight * features[feature as Feature];
    tokens = Math.max(1, Math.round(sum));
    if (tokens < SHORT_TOKENS) {
      marginTokens = margins.shortTokens;
      margin = marginTokens / tokens;
    } else {
      margin = margins.margins[bucket][tokens >= LARGE_TOKENS ? "large" : "small"];
    }
  }
  const confidence: TokenEstimate["confidence"] = margin <= 0.1 ? "high" : margin <= 0.25 ? "medium" : "low";

  return {
    ...base,
    tokens,
    charsPerToken: text.length / tokens,
    confidence,
    margin,
    ...(marginTokens !== undefined ? { marginTokens } : {}),
    contentBucket: bucket,
    contentProfile: analyzeContent(text),
  };
}

export function estimateSections(
  text: string,
  model: string,
): SectionEstimate[] {
  if (text.trim().length === 0) return [];

  const headingPattern = /^(#{1,6})\s+(.+)$/gm;
  const headings = [...text.matchAll(headingPattern)];

  let rawSections: Array<{ label: string; text: string }>;

  if (headings.length >= 2) {
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
    const preamble = text.slice(0, headings[0].index!).trim();
    if (preamble.length > 0) {
      rawSections.unshift({ label: "Preamble", text: preamble });
    }
  } else {
    const blocks = text.split(/\n\s*\n/).filter((b) => b.trim().length > 0);
    rawSections = blocks.map((block, i) => {
      const firstLine = block.trim().split("\n")[0].slice(0, 50);
      return {
        label: firstLine || `Section ${i + 1}`,
        text: block,
      };
    });
  }

  const sectionEstimates = rawSections.map((sec) => ({
    label: sec.label,
    tokens: estimateTokens(sec.text, model).tokens,
    chars: sec.text.length,
    fraction: 0,
  }));

  const totalTokens = sectionEstimates.reduce((sum, s) => sum + s.tokens, 0);
  if (totalTokens > 0) {
    for (const sec of sectionEstimates) {
      sec.fraction = sec.tokens / totalTokens;
    }
  }

  return sectionEstimates;
}
