"""Demo on-call agent with the bugs the website shows costcatch finding.
It only talks to demo-api.mjs through DEMO_API_URL, never to a real provider."""

import os
import sys
import time
import uuid

import httpx

API = f"{os.environ.get('DEMO_API_URL', 'http://127.0.0.1:47820')}/incident/{uuid.uuid4().hex[:8]}/v1/messages"
MODEL = "claude-sonnet-4-20250514"
SYSTEM = "You are an on-call assistant. Use the tools to answer. Never guess."

TOOLS = [
    {
        "name": "read_file",
        "description": "Read a file from the incident workspace.",
        "input_schema": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]},
    },
    {
        "name": "get_ticket",
        "description": "Look up an incident ticket by id.",
        "input_schema": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]},
    },
    {
        "name": "submit",
        "description": "File the incident summary.",
        "input_schema": {"type": "object", "properties": {"summary": {"type": "string"}}, "required": ["summary"]},
    },
]


def checkout_log():
    lines = []
    for i in range(170):
        minute = 10 + i // 8
        level = "ERROR" if i % 9 == 0 else "WARN"
        lines.append(
            f"2026-10-13T23:{minute:02d}:{(i * 7) % 60:02d}Z payment-worker-{i % 4} {level} "
            f"db pool exhausted (20/20 in use), request {40000 + i} queued, waited {(i % 30) + 1}s"
        )
    return "\n".join(lines)


def call(messages):
    while True:
        r = httpx.post(
            API,
            json={"model": MODEL, "max_tokens": 300, "system": SYSTEM, "tools": TOOLS, "messages": messages},
            headers={"x-api-key": os.environ.get("ANTHROPIC_API_KEY", "sk-ant-demo"), "anthropic-version": "2023-06-01"},
            timeout=60,
        )
        if r.status_code == 429:
            time.sleep(1.0)
            continue
        r.raise_for_status()
        return r.json()


def run_tool(name, args):
    if name == "read_file":
        time.sleep(0.4)
        return {"content": checkout_log()}
    if name == "get_ticket":
        time.sleep(0.25)
        return {"content": f"TicketAPIError: ticket {args['id']} not found", "is_error": True}
    raise RuntimeError("submit failed: database is locked")


def main():
    messages = [{"role": "user", "content": "Why did checkout fail last night? Read the logs and check ticket INC-2041."}]
    for _ in range(8):
        reply = call(messages)
        messages.append({"role": "assistant", "content": reply["content"]})
        if reply["stop_reason"] == "max_tokens":
            messages.append({"role": "user", "content": "Continue."})
            continue
        uses = [b for b in reply["content"] if b["type"] == "tool_use"]
        if not uses:
            print(next(b["text"] for b in reply["content"] if b["type"] == "text"))
            return
        results = []
        for use in uses:
            out = run_tool(use["name"], use["input"])
            result = {"type": "tool_result", "tool_use_id": use["id"], "content": out["content"]}
            if out.get("is_error"):
                result["is_error"] = True
            results.append(result)
        messages.append({"role": "user", "content": results})


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as err:
        print(f"error: {err}", file=sys.stderr)
        sys.exit(1)
