"""Fits each tokenizer family's weights, measures its margins and writes src/core/tokenizer-families.ts.
Reads data/features.json (from features.ts) and data/counts.json (from merge.py).

Usage: python3 fit.py   (needs numpy and scipy)
"""
import json
import math
import os

import numpy as np
from scipy.optimize import nnls

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
OUT = os.path.join(HERE, "..", "..", "src", "core", "tokenizer-families.ts")

feat = json.load(open(os.path.join(DATA, "features.json"), encoding="utf-8"))
counts = json.load(open(os.path.join(DATA, "counts.json"), encoding="utf-8"))
names = feat["names"]
samples = feat["samples"]
ids = [s["id"] for s in samples]
X = np.array([[s["features"][n] for n in names] for s in samples], dtype=float)
codepoints = np.array([s["chars"] for s in samples], dtype=float)
cats = np.array([s["category"] for s in samples])


def bucket(f, n, distinct, blanks):
    """Must match contentBucket() in src/core/token-estimator.ts."""
    n = max(n, 1)
    if distinct <= 3 and n >= 100:
        return "repetitive"
    letters = max(f["letters"] + f["latinExt"], 1)
    if (f["han"] + f["kana"] + f["hangul"] + f["cjkPunct"]) / n >= 0.2:
        return "cjk"
    if (f["cyrillic"] + f["arabic"] + f["devanagari"] + f["otherLetters"]) / n >= 0.2:
        return "script"
    if (f["digits"] + f["symbols"]) / n >= 0.3 or f["letters"] / n < 0.3:
        return "data"
    if n >= 200 and blanks / n < 0.02:
        return "dense"
    if f["uncommonLetters"] / letters >= 0.9:
        return "uncommon"
    if f["symbols"] / n >= 0.07 or f["indentSpaces"] / n >= 0.05:
        return "code"
    return "prose"


B = np.array([bucket(s["features"], s["chars"], s["distinct"], s["blanks"]) for s in samples])
BUCKETS = ["prose", "code", "data", "dense", "uncommon", "cjk", "script", "repetitive"]
RATIO_BUCKETS = ("dense", "repetitive")
# Dense and repetitive text gets a plain ratio and is left out of the fit. Tokenizers differ on it
# a hundredfold, which would skew the weights for normal text.
FITTED = ~np.isin(B, RATIO_BUCKETS)

# The corpus has too little of these scripts to fit, so they take the costliest measured script's weight.
PRIOR = {"otherLetters": ["cyrillic", "arabic", "devanagari", "han", "hangul"]}
FIT = [i for i, n in enumerate(names) if n not in PRIOR]


def fit(Xa, ya, keep):
    """Fits non-negative weights by relative error, or absolute error below 20 tokens."""
    Xa, ya = Xa[keep], ya[keep]
    w = 1.0 / np.maximum(ya, 20.0)
    sub, _ = nnls(Xa[:, FIT] * w[:, None], ya * w)
    coef = np.zeros(len(names))
    coef[FIT] = sub
    for n, like in PRIOR.items():
        coef[names.index(n)] = max(coef[names.index(m)] for m in like)
    return coef


def ratio_model(bucket_name, per):
    """Returns the bucket's median characters per token and its worst leave-one-out error."""
    idx = [i for i in range(len(ids)) if B[i] == bucket_name]
    pairs = [(i, codepoints[i] / y[i]) for y in per for i in idx if y[i] > 0]
    ratio = float(np.median([r for _, r in pairs]))
    worst = 0.0
    for i in idx:
        r_i = float(np.median([r for j, r in pairs if j != i]))
        for r in (r_i, ratio):
            p = max(1, round(codepoints[i] / r))
            for y in per:
                worst = max(worst, abs(p - y[i]) / p)
    return ratio, worst


# Each entry is (name, tokenizers it's fitted to, source). Its margins hold for every listed tokenizer.
FAMILIES = [
    ("claude-bpe-v2", ["claude:claude-haiku-5-5", "claude:claude-opus-4-7"], "Anthropic count_tokens: Claude Haiku 5.5 (the same counts as Sonnet 5.5, Opus 5.5, Opus 5, Sonnet 5, Fable 5.1, Fable 5 and Opus 4.8) and Opus 4.7"),
    ("claude-bpe-v1", ["claude:claude-sonnet-4-6"], "Anthropic count_tokens: Claude Sonnet 4.6 (the same counts as Opus 4.6, Opus 4.5, Sonnet 4.5 and Haiku 4.5)"),
    ("o200k_base", ["o200k_base"], "tiktoken 0.14.0"),
    ("cl100k_base", ["cl100k_base"], "tiktoken 0.14.0"),
    ("gemini-sp", ["gemma-3"], "Gemma 3's tokenizer, which Google says Gemini 2.0 uses"),
    ("llama-3", ["llama-3"], "Llama 3.2's tokenizer"),
    ("qwen", ["qwen2.5"], "Qwen 2.5's tokenizer"),
    ("deepseek-v3", ["deepseek-v3"], "DeepSeek V3's tokenizer"),
    ("mistral", ["mistral-tekken", "mistral-v3-sp"], "Mistral's Tekken and v3 tokenizers, fitted together: which one a Mistral model uses is not in its name"),
    ("cohere-command-r", ["cohere-command-r"], "Command R's tokenizer"),
    ("generic", list(counts["tokenizers"].keys()), "all twelve tokenizers above, fitted together, for a model none of them is known to match"),
]


def up(v):
    """Rounds up to the next 5%."""
    return math.ceil(v * 20 - 1e-9) * 5 / 100


rng = np.random.default_rng(5)
fams = []
for name, toks, source in FAMILIES:
    per = [np.array([counts["tokenizers"][t]["counts"][i] for i in ids], dtype=float) for t in toks]
    stacked = lambda keep: (np.vstack([X[keep]] * len(per)), np.concatenate([y[keep] for y in per]))
    every = np.ones(len(ids), dtype=bool)
    Xs, ys = stacked(every)
    coef = np.round(fit(Xs, ys, np.tile(FITTED, len(per))), 5)  # rounded like the shipped weights

    worst = {(b, z): 0.0 for b in BUCKETS for z in ("small", "large")}
    seen = {k: 0 for k in worst}
    worst_short = 0.0

    def account(pred, i, count):
        # Bucket by the estimate, not the true count, because that's all the estimator has at runtime.
        global worst_short
        if B[i] in RATIO_BUCKETS:
            return
        p = max(1, round(pred))
        for y in per:
            if p < 50:
                worst_short = max(worst_short, abs(p - y[i]))
                continue
            key = (B[i], "large" if p >= 200 else "small")
            worst[key] = max(worst[key], abs(p - y[i]) / p)
            if count:
                seen[key] += 1

    for i, pred in enumerate(X @ coef):
        account(pred, i, True)
    for r in range(20):
        folds = rng.permutation(len(ids)) % 10
        for k in range(10):
            tr, te = folds != k, folds == k
            Xt, yt = stacked(tr)
            c = fit(Xt, yt, np.tile(FITTED[tr], len(per)))
            for i in np.where(te)[0]:
                account(X[i] @ c, i, False)

    margins = {}
    for b in BUCKETS:
        both = max(worst[(b, "small")], worst[(b, "large")])
        # With fewer than 5 texts of a size, use the bucket's overall worst case.
        margins[b] = {z: up(worst[(b, z)] if seen[(b, z)] >= 5 else both) for z in ("small", "large")}
    ratios = {}
    for b in RATIO_BUCKETS:
        ratios[b], w = ratio_model(b, per)
        margins[b] = {"small": up(w), "large": up(w)}
    prose = cats == "prose_en"
    fams.append({
        "name": name, "source": source,
        "proseCharsPerToken": round(float(codepoints[prose].sum() / (X[prose] @ coef).sum()), 2),
        "weights": {n: round(float(v), 5) for n, v in zip(names, coef) if v > 0},
        "margins": margins, "shortTokens": math.ceil(worst_short),
        "ratios": {b: round(r, 3) for b, r in ratios.items()},
    })
    print(f"{name:17s} prose {fams[-1]['proseCharsPerToken']:.2f} ch/tok  short ±{fams[-1]['shortTokens']}  "
          + " ".join(f"{b} ±{m['small'] * 100:.0f}/{m['large'] * 100:.0f}%" for b, m in margins.items()))


def ts_obj(d):
    return "{ " + ", ".join(f"{k}: {json.dumps(v)}" for k, v in d.items()) + " }"


lines = []
for f in fams:
    lines += [
        "  {",
        f"    name: {json.dumps(f['name'])},",
        f"    source: {json.dumps(f['source'])},",
        f"    proseCharsPerToken: {f['proseCharsPerToken']},",
        f"    weights: {ts_obj(f['weights'])},",
        "    margins: { " + ", ".join(f"{b}: {ts_obj(m)}" for b, m in f["margins"].items()) + " },",
        f"    shortTokens: {f['shortTokens']},",
        f"    charsPerToken: {ts_obj(f['ratios'])},",
        "  },",
    ]
src = f'''/**
 * Generated by scripts/token-calibration/fit.py, fitted on real tokenizer counts: do not edit by hand.
 * `weights` turn textFeatures() into tokens. `margins` are the worst relative error measured per bucket
 * and size (`small`: 50-199 tokens, `large`: 200+); `shortTokens` is the worst error in tokens below 50.
 */
import type {{ Feature }} from "./token-estimator.js";

export type ContentBucket = "prose" | "code" | "data" | "dense" | "uncommon" | "cjk" | "script" | "repetitive";

export interface FittedFamily {{
  name: string;
  /** What the counts were measured with. */
  source: string;
  /** Characters per token on English prose, for display. */
  proseCharsPerToken: number;
  weights: Partial<Record<Feature, number>>;
  margins: Record<ContentBucket, {{ small: number; large: number }}>;
  shortTokens: number;
  /** Dense and repetitive text are estimated by these characters per token, not the weights. */
  charsPerToken: {{ dense: number; repetitive: number }};
}}

export const FITTED_FAMILIES: readonly FittedFamily[] = [
{chr(10).join(lines)}
];
'''
open(OUT, "w", encoding="utf-8").write(src)
print("wrote", os.path.relpath(OUT, os.getcwd()))
