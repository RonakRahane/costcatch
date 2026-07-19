"""Counts every corpus sample with tiktoken and Hugging Face tokenizers and writes data/counts_local.json.
Counts leave out special tokens, and Hugging Face files are cached under data/hf.

Usage: <venv python> -I measure_local.py
"""
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
os.environ.setdefault("HF_HOME", os.path.join(HERE, "data", "hf"))
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

import tiktoken  # noqa: E402
from huggingface_hub import hf_hub_download  # noqa: E402
from tokenizers import Tokenizer  # noqa: E402

corpus = json.load(open(os.path.join(HERE, "data", "corpus.json"), encoding="utf-8"))
out = {}

for enc_name in ("o200k_base", "cl100k_base"):
    enc = tiktoken.get_encoding(enc_name)
    out[enc_name] = {
        "source": f"tiktoken {tiktoken.__version__}, encoding {enc_name}",
        "revision": tiktoken.__version__,
        "notes": "encode(text, disallowed_special=()), no special tokens",
        "counts": {s["id"]: len(enc.encode(s["text"], disallowed_special=())) for s in corpus},
    }
    print(enc_name, "done", file=sys.stderr)

# Candidate repos for each tokenizer, official first and then ungated mirrors.
HF = {
    "deepseek-v3": (["deepseek-ai/DeepSeek-V3", "deepseek-ai/DeepSeek-V3-0324"], ""),
    "qwen2.5": (["Qwen/Qwen2.5-7B-Instruct"], ""),
    "llama-3": (["meta-llama/Llama-3.2-1B-Instruct", "unsloth/Llama-3.2-1B-Instruct", "NousResearch/Meta-Llama-3-8B-Instruct"], "Llama 3.x tokenizer (128K vocab)"),
    "gemma-3": (["google/gemma-3-1b-it", "unsloth/gemma-3-1b-it"], "Gemma 3 tokenizer, which Google states is shared with Gemini 2.0: a proxy for Gemini, not Gemini itself"),
    "mistral-tekken": (["mistralai/Mistral-Nemo-Instruct-2407", "unsloth/Mistral-Nemo-Instruct-2407"], "Tekken tokenizer (Mistral NeMo and later)"),
    "mistral-v3-sp": (["mistralai/Mistral-7B-Instruct-v0.3", "unsloth/mistral-7b-instruct-v0.3"], "SentencePiece v3 tokenizer (Mistral 7B v0.3, older Mistral models)"),
    "cohere-command-r": (["CohereLabs/c4ai-command-r-v01", "CohereForAI/c4ai-command-r-v01", "CohereLabs/c4ai-command-r7b-12-2024", "Xenova/c4ai-command-r-v01-tokenizer"], "Command R tokenizer"),
}
unavailable = {}
for name, (repos, note) in HF.items():
    errors = []
    for repo in repos:
        try:
            path = hf_hub_download(repo, "tokenizer.json")
        except Exception as exc:  # gated, missing or a network error
            errors.append(f"{repo}: {type(exc).__name__}: {str(exc).splitlines()[0][:160]}")
            continue
        revision = path.split("/snapshots/")[1].split("/")[0] if "/snapshots/" in path else "unknown"
        tok = Tokenizer.from_file(path)
        t0 = time.time()
        counts = {s["id"]: len(tok.encode(s["text"], add_special_tokens=False).ids) for s in corpus}
        out[name] = {
            "source": f"huggingface:{repo}/tokenizer.json",
            "revision": revision,
            "notes": (note + "; " if note else "") + "tokenizers Tokenizer.encode(add_special_tokens=False)"
            + ("" if repo == repos[0] else f"; mirror (official repo unavailable: {errors[0]})"),
            "counts": counts,
        }
        print(name, "done from", repo, f"{time.time() - t0:.1f}s", file=sys.stderr)
        break
    else:
        unavailable[name] = errors
        print(name, "UNAVAILABLE", errors, file=sys.stderr)

json.dump({"tokenizers": out, "unavailable": unavailable}, open(os.path.join(HERE, "data", "counts_local.json"), "w"), indent=1)
print("measured:", ", ".join(out), "| unavailable:", ", ".join(unavailable) or "none")
