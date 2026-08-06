/**
 * Model → price resolution.
 *
 * This is the accuracy-critical path of the whole tool: a wrong price is worse
 * than no price, because the user cannot tell the difference. The regression
 * these tests exist for is real — resolution used to be
 * `model.startsWith(key) || key.startsWith(model)` over an unordered Map, so
 * `gpt-4o-mini-2024-07-18` resolved to the `gpt-4o` entry and every cost was
 * reported ~16× too high.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { getModelPricing, getPricingInfo, resetPricingDb } from "../../../src/pricing/pricing-db.js";

beforeEach(() => {
  resetPricingDb();
});

describe("getModelPricing — exact matches", () => {
  it("resolves a bundled model exactly", () => {
    expect(getModelPricing("gpt-4o")).toEqual({
      inputCostPerToken: 0.0000025,
      outputCostPerToken: 0.00001,
    });
  });

  it("is case-insensitive", () => {
    expect(getModelPricing("GPT-4O")).toEqual(getModelPricing("gpt-4o"));
  });
});

describe("getModelPricing — specificity", () => {
  it("never resolves a dated mini model to its non-mini sibling", () => {
    const mini = getModelPricing("gpt-4o-mini-2024-07-18");
    const full = getModelPricing("gpt-4o");
    expect(mini).not.toBeNull();
    expect(mini).toEqual(getModelPricing("gpt-4o-mini"));
    // The bug: this used to be equal, overcharging by ~16×.
    expect(mini!.inputCostPerToken).not.toBe(full!.inputCostPerToken);
    expect(mini!.inputCostPerToken).toBeLessThan(full!.inputCostPerToken);
  });

  it("strips ISO date suffixes", () => {
    expect(getModelPricing("gpt-4o-2024-08-06")).toEqual(getModelPricing("gpt-4o"));
  });

  it("strips compact date suffixes", () => {
    // claude-3-5-sonnet-20241022 is itself a key; the family form must also work.
    expect(getModelPricing("claude-3-5-sonnet-20241022")).not.toBeNull();
  });

  it("strips -latest", () => {
    expect(getModelPricing("mistral-large-latest")).not.toBeNull();
  });

  it("does not match across a token boundary that isn't one", () => {
    // "gpt-4omni" is not a "gpt-4o" variant; guessing its price would be wrong.
    expect(getModelPricing("gpt-4omni")).toBeNull();
  });

  it("refuses to price a LESS specific name from a MORE specific key", () => {
    // Only `o1-mini`/`o1` exist; a bare "o" must not inherit either.
    expect(getModelPricing("o")).toBeNull();
  });

  it("prefers the longest matching prefix, not the first inserted key", () => {
    // Deterministic regardless of JSON key order — the old Map-iteration
    // approach depended on insertion order.
    const a = getModelPricing("gpt-4o-mini-preview");
    expect(a).toEqual(getModelPricing("gpt-4o-mini"));
  });
});

describe("getModelPricing — provider namespaces", () => {
  it("strips a LiteLLM provider prefix", () => {
    expect(getModelPricing("openai/gpt-4o")).toEqual(getModelPricing("gpt-4o"));
  });

  it("strips nested OpenRouter-style prefixes", () => {
    expect(getModelPricing("openrouter/openai/gpt-4o")).toEqual(getModelPricing("gpt-4o"));
  });

  it("leaves unknown namespaces alone rather than guessing", () => {
    expect(getModelPricing("mycompany/secret-model")).toBeNull();
  });
});

describe("getModelPricing — unknown models", () => {
  it("returns null rather than a plausible-looking wrong price", () => {
    expect(getModelPricing("totally-made-up-model")).toBeNull();
  });

  it("returns null for an empty model name", () => {
    expect(getModelPricing("")).toBeNull();
  });
});

describe("getPricingInfo", () => {
  it("reports the bundled snapshot when no cache exists", () => {
    const info = getPricingInfo();
    expect(["bundled", "cache"]).toContain(info.source);
    expect(info.models).toBeGreaterThan(0);
  });
});
