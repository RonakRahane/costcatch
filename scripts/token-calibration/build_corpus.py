"""Builds data/corpus.json, the text samples used to measure token counts.
Repo files are sampled as they are when it runs, so the corpus changes with the repo.

Usage: python build_corpus.py
"""
import base64
import glob
import json
import os
import random
import re
import sys
import urllib.parse
import urllib.request
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
DATA = os.path.join(HERE, "data")
UA = {"User-Agent": "costcatch-calibration/0.1 (https://github.com/costcatch; token-count research) python-urllib"}
SIZES = [300, 900, 1800, 3200, 5200]  # target chunk sizes in chars, used in turn

samples = []


def add(category, source, text, cap=6000):
    text = text.strip("\n")
    if len(text) > cap:
        text = text[:cap].rsplit("\n", 1)[0] if "\n" in text[:cap] else text[:cap]
    if not text.strip() or any(x["text"] == text for x in samples):
        return
    samples.append({"id": f"{category}-{sum(1 for s in samples if s['category'] == category) + 1:03d}",
                    "category": category, "source": source, "chars": len(text), "text": text})


def chunks(text, limit, start_size=0, min_chars=200, max_chars=6000):
    """Splits text at line breaks into chunks near the target sizes."""
    lines = text.split("\n")
    out, cur, k = [], [], start_size
    for line in lines:
        cur.append(line)
        size = len("\n".join(cur))
        if size >= SIZES[k % len(SIZES)]:
            chunk = "\n".join(cur)
            if len(chunk) > max_chars:
                chunk = chunk[:max_chars].rsplit("\n", 1)[0] or chunk[:max_chars]
            if len(chunk.strip()) >= min_chars:
                out.append(chunk)
                k += 1
            cur = []
            if len(out) >= limit:
                break
    if len(out) < limit and cur:
        chunk = "\n".join(cur)[:max_chars]
        if len(chunk.strip()) >= min_chars:
            out.append(chunk)
    return out


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def spread(items, n):
    if len(items) <= n:
        return items
    step = len(items) / n
    # The offset mixes in different chunk sizes. Without it, a step that's a multiple of
    # len(SIZES) would always pick the same size.
    return [items[j] for j in sorted({min(len(items) - 1, int(i * step) + i % len(SIZES)) for i in range(n)})]


def fetch(url, tries=6):
    """Retries 429 and 5xx responses with backoff, since Wikimedia rate-limits bursts."""
    import time
    import urllib.error
    delay = 5
    for attempt in range(tries):
        req = urllib.request.Request(url, headers=UA)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read().decode("utf-8", "replace")
            time.sleep(1.5)
            return body
        except urllib.error.HTTPError as exc:
            if exc.code not in (429, 500, 502, 503, 504) or attempt == tries - 1:
                raise
            retry_after = exc.headers.get("Retry-After")
            time.sleep(int(retry_after) if retry_after and retry_after.isdigit() else delay)
            delay *= 2


def repo_category(category, paths, per_file, total):
    picked = []
    for i, p in enumerate(paths):
        try:
            text = read(p)
        except Exception:
            continue
        for c in chunks(text, per_file, start_size=i):
            picked.append((os.path.relpath(p, REPO), c))
    for src, c in spread(picked, total):
        add(category, src, c)


docs = [f"{REPO}/README.md"] + sorted(glob.glob(f"{REPO}/docs/*.md"))
repo_category("docs_md", docs, 5, 24)
ts = sorted(p for p in glob.glob(f"{REPO}/src/**/*.ts", recursive=True))
repo_category("code_ts", ts, 2, 24)
repo_category("code_js", [f"{REPO}/src/interceptors/node/preload.cjs"] + sorted(glob.glob(f"{REPO}/e2e/*.mjs")), 12, 12)
repo_category("code_py", [f"{REPO}/src/interceptors/python/sitecustomize.py"], 10, 10)
repo_category("json", [f"{REPO}/src/pricing/fallback-prices.json"] + sorted(glob.glob(f"{REPO}/tests/fixtures/*.json")) + [f"{REPO}/package.json"], 8, 10)
repo_category("yaml", sorted(glob.glob(f"{REPO}/.github/workflows/*.yml")), 3, 4)
tsx = sorted(p for p in glob.glob(f"{REPO}/web/**/*.tsx", recursive=True) if "/node_modules/" not in p and "/.next/" not in p)
repo_category("tsx", tsx, 2, 8)
css = sorted(p for p in glob.glob(f"{REPO}/web/**/*.css", recursive=True) if "/node_modules/" not in p and "/.next/" not in p)
repo_category("css", css, 3, 4)

try:
    pp = fetch("https://www.gutenberg.org/cache/epub/1342/pg1342.txt")
    body = pp.split("*** START OF", 1)[-1].split("*** END OF", 1)[0]
    body = body.split("\n", 1)[1] if "\n" in body else body
    paras = body.replace("\r\n", "\n")
    m = re.search(r"Chapter I\.\]?\s*\n", paras)
    if m:
        paras = paras[m.end():]
    picked = chunks(paras, 400)
    for c in spread(picked, 16):
        add("prose_en", "gutenberg:1342 (Pride and Prejudice)", c)
except Exception as exc:
    print("gutenberg failed:", exc, file=sys.stderr)

WIKI = {
    "cjk_zh": ("zh", ["人工智能", "长城", "北京"]),
    "cjk_ja": ("ja", ["人工知能", "富士山", "東京"]),
    "cjk_ko": ("ko", ["인공지능", "서울특별시", "한글"]),
    "hi": ("hi", ["भारत", "कृत्रिम बुद्धिमत्ता", "दिल्ली"]),
    "ru": ("ru", ["Искусственный интеллект", "Москва", "Байкал"]),
    "ar": ("ar", ["ذكاء اصطناعي", "القاهرة", "نهر النيل"]),
    "latin_es": ("es", ["Inteligencia artificial", "Madrid", "Río Amazonas"]),
    "latin_de": ("de", ["Künstliche Intelligenz", "Berlin", "Rhein"]),
    "latin_fr": ("fr", ["Intelligence artificielle", "Paris", "Loire"]),
}
for category, (lang, titles) in WIKI.items():
    picked = []
    for t in titles:
        q = urllib.parse.urlencode({"action": "query", "prop": "extracts", "explaintext": 1, "format": "json",
                                    "redirects": 1, "titles": t, "exlimit": 1})
        try:
            data = json.loads(fetch(f"https://{lang}.wikipedia.org/w/api.php?{q}"))
            for page in data["query"]["pages"].values():
                text = page.get("extract") or ""
                text = re.sub(r"\n{3,}", "\n\n", text)
                for c in chunks(text, 4, start_size=len(picked)):
                    picked.append((f"wikipedia:{lang}:{page.get('title')}", c))
        except Exception as exc:
            print(f"wikipedia {lang} {t} failed:", exc, file=sys.stderr)
    for src, c in spread(picked, 5):
        add(category, src, c)

rng = random.Random(20261021)
WORDS = "order customer refund shipping invoice delivered pending cancelled warehouse priority express standard".split()
NAMES = ["Ann", "Bo", "Chen Wei", "Dana", "Émile", "Farah", "Gita", "Hiro", "Ivan", "José", "Kofi", "Lena"]


def record():
    return {"id": f"A{rng.randint(1000, 9999)}", "customer": rng.choice(NAMES), "status": rng.choice(WORDS),
            "total": round(rng.uniform(3, 900), 2), "items": [{"sku": f"SKU-{rng.randint(100, 999)}", "qty": rng.randint(1, 5)} for _ in range(rng.randint(1, 3))],
            "created": f"2026-{rng.randint(1, 12):02d}-{rng.randint(1, 28):02d}T{rng.randint(0, 23):02d}:{rng.randint(0, 59):02d}:00Z",
            "notes": " ".join(rng.choice(WORDS) for _ in range(rng.randint(0, 8)))}


for target in (400, 1200, 2500, 4000, 5800):
    recs = []
    while len(json.dumps(recs + [record()], separators=(",", ":"), ensure_ascii=False)) < target:
        recs.append(record())
    add("json_min", "generated", json.dumps(recs, separators=(",", ":"), ensure_ascii=False))
for n in (10, 40, 80, 120):
    rows = ["id,customer,status,total,created"] + [",".join(str(r[k]) for k in ("id", "customer", "status", "total", "created")) for r in (record() for _ in range(n))]
    add("csv", "generated", "\n".join(rows))
for n in (5, 15, 30, 45):
    xml = ["<?xml version=\"1.0\" encoding=\"UTF-8\"?>", "<orders>"]
    for r in (record() for _ in range(n)):
        xml.append(f"  <order id=\"{r['id']}\" status=\"{r['status']}\">\n    <customer>{r['customer']}</customer>\n    <total currency=\"USD\">{r['total']}</total>\n    <created>{r['created']}</created>\n  </order>")
    xml.append("</orders>")
    add("xml_html", "generated", "\n".join(xml))
html = ["<!doctype html>", "<html lang=\"en\">", "<head><meta charset=\"utf-8\"><title>Orders</title></head>", "<body>", "<table class=\"orders\">"]
for r in (record() for _ in range(30)):
    html.append(f"  <tr><td class=\"id\">{r['id']}</td><td>{r['customer']}</td><td><span class=\"badge badge-{r['status']}\">{r['status']}</span></td><td>${r['total']}</td></tr>")
html += ["</table>", "</body>", "</html>"]
add("xml_html", "generated", "\n".join(html))
for n in (8, 25, 50, 70, 90):
    lines = []
    for _ in range(n):
        lvl = rng.choice(["INFO", "WARN", "ERROR", "DEBUG"])
        lines.append(f"2026-10-{rng.randint(1, 28):02d}T{rng.randint(0, 23):02d}:{rng.randint(0, 59):02d}:{rng.randint(0, 59):02d}.{rng.randint(0, 999):03d}Z {lvl} [worker-{rng.randint(1, 8)}] "
                     f"GET https://api.example.com/v1/orders/{rng.randint(10000, 99999)}?expand=items status={rng.choice([200, 201, 404, 429, 500])} "
                     f"latency_ms={rng.randint(3, 4000)} request_id={uuid.UUID(int=rng.getrandbits(128))}")
    add("logs", "generated", "\n".join(lines))
for n in (300, 1500, 4000):
    add("base64", "generated", base64.b64encode(bytes(rng.getrandbits(8) for _ in range(n))).decode())
for n in (8, 40, 120):
    add("uuid", "generated", "\n".join(str(uuid.UUID(int=rng.getrandbits(128))) for _ in range(n)))
EMOJI = ["😀", "🎉", "👍", "🔥", "❤️", "🚀", "😅", "🙏", "✅", "🤔", "😂", "🥳"]
CHAT = ["hey are we still on for tonight", "lol yes", "running 10 min late sorry", "no worries", "did you see the game", "that was wild",
        "can you send me the doc", "sent!", "thanks so much", "omg finally", "pizza or tacos", "tacos obviously"]
for n in (10, 30, 60, 90):
    add("emoji_chat", "generated", "\n".join(f"{rng.choice(NAMES)}: {rng.choice(CHAT)} {''.join(rng.choice(EMOJI) for _ in range(rng.randint(1, 4)))}" for _ in range(n)))
for n in (10, 30, 60, 100):
    rows = ["| quarter | revenue | cost | margin | growth |", "|---|--:|--:|--:|--:|"] if n % 20 == 10 else ["quarter revenue cost margin growth"]
    for i in range(n):
        rev = rng.uniform(1e5, 9e6)
        cost = rev * rng.uniform(0.4, 0.95)
        vals = [f"Q{i % 4 + 1}-{2000 + i // 4}", f"{rev:,.2f}", f"{cost:,.2f}", f"{(rev - cost) / rev * 100:.1f}%", f"{rng.uniform(-30, 60):+.2f}%"]
        rows.append(("| " + " | ".join(vals) + " |") if rows[0].startswith("|") else " ".join(vals))
    add("numbers_table", "generated", "\n".join(rows))
for n in (6, 15, 30, 45):
    rows = ["| Feature | Status | Owner | Notes |", "|---|---|---|---|"]
    for _ in range(n):
        rows.append(f"| {rng.choice(WORDS).title()} {rng.choice(WORDS)} | {rng.choice(['done', 'in progress', 'blocked', 'todo'])} | {rng.choice(NAMES)} | {' '.join(rng.choice(WORDS) for _ in range(rng.randint(2, 9)))} |")
    add("markdown_table", "generated", "\n".join(rows))

SHORT = [
    "PENDING", "OK", "42", "3.14159", str(uuid.UUID(int=rng.getrandbits(128))), "true", "null", "{}", "[]",
    '{"status":"ok"}', '{"temp": 21.5, "unit": "C"}', "Error: file not found", "What is the weather in Paris?",
    "Summarize this.", "A1001: delivered 2026-10-02", "Returns are accepted within 30 days of delivery.",
    "你好，世界", "こんにちは、元気ですか？", "👍", "✅ Done", "https://example.com/api/v1/orders?id=123&expand=items",
    "/usr/local/bin/node", "SELECT * FROM users WHERE id = 1;", "def f(x):\n    return x * 2", "console.log('hi');",
    "200 OK", "The quick brown fox jumps over the lazy dog.", "yes", "No results found for your query.",
    "id,name\n1,Ann\n2,Bo", "2026-10-21T00:47:05Z", "Привет, как дела?", "مرحبا بالعالم", "नमस्ते दुनिया",
]
for s in SHORT:
    samples.append({"id": f"short-{sum(1 for x in samples if x['category'] == 'short') + 1:03d}", "category": "short",
                    "source": "generated", "chars": len(s), "text": s})

# Long unspaced text like IDs, hex and minified code, where tokenizers differ the most.
LOWER = "abcdefghijklmnopqrstuvwxyz"
lr = random.Random(20261021)
def rand(chars, n):
    return "".join(lr.choice(chars) for _ in range(n))
src = open(os.path.join(REPO, "src/core/redact.ts"), encoding="utf-8").read()
minified = re.sub(r"\s+", " ", re.sub(r"/\*[\s\S]*?\*/|//[^\n]*", "", src)).replace(" = ", "=").replace(", ", ",")[:3000]
LOREM = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua".split()
LONGRUN = [
    ("z" * 12000, "one letter repeated, 12,000 times"),
    ("y" * 3000, "one letter repeated, 3,000 times"),
    ("ab" * 2000, "two letters repeated"),
    ("abc" * 1200, "three letters repeated"),
    ("-" * 2000, "one symbol repeated"),
    (rand(LOWER, 3000), "random lowercase letters"),
    (rand("0123456789abcdef", 4000), "random hex"),
    (rand(LOWER + "0123456789", 2500), "random lowercase letters and digits"),
    ("".join(lr.choice(LOREM) for _ in range(500)), "words with no spaces between them"),
    ("https://api.example.com/v2/search?" + "&".join(f"{rand(LOWER, 6)}={rand(LOWER + '0123456789', 12)}" for _ in range(60)), "a long URL"),
    (minified, "minified TypeScript (src/core/redact.ts)"),
    ("".join(w.capitalize() for w in (lr.choice(LOREM) for _ in range(400))), "one long camelCase identifier"),
]
for i, (text, what) in enumerate(LONGRUN, 1):
    samples.append({"id": f"longrun-{i:03d}", "category": "longrun", "source": f"generated: {what}", "chars": len(text), "text": text})

os.makedirs(DATA, exist_ok=True)
with open(os.path.join(DATA, "corpus.json"), "w", encoding="utf-8") as f:
    json.dump(samples, f, ensure_ascii=False, indent=1)
from collections import Counter
cats = Counter(s["category"] for s in samples)
print(len(samples), "samples;", sum(s["chars"] for s in samples), "chars")
print(", ".join(f"{k}={v}" for k, v in sorted(cats.items())))
print("long out of range:", [s["id"] for s in samples if s["category"] not in ("short", "longrun") and not (200 <= s["chars"] <= 6000)])
