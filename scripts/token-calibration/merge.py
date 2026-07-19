"""Merges corpus.json, counts_local.json and claude_progress.json into counts.json.
It then checks every file in this folder for the API key from the repo's .env and prints only how many contain it.

Usage: python -I merge.py
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ENV = os.path.join(HERE, "..", "..", ".env")

corpus = json.load(open(os.path.join(HERE, "data", "corpus.json"), encoding="utf-8"))
local = json.load(open(os.path.join(HERE, "data", "counts_local.json"), encoding="utf-8"))
claude = json.load(open(os.path.join(HERE, "data", "claude_progress.json"), encoding="utf-8"))

tokenizers = dict(local["tokenizers"])
families = []
for fam in claude.get("families", []):
    rep = fam["representative"]
    counts = claude.get("full", {}).get(rep, {})
    families.append({"members": fam["members"], "representative": rep, "framing": fam["framing"]})
    tokenizers[f"claude:{rep}"] = {
        "source": "Anthropic API messages.countTokens",
        "revision": "measured 2026-10-21",
        "notes": f"content tokens = count - framing ({fam['framing']}, from a one-character message less one); "
                 f"same counts on 8 probes for: {', '.join(fam['members'])}",
        "counts": counts,
    }

result = {
    "samples": [{"id": s["id"], "category": s["category"], "chars": s["chars"]} for s in corpus],
    "tokenizers": tokenizers,
    "claudeFamilies": families,
    "claudeModelErrors": claude.get("errors", {}),
    "claudeSampleErrors": claude.get("sampleErrors", {}),
    "unavailable": local.get("unavailable", {}),
}
json.dump(result, open(os.path.join(HERE, "data", "counts.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

missing = {name: sum(1 for s in corpus if t["counts"].get(s["id"]) is None) for name, t in tokenizers.items()}
print("tokenizers:", {k: len(corpus) - v for k, v in missing.items()})

key = None
for line in open(ENV, encoding="utf-8"):
    m = re.match(r"\s*ANTHROPIC_API_KEY\s*=\s*['\"]?([^'\"\s]+)", line)
    if m:
        key = m.group(1)
probes = [key, key[-12:], key[14:34]] if key else []
hits = 0
for root, dirs, files in os.walk(HERE):
    if "node_modules" in root.split(os.sep):
        continue
    for f in files:
        p = os.path.join(root, f)
        try:
            data = open(p, "rb").read().decode("latin1")
        except Exception:
            continue
        if any(k and k in data for k in probes):
            hits += 1
print("key scan: files containing the key or a piece of it:", hits)
