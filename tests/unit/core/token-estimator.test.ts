/**
 * Token estimator — unit tests.
 *
 * Validates the core estimation logic: family resolution, ratio adjustment,
 * content-type detection, and section breakdown.
 */

import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  estimateSections,
  getTokenizerFamily,
  analyzeContent,
  TOKENIZER_FAMILIES,
} from "../../../src/core/token-estimator.js";

// ---------------------------------------------------------------------------
// Family resolution
// ---------------------------------------------------------------------------

describe("getTokenizerFamily", () => {
  it("resolves GPT-4o to o200k_base", () => {
    const f = getTokenizerFamily("gpt-4o");
    expect(f.name).toBe("o200k_base");
    expect(f.charsPerToken).toBe(4.0);
  });

  it("resolves GPT-4o-mini to o200k_base", () => {
    const f = getTokenizerFamily("gpt-4o-mini");
    expect(f.name).toBe("o200k_base");
  });

  it("resolves GPT-4-turbo to cl100k_base", () => {
    const f = getTokenizerFamily("gpt-4-turbo");
    expect(f.name).toBe("cl100k_base");
  });

  it("resolves GPT-4 to cl100k_base (not o200k_base)", () => {
    const f = getTokenizerFamily("gpt-4");
    expect(f.name).toBe("cl100k_base");
  });

  it("resolves claude-sonnet-4-20250514 to claude-bpe-v1", () => {
    const f = getTokenizerFamily("claude-sonnet-4-20250514");
    expect(f.name).toBe("claude-bpe-v1");
    expect(f.charsPerToken).toBe(3.6);
  });

  it("resolves claude-opus-4 to claude-bpe-v1", () => {
    const f = getTokenizerFamily("claude-opus-4");
    expect(f.name).toBe("claude-bpe-v1");
  });

  it("resolves gemini-2.0-flash to sentencepiece-gemini", () => {
    const f = getTokenizerFamily("gemini-2.0-flash");
    expect(f.name).toBe("sentencepiece-gemini");
    expect(f.charsPerToken).toBe(4.0);
  });

  it("resolves deepseek-chat to deepseek-bpe", () => {
    const f = getTokenizerFamily("deepseek-chat");
    expect(f.name).toBe("deepseek-bpe");
  });

  it("returns generic-bpe for unknown models", () => {
    const f = getTokenizerFamily("totally-unknown-model-xyz");
    expect(f.name).toBe("generic-bpe");
    expect(f.charsPerToken).toBe(4.0);
  });

  it("is case-insensitive", () => {
    const f = getTokenizerFamily("GPT-4o");
    expect(f.name).toBe("o200k_base");
  });
});

// ---------------------------------------------------------------------------
// Content-type detection
// ---------------------------------------------------------------------------

describe("analyzeContent", () => {
  it("detects prose content", () => {
    const text = "The quick brown fox jumps over the lazy dog. This is a normal English sentence with standard punctuation.";
    const profile = analyzeContent(text);
    expect(profile.contentType).toBe("prose");
    expect(profile.codeFraction).toBeLessThan(0.15);
  });

  it("detects code content", () => {
    const text = `
      function fibonacci(n) {
        if (n <= 1) return n;
        return fibonacci(n - 1) + fibonacci(n - 2);
      }
      const result = fibonacci(10);
      console.log(result);
    `;
    const profile = analyzeContent(text);
    expect(profile.contentType).toBe("code");
    expect(profile.codeFraction).toBeGreaterThan(0.3);
  });

  it("detects structured/JSON content", () => {
    const text = `{
      "name": "costcatch",
      "version": "0.1.0",
      "dependencies": {
        "chalk": "^5.4.1",
        "commander": "^13.1.0"
      }
    }`;
    const profile = analyzeContent(text);
    expect(["structured", "code", "mixed"]).toContain(profile.contentType);
  });

  it("handles empty string", () => {
    const profile = analyzeContent("");
    expect(profile.contentType).toBe("prose");
    expect(profile.codeFraction).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

describe("estimateTokens", () => {
  it("returns 0 tokens for empty text", () => {
    const est = estimateTokens("", "gpt-4o");
    expect(est.tokens).toBe(0);
    expect(est.chars).toBe(0);
    expect(est.confidence).toBe("high");
  });

  it("estimates English prose tokens within expected range", () => {
    // "hello world" = 11 chars / ~4.0 chars/tok = ~3 tokens (GPT-4o)
    // Actual tiktoken: 2 tokens. Our estimate: ceil(11/4.0) = 3.
    // Within ±50% for very short strings (short strings are inherently noisy).
    const est = estimateTokens("hello world", "gpt-4o");
    expect(est.tokens).toBeGreaterThanOrEqual(1);
    expect(est.tokens).toBeLessThanOrEqual(10);
    expect(est.chars).toBe(11);
  });

  it("estimates longer prose with reasonable accuracy", () => {
    // ~400 chars of English prose should be roughly 100 tokens for GPT-4o
    const text = "The quick brown fox jumps over the lazy dog. ".repeat(9); // ~405 chars
    const est = estimateTokens(text, "gpt-4o");

    // Should be roughly 100 tokens (±20%)
    expect(est.tokens).toBeGreaterThan(80);
    expect(est.tokens).toBeLessThan(130);
    expect(est.tokenizerFamily).toBe("o200k_base");
  });

  it("produces more tokens for Claude due to lower ratio", () => {
    const text = "This is a test prompt for comparing token counts across models.";
    const gptEst = estimateTokens(text, "gpt-4o");
    const claudeEst = estimateTokens(text, "claude-sonnet-4-20250514");

    // Claude's ratio (3.6) is lower than GPT-4o's (4.0), so it should
    // produce more tokens for the same text
    expect(claudeEst.tokens).toBeGreaterThanOrEqual(gptEst.tokens);
  });

  it("adjusts ratio for code content", () => {
    const prose = "This is a normal sentence. ";
    const code = "const x = { foo: 'bar' }; ";

    // Repeat to get meaningful lengths
    const proseEst = estimateTokens(prose.repeat(20), "gpt-4o");
    const codeEst = estimateTokens(code.repeat(20), "gpt-4o");

    // Code should produce more tokens per character (lower effective ratio)
    const proseRatio = proseEst.chars / proseEst.tokens;
    const codeRatio = codeEst.chars / codeEst.tokens;
    expect(codeRatio).toBeLessThanOrEqual(proseRatio);
  });

  it("sets low confidence for CJK-heavy text", () => {
    const text = "这是一个中文文本测试。这个文本包含很多中文字符来测试CJK检测功能。";
    const est = estimateTokens(text, "gpt-4o");
    expect(est.confidence).toBe("low");
    expect(est.margin).toBeGreaterThan(0.15);
  });

  it("reports the correct tokenizer family", () => {
    expect(estimateTokens("test", "gpt-4o").tokenizerFamily).toBe("o200k_base");
    expect(estimateTokens("test", "claude-sonnet-4").tokenizerFamily).toBe("claude-bpe-v1");
    expect(estimateTokens("test", "gemini-2.0-flash").tokenizerFamily).toBe("sentencepiece-gemini");
  });
});

// ---------------------------------------------------------------------------
// Section breakdown
// ---------------------------------------------------------------------------

describe("estimateSections", () => {
  it("returns empty array for empty text", () => {
    const sections = estimateSections("", "gpt-4o");
    expect(sections).toHaveLength(0);
  });

  it("splits by markdown headings when present", () => {
    const text = `# Introduction
This is the introduction section.

## Methods
This describes the methods used.

## Results
Here are the results.
`;
    const sections = estimateSections(text, "gpt-4o");
    expect(sections.length).toBe(3);
    expect(sections[0].label).toBe("Introduction");
    expect(sections[1].label).toBe("Methods");
    expect(sections[2].label).toBe("Results");
  });

  it("falls back to blank-line splitting", () => {
    const text = `First paragraph with some text.

Second paragraph with more text.

Third paragraph, the final one.`;
    const sections = estimateSections(text, "gpt-4o");
    expect(sections.length).toBe(3);
  });

  it("fractions sum to ~1.0", () => {
    const text = `# Part A
Some text here for part A.

# Part B
More text here for part B, slightly longer.

# Part C
Even more text for part C.`;
    const sections = estimateSections(text, "gpt-4o");
    const totalFraction = sections.reduce((sum, s) => sum + s.fraction, 0);
    expect(totalFraction).toBeCloseTo(1.0, 1);
  });

  it("preserves preamble before first heading", () => {
    const text = `This is preamble text before any heading.

# First Section
Content of the first section.

# Second Section
Content of the second section.`;
    const sections = estimateSections(text, "gpt-4o");
    expect(sections[0].label).toBe("Preamble");
    expect(sections[1].label).toBe("First Section");
    expect(sections[2].label).toBe("Second Section");
  });
});

// ---------------------------------------------------------------------------
// Tokenizer family registry integrity
// ---------------------------------------------------------------------------

describe("TOKENIZER_FAMILIES", () => {
  it("has no duplicate model prefixes across families", () => {
    const seen = new Set<string>();
    for (const family of TOKENIZER_FAMILIES) {
      for (const model of family.models) {
        expect(seen.has(model)).toBe(false);
        seen.add(model);
      }
    }
  });

  it("every family has a positive charsPerToken", () => {
    for (const family of TOKENIZER_FAMILIES) {
      expect(family.charsPerToken).toBeGreaterThan(0);
    }
  });

  it("every family has at least one model", () => {
    for (const family of TOKENIZER_FAMILIES) {
      expect(family.models.length).toBeGreaterThan(0);
    }
  });
});
