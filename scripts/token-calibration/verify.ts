// Checks the shipped estimator against every measured count and exits 1 if an estimate misses its stated margin.
// Usage is in README.md.
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { estimateTokens } from "../../src/core/token-estimator.ts";

// The default path assumes you run it from the repo root, or you can pass the data folder.
const DATA = path.resolve(process.argv[2] ?? "scripts/token-calibration/data");
const corpus = JSON.parse(readFileSync(path.join(DATA, "corpus.json"), "utf8")) as { id: string; text: string }[];
const counts = JSON.parse(readFileSync(path.join(DATA, "counts.json"), "utf8"));
// One model to estimate for each measured tokenizer.
const MODEL: Record<string, string> = {
  "claude:claude-haiku-5-5": "claude-haiku-5-5", "claude:claude-opus-4-7": "claude-opus-4-7", "claude:claude-sonnet-4-6": "claude-sonnet-4-6",
  o200k_base: "gpt-4o", cl100k_base: "gpt-4-turbo", "gemma-3": "gemini-2.0-flash", "llama-3": "llama-3.3-70b-versatile",
  "qwen2.5": "qwen2.5-72b-instruct", "deepseek-v3": "deepseek-chat", "mistral-tekken": "mistral-small-latest",
  "mistral-v3-sp": "mistral-large-latest", "cohere-command-r": "command-r-plus",
};
let failed = 0;
for (const [tokenizer, model] of Object.entries(MODEL)) {
  let inside = 0;
  for (const s of corpus) {
    const actual = counts.tokenizers[tokenizer].counts[s.id];
    const e = estimateTokens(s.text, model);
    if (Math.abs(e.tokens - actual) <= (e.marginTokens ?? e.margin * e.tokens) + 1e-9) inside++;
    else console.log(`  outside: ${tokenizer} ${s.id} estimate ${e.tokens} ±${e.marginTokens ?? `${Math.round(e.margin * 100)}%`}, actual ${actual}`);
  }
  failed += corpus.length - inside;
  console.log(`${tokenizer.padEnd(26)} ${model.padEnd(24)} inside ${inside}/${corpus.length}`);
}
process.exit(failed ? 1 : 0);
