"""Summarizes last night's incident notes in one call (OpenAI format, to demo-api.mjs)."""

import os
import uuid

import httpx

API = f"{os.environ.get('DEMO_API_URL', 'http://127.0.0.1:47820')}/summarize/{uuid.uuid4().hex[:8]}/v1/chat/completions"

NOTES = "\n".join(f"23:{12 + i:02d} checkout error rate {40 + i * 3}%, payment worker restarts: {i}" for i in range(30))

r = httpx.post(
    API,
    json={
        "model": "gpt-4o-mini",
        "messages": [
            {"role": "system", "content": "Summarize incident notes in one sentence."},
            {"role": "user", "content": NOTES},
        ],
    },
    headers={"authorization": f"Bearer {os.environ.get('OPENAI_API_KEY', 'sk-demo')}"},
    timeout=60,
)
r.raise_for_status()
print(r.json()["choices"][0]["message"]["content"])
