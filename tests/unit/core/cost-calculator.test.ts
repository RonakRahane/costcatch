import { describe, it, expect } from "vitest";
import { calculateStepCost, formatCost, formatProjection } from "../../../src/core/cost-calculator.js";
import { resetPricingDb } from "../../../src/pricing/pricing-db.js";

describe("Cost Calculator", () => {
  describe("calculateStepCost", () => {
    it("calculates cost for a known model", () => {
      resetPricingDb();
      const cost = calculateStepCost("gpt-4o", 1000, 500);

      // gpt-4o: input=$0.0000025/tok, output=$0.00001/tok
      // 1000 * 0.0000025 + 500 * 0.00001 = 0.0025 + 0.005 = 0.0075
      expect(cost).toBeCloseTo(0.0075, 4);
    });

    it("returns null for unknown models", () => {
      resetPricingDb();
      const cost = calculateStepCost("unknown-model-xyz", 1000, 500);
      expect(cost).toBeNull();
    });

    it("returns null when input tokens are null", () => {
      const cost = calculateStepCost("gpt-4o", null, 500);
      expect(cost).toBeNull();
    });

    it("returns null when output tokens are null", () => {
      const cost = calculateStepCost("gpt-4o", 1000, null);
      expect(cost).toBeNull();
    });

    it("calculates cost for Anthropic models", () => {
      resetPricingDb();
      const cost = calculateStepCost("claude-sonnet-4-20250514", 2847, 124);

      // claude-sonnet-4: input=$0.000003/tok, output=$0.000015/tok
      // 2847 * 0.000003 + 124 * 0.000015 = 0.008541 + 0.00186 = 0.010401
      expect(cost).toBeCloseTo(0.010401, 4);
    });

    it("matches partial model names (version suffixed)", () => {
      resetPricingDb();
      // "gpt-4o-2024-08-06" should match "gpt-4o" in the pricing DB
      const cost = calculateStepCost("gpt-4o-2024-08-06", 1000, 500);
      expect(cost).not.toBeNull();
    });

    it("applies cache discount to cached tokens", () => {
      resetPricingDb();
      // gpt-4o: input=$0.0000025/tok, output=$0.00001/tok
      // 1000 total input, 600 cached
      // non-cached: 400 * 0.0000025 = 0.001
      // cached: 600 * 0.0000025 * 0.5 = 0.00075
      // output: 500 * 0.00001 = 0.005
      // total = 0.001 + 0.00075 + 0.005 = 0.00675
      const cost = calculateStepCost("gpt-4o", 1000, 500, 600);
      expect(cost).toBeCloseTo(0.00675, 5);
    });
  });

  describe("formatCost", () => {
    it("formats null as $?.??", () => {
      expect(formatCost(null)).toBe("$?.??");
    });

    it("formats zero as $0.00", () => {
      expect(formatCost(0)).toBe("$0.00");
    });

    it("formats small costs with 5 decimals", () => {
      expect(formatCost(0.0004)).toBe("$0.00040");
    });

    it("formats medium costs with 5 decimals", () => {
      expect(formatCost(0.004)).toBe("$0.00400");
    });

    it("formats normal costs with 2 decimals", () => {
      expect(formatCost(1.84)).toBe("$1.84");
    });
  });

  describe("formatProjection", () => {
    it("calculates monthly cost projection", () => {
      const result = formatProjection(0.18, 100);
      // 0.18 * 100 * 30 = 540
      expect(result).toBe("at 100 runs/day = $540/month");
    });
  });
});
