/**
 * Redaction must stay linear in input length.
 *
 * Prompt length is entirely user-controlled, and every captured message goes
 * through `redactString`. The EMAIL pattern was written as
 * `[A-Za-z0-9._%+-]+@…`, which on text containing no `@` consumes the whole
 * string, backtracks one character at a time, and repeats from every position —
 * O(n²). Pasting a long document into a prompt was enough to make costcatch
 * burn seconds of CPU per call (CWE-1333).
 */

import { describe, it, expect } from "vitest";
import { redactString } from "../../../src/core/redact.js";

/** Median of several runs — single measurements are too noisy for a ratio. */
function medianMs(fn: () => void, runs = 5): number {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return samples.sort((a, b) => a - b)[Math.floor(runs / 2)];
}

describe("redactString scaling", () => {
  it("scales roughly linearly with input length", () => {
    const short = "lorem ipsum dolor sit amet ".repeat(150); // ~4 KB
    const long = "lorem ipsum dolor sit amet ".repeat(1_200); // ~32 KB (8×)

    redactString(short); // warm up
    const tShort = medianMs(() => void redactString(short));
    const tLong = medianMs(() => void redactString(long));

    // Linear is 8×. Quadratic is ~64×. The generous bound keeps this stable on
    // shared CI runners while still catching a reintroduced backtracking blowup.
    const ratio = tLong / Math.max(tShort, 0.05);
    expect(ratio).toBeLessThan(24);
  });

  it("handles a large prompt without stalling", () => {
    // 200 KB of prose with no email in it — the exact worst case.
    const huge = "the quick brown fox jumps over the lazy dog ".repeat(4_500);
    const elapsed = medianMs(() => void redactString(huge), 3);
    expect(elapsed).toBeLessThan(2_000);
  });

  it("still finds an email at the end of a long string", () => {
    // Bounding the quantifiers must not cost recall.
    const haystack = "x".repeat(50_000) + " contact dev@example.com now";
    expect(redactString(haystack)).toContain("«email»");
  });
});
