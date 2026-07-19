// Counts the estimator's own textFeatures for every corpus text and writes features.json for fit.py.
// Usage is in README.md. It runs through esbuild, so it uses the shipped TypeScript.
import { readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { textFeatures, FEATURES } from "../../src/core/token-estimator.ts";

// The default path assumes you run it from the repo root, or you can pass the data folder.
const DATA = path.resolve(process.argv[2] ?? "scripts/token-calibration/data");
const corpus = JSON.parse(readFileSync(path.join(DATA, "corpus.json"), "utf8")) as { id: string; category: string; text: string }[];
const samples = corpus.map((s) => {
  const { codePoints, distinct, blanks, ...features } = textFeatures(s.text);
  return { id: s.id, category: s.category, chars: codePoints, distinct, blanks, features };
});
writeFileSync(path.join(DATA, "features.json"), JSON.stringify({ names: FEATURES, samples }));
console.log(`features for ${samples.length} texts`);
