<div align="center">

# agent-trace ⚡

### Zero-instrumentation, terminal-native LLM agent tracer

**Like `time`, but for AI agents.**

[![npm version](https://img.shields.io/npm/v/agent-trace.svg)](https://www.npmjs.com/package/agent-trace)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-131%20passing-brightgreen.svg)](#testing)

**No code changes. No SDK. No account. No API keys given to us. Fully local.**

</div>

---

## What is agent-trace?

`agent-trace` is a CLI tool that captures every LLM API call your AI agent makes — models, tokens, cost, tool calls, conversation content, errors, and retries — and renders it as a live, in-place trace right in your terminal.

You prefix your command with `agent-trace`, exactly like you'd prefix a command with `time`:

```bash
agent-trace python my_agent.py
agent-trace node   my_agent.js
```

While your program runs, you see a live dashboard:

```
╭─ ⚡ agent-trace ───────────────────────────────────────── ⧗ 18.3s  $0.21 ─╮
│                                                                            │
│ ✓ ① claude-sonnet-4-6    0.8s   1,203 → 87 tok   $0.004                   │
│    └─ ⚡ web_search("Tesla Q4 2024 revenue")                              │
│                                                                            │
│ ✓ ② claude-sonnet-4-6    1.4s   5,891 → 92 tok   $0.019                   │
│    ⚠ context grew 4.9× (1,203 → 5,891 tok)                               │
│                                                                            │
│ ⠹ ·· claude-sonnet-4-6   2.3s   thinking…                                │
│                                                                            │
│ ── summary                                                                 │
│ 3 LLM calls  ·  2 tool calls  ·  18.3s  ·  $0.21                          │
│ 20k → 271 tok  ·  at 100 runs/day = $630/mo                               │
╰─ 3 calls · 20k→271 tok · $0.21 ──────────────────────────────────────────╯
```

In-flight calls show a live spinner and ticking timer. Completed calls settle into the tree with exact tokens and cost. Your program's own stdout scrolls above the box, untouched. On exit, the live region collapses into one clean, final trace.

---

## Why agent-trace?

Every existing LLM tracer has a tax:

| Tool | Tax |
|------|-----|
| **LangSmith** | Requires LangChain |
| **Helicone** | Requires changing your API base URL (proxy) |
| **Langfuse / Braintrust** | Cloud-first, needs an account + API key |
| **OpenTelemetry** | Takes an afternoon to wire up with custom spans |
| **Datadog LLM Observability** | Enterprise pricing, agent overhead |

`agent-trace` has **zero tax**:

- ✅ Works by **prefixing your command** — no code changes, no SDK imports, no decorators
- ✅ Captures at the **HTTP layer** — survives SDK version bumps, works across any library
- ✅ **Fully local** — your data never leaves your machine
- ✅ **Free and open source** — MIT license, no account, no cloud, no telemetry

---

## Table of Contents

- [Install](#install)
- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [Commands](#commands)
  - [run (default)](#run-default)
  - [show](#show)
  - [replay](#replay)
  - [diff](#diff)
  - [stats](#stats)
  - [watch](#watch)
  - [init](#init)
- [Features](#features)
  - [Live Terminal Dashboard](#live-terminal-dashboard)
  - [Content Inspection](#content-inspection-show--inspect)
  - [Auto-Diff for Prompt Iteration](#auto-diff-for-prompt-iteration-compare-last)
  - [CI Assertion Gates](#ci-assertion-gates)
  - [Warning Engine](#warning-engine)
  - [Error & Retry Surfacing](#error--retry-surfacing)
  - [Automatic Secret & PII Redaction](#automatic-secret--pii-redaction)
  - [Cost Tracking](#cost-tracking)
  - [Aggregated Analytics](#aggregated-analytics)
- [Supported Providers](#supported-providers)
- [Streaming & Token Accuracy](#streaming--token-accuracy)
- [Honest Limitations](#honest-limitations)
- [Architecture](#architecture)
- [Development](#development)
- [Testing](#testing)
- [License](#license)

---

## Install

```bash
npm install -g agent-trace
```

Then, in your project directory:

```bash
agent-trace init
```

This creates `.agent-traces/` (and `.gitignore`s it) and fetches the latest model pricing database (300+ models).

> **Python support ships inside the npm package** — there is nothing to `pip install`.

### Requirements

- Node.js ≥ 18
- Python 3.7+ (for tracing Python agents — no pip install required)

---

## Quick Start

### Trace a Python agent

```bash
agent-trace python my_agent.py
```

### Trace a Node.js agent

```bash
agent-trace node my_agent.js
```

### Save the trace for later inspection

```bash
agent-trace python my_agent.py --save
```

### Inspect what the model actually saw and said

```bash
agent-trace show .agent-traces/latest-trace.json
agent-trace show trace.json --step 3          # zoom into step 3
agent-trace show trace.json --grep "search"   # find + highlight a string
```

### Iterate on a prompt and see what changed

```bash
# First run:
agent-trace python my_agent.py --save
# Edit your prompt, re-run:
agent-trace python my_agent.py --save --compare-last
```

### Use as a CI regression gate

```bash
agent-trace python tests/agent_test.py --max-cost 0.10 --max-calls 8
# Exit code 1 if cost or call count exceeds the threshold
```

---

## How It Works

`agent-trace` spawns your program with a runtime-specific hook injected, captures all outbound HTTP requests to known LLM provider endpoints, streams them to a temp NDJSON file, and renders the trace in real time.

### Node.js Interception

Injects an interceptor via `node --require` that monkey-patches `https.request`, `http.request`, and `globalThis.fetch`. Every matched request is captured with full request/response bodies, timing, and status codes.

### Python Interception

Prepends a directory to `PYTHONPATH` so a `sitecustomize.py` auto-loads and patches `httpx.Client`, `httpx.AsyncClient`, and `urllib3.HTTPConnectionPool` (which covers `requests`, most SDKs, LangChain, LiteLLM, CrewAI, etc.).

### Safety Guarantees

The interceptor is **purely observational**:

- Every patch is wrapped in `try/except` — if anything goes wrong, your program still runs correctly
- Response bodies are read without consuming them (BytesIO splicing for Python, buffer cloning for Node)
- The interceptor never modifies request headers, bodies, or timing
- Everything stays 100% local — no data is sent anywhere

### Two-Phase Protocol

Interceptors emit a lightweight `phase: "start"` record the moment a matched request is dispatched, followed by a `phase: "end"` record when the response completes. This enables:

- Showing in-flight calls with a spinner + ticking timer
- Correct timing even when calls overlap (parallel tool execution)
- Progressive rendering before the response arrives

---

## Commands

### `run` (default)

Trace any Python or Node.js command. `run` is the default — you can omit it.

```bash
agent-trace python my_agent.py
agent-trace run node my_agent.js  # equivalent
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--save` | Save the trace to `.agent-traces/` |
| `--save-as <name>` | Save with a specific filename |
| `--inspect` | After the run, show the full conversation content of every step |
| `--compare-last` | Auto-diff against the most recent saved trace for this script (implies `--save`) |
| `--max-cost <usd>` | **CI gate**: exit code 1 if total cost exceeds N USD |
| `--max-calls <n>` | **CI gate**: exit code 1 if LLM call count exceeds N |
| `--budget <usd>` | Mid-run guard: warn/abort if cost exceeds N USD during the run |
| `--no-cost` | Hide the cost column |
| `--json` | Emit the trace as JSON (for `jq` / CI). Suppresses all animation |
| `--no-color` | Plain, ANSI-free output (also honors `NO_COLOR` env var) |
| `--filter <provider>` | Only show calls to one provider (e.g. `--filter anthropic`) |
| `--threshold <ms>` | Warn on LLM calls slower than N ms |
| `--quiet` | Print only the one-line summary |
| `--stream` | Hint for streamed responses (see [Streaming](#streaming--token-accuracy)) |

**Output modes:**

The live TUI (animated box with spinners) activates only on an interactive, colored terminal. In CI, when piped, with `--json`, `--quiet`, or `--no-color`, output falls back to clean sequential lines — no cursor control, safe for log files.

---

### `show`

**Inspect the actual conversation** — system prompt, messages, model output, errors — for every step in a saved trace.

```bash
agent-trace show trace.json               # all steps
agent-trace show trace.json --step 3      # zoom into step 3
agent-trace show trace.json --grep "loop"  # search + highlight matches
```

This is the highest-value command. Agent debugging is almost never "what did it call?" — it's **"what was in the prompt that made it loop?"**

| Flag | Description |
|------|-------------|
| `--step <n>` | Show only step N (1-indexed) |
| `--grep <term>` | Search for a string across all steps, highlight matches |
| `--no-color` | Plain text output |

**Backward-compatible:** Old traces saved before content capture was added will show `no content captured — re-run to inspect` instead of crashing.

---

### `replay`

Re-render a saved trace without re-running the script.

```bash
agent-trace replay .agent-traces/2026-07-09T14-32-17.json
agent-trace replay trace.json --json   # machine-readable output
```

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON |
| `--cost` | Show cost breakdown (default: on) |
| `--no-color` | Plain text output |

---

### `diff`

Compare two saved traces side by side — steps, tokens, cost, latency, added/removed tool calls.

```bash
agent-trace diff before.json after.json
```

Shows:

- Step count, LLM calls, tool calls (with ✓ if reduced)
- Duration change (with percentage)
- Cost change (with percentage, ✓ if reduced)
- Token delta per step
- Exact tool calls added or removed

---

### `stats`

Aggregated analytics across all saved traces in your project.

```bash
agent-trace stats              # all time
agent-trace stats --today      # today only
agent-trace stats --week       # last 7 days
agent-trace stats --script my_agent.py  # filter by script
agent-trace stats --model gpt-4o       # filter by model
```

Shows total runs, total cost, average cost per run, most expensive models, most used tools, and cost trend.

---

### `watch`

A traced run that always saves. Same as `run --save` with the live view guaranteed on.

```bash
agent-trace watch python my_agent.py
```

---

### `init`

Set up `agent-trace` in your project:

```bash
agent-trace init
```

This:

1. Creates `.agent-traces/` for saved traces
2. Adds `.agent-traces/` to `.gitignore`
3. Fetches the latest model pricing database (300+ models from LiteLLM)

---

## Features

### Live Terminal Dashboard

While your program runs, `agent-trace` renders a live, in-place dashboard at ~12 FPS:

- **In-flight calls**: braille spinner + ticking timer + model name
- **Completed calls**: status badge (✓/✗) + model + duration + tokens → tokens + cost
- **Tool calls**: rendered inline under the LLM step that triggered them
- **Summary footer**: total calls, total tokens, total cost, cost projection
- **Matrix banner**: animated dot-matrix reveal header (pure aesthetic, zero performance impact)
- **Your program's output**: scrolls above the box, untouched

The live region uses cursor control for flicker-free redraws. On exit, it collapses into a clean, static trace.

---

### Content Inspection (`show` / `--inspect`)

Every captured LLM call stores the actual conversation content:

- **System prompt** (with delta detection — only stored when it changes between calls)
- **Input messages** (user, assistant, tool results)
- **Model output** (text, tool calls)
- **Error details** (HTTP status, provider error type and message)
- **Retry markers** (which earlier step this call retried)

All content is automatically **redacted** and **truncated** before storage (see [Redaction](#automatic-secret--pii-redaction)).

```bash
# After a run:
agent-trace python my_agent.py --save --inspect

# Or later:
agent-trace show trace.json --step 3
agent-trace show trace.json --grep "hallucination"
```

---

### Auto-Diff for Prompt Iteration (`--compare-last`)

Prompt iteration is the #1 agent-dev activity. `--compare-last` makes it one flag instead of juggling two files:

```bash
# First run:
agent-trace python my_agent.py --save

# Edit the prompt, re-run:
agent-trace python my_agent.py --save --compare-last
```

**Semantic step-matching:** Steps are matched by a fingerprint of `(model + sorted tool call names)`, not by index position. This means an inserted or removed step won't cascade spurious diffs on every subsequent line.

---

### CI Assertion Gates

Turn `agent-trace` into a regression gate in your CI pipeline:

```bash
# In your CI script / GitHub Action:
agent-trace python tests/agent_test.py --max-cost 0.10 --max-calls 8
```

- `--max-cost <usd>`: exit code 1 if total cost exceeds the threshold
- `--max-calls <n>`: exit code 1 if LLM call count exceeds the threshold

This is a snapshot test for agent behavior — it catches regressions where a prompt change causes the agent to loop, use more calls, or pick a more expensive model. It's the one feature that gets the tool used by a whole team instead of just the person who installed it.

**JSON output for CI parsing:**

```bash
agent-trace python tests/agent_test.py --json | jq '.summary'
# { "llmCalls": 4, "toolCalls": 2, "totalInputTokens": 8291, ... }
```

---

### Warning Engine

From the raw traffic alone, `agent-trace` reconstructs your agent's behavior and automatically flags problems:

| Warning | Severity | What it detects |
|---------|----------|-----------------|
| **HTTP errors** | 🔴 Critical | 429 rate limits, 500 server errors, 401 auth failures |
| **Silent retries** | 🟡 Warn | Same prompt re-sent after a failure (SDK auto-retry) |
| **Context bloat** | 🟡 Warn / 🔴 Critical | Input tokens growing >3× across calls (the #1 cost driver) |
| **Context spike** | 🟡 Warn | Input tokens growing >4× between two adjacent steps |
| **Duplicate tool calls** | 🟡 Warn / ℹ️ Info | Near-identical function calls across steps (>80% arg similarity) |
| **Cost concentration** | 🟡 Warn | A single step consuming >50% of total cost |
| **Latency spikes** | ℹ️ Info | Steps exceeding `--threshold` (default 10s) |

Warnings appear in the trace footer, sorted by severity (critical first).

---

### Error & Retry Surfacing

Failed LLM calls and silent retries are surfaced as first-class elements in the trace:

- **Red ✗ badge** on error steps (vs green ✓ on success)
- **HTTP status code** + provider error type (`rate_limit_error`, `overloaded_error`, etc.)
- **Error message** extracted from the response body (OpenAI, Anthropic, and generic shapes)
- **Retry markers** (`→→ retry of step 3`) when a later call re-sends the same prompt

No more staring at logs wondering why your agent made 12 calls when it should have made 4.

---

### Automatic Secret & PII Redaction

All captured content is scrubbed before storage or display. Two tiers, both on by default:

**Tier 1 — Secrets (always redacted):**

| Pattern | Provider |
|---------|----------|
| `sk-proj-*`, `sk-*` | OpenAI |
| `sk-ant-api03-*` | Anthropic |
| `AIzaSy*` | Google |
| `AKIA*` | AWS |
| `gsk_*` | Groq |
| `r8_*` | Replicate |
| `ghp_*` | GitHub |
| `xoxb-*`, `xoxp-*` | Slack |
| `Bearer <token>` | Any Authorization header |
| `api_key: <value>` | Labeled key-value pairs |

**Tier 2 — PII (on by default, opt-out with `--no-redact`):**

- Email addresses → `«email»`
- Phone numbers with separators → `«phone»` (won't false-positive on token counts)
- Luhn-valid credit card numbers → `«card»` (won't false-positive on random digit sequences)

> **Note:** Request headers (where API keys normally live) are **never captured** in the first place. This redaction layer only guards secrets a user pasted INTO a prompt or that a tool result echoed back.

---

### Cost Tracking

Every LLM call is priced using a bundled, offline pricing database:

- **300+ models** from OpenAI, Anthropic, Google, Groq, Mistral, Cohere, Ollama, and more
- **Token counts come straight from the API response** — never estimated or guessed
- **Per-step cost**: shown inline next to each call in the trace
- **Total cost**: shown in the header and summary
- **Cost projection**: "at 100 runs/day = $X/mo" to contextualize one-off costs
- **Refreshable**: `agent-trace init` fetches the latest pricing from LiteLLM's database
- **Graceful fallback**: if a model isn't in the database, tokens still show and cost shows `$?.??`

---

### Aggregated Analytics

The `stats` command aggregates across all saved traces:

```bash
agent-trace stats --week
```

Shows: total runs, total cost, average cost per run, most expensive models, most-used tools, and temporal trends. Filter by `--today`, `--week`, `--script`, or `--model`.

---

## Supported Providers

| Provider | Detection | Notes |
|----------|-----------|-------|
| **OpenAI** | `api.openai.com` | Full support including streaming, tools, vision |
| **Azure OpenAI** | `*.openai.azure.com` | Same parser as OpenAI |
| **Anthropic** | `api.anthropic.com` | System prompts, content blocks, tool_use, cache metrics |
| **Google Gemini** | `generativelanguage.googleapis.com` | contents/candidates schema |
| **OpenRouter** | `openrouter.ai` | OpenAI-compatible, with provider pass-through |
| **Groq** | `api.groq.com` | OpenAI-compatible |
| **Mistral** | `api.mistral.ai` | OpenAI-compatible |
| **Ollama** | `localhost:11434` | OpenAI-compatible local models |
| **Cohere** | `api.cohere.ai` | Native parser for chat/generate |
| **Generic** | Any URL with `/chat/completions` | Catches any OpenAI-compatible endpoint |

---

## Streaming & Token Accuracy

| Provider | Streaming Support | Token Accuracy |
|----------|-------------------|----------------|
| **Anthropic** | ✅ Streams always include usage | Exact |
| **OpenAI** | ⚠️ Requires `stream_options: { include_usage: true }` | Exact when enabled |
| **Others** | ✅ Best-effort SSE chunk reassembly | Exact when usage is present |

If OpenAI streaming usage is missing, the call is still captured (model, timing, tool calls) and `agent-trace` prints a tip explaining how to enable it. Token counts are **never estimated or fabricated**.

---

## Honest Limitations

We believe in honesty about what a tool can and can't do:

### What agent-trace can NOT see

Because tracing happens at the HTTP layer (not inside your code):

- **Local tool execution** (a Python function your agent calls) makes no HTTP request, so it doesn't appear as its own step. You see it as the `tool_use` block the model requested and the context growth on the next call.
- **Concurrent calls** (e.g. parallel LangGraph nodes) are captured and grouped, but HTTP alone can't attribute them to named graph nodes.
- **gRPC transports** (used by some Google Cloud services) bypass HTTP interception and are invisible.
- **In-process SDKs** that skip HTTP entirely (rare, but possible) won't be captured.

### What agent-trace IS

- A **developer tool**, not a production monitoring system. It's for your terminal, not your dashboard.
- A **single-machine tool**. It sees traffic from the process you spawn, not from a distributed system.
- A **best-effort tool**. If interception fails, your program runs correctly — the trace just has gaps.

---

## Architecture

```
src/
├── index.ts               CLI entry point (Commander.js)
├── cli/                   Command handlers (run, show, replay, diff, stats, watch, init)
├── core/
│   ├── tracer.ts           Spawns child process with interceptor injected
│   ├── trace-builder.ts    Raw HTTP calls → structured Trace object
│   ├── content-extractor.ts  Extracts conversation from request/response bodies
│   ├── redact.ts           Secret + PII scrubbing
│   ├── cost-calculator.ts  USD cost from token counts + pricing DB
│   ├── warning-engine.ts   Detects context bloat, errors, retries, duplicates
│   ├── diff-engine.ts      Two-trace comparison
│   ├── compare-last.ts     Semantic step-matching for auto-diff
│   ├── ndjson-tail.ts      Incremental NDJSON reader (for live streaming)
│   └── runtime-detect.ts   Python/Node.js detection
├── interceptors/
│   ├── node/               Node.js HTTP/fetch interceptor
│   └── python/             Python httpx/urllib3 interceptor (sitecustomize.py)
├── providers/
│   ├── registry.ts         URL → provider detection
│   ├── openai.ts           OpenAI request/response parser
│   ├── anthropic.ts        Anthropic request/response parser
│   ├── google.ts           Google Gemini parser
│   ├── cohere.ts           Cohere parser
│   ├── ollama.ts           Ollama parser
│   └── ...                 (groq, mistral, openrouter, generic)
├── renderers/
│   ├── tree.ts             Final static trace (the box)
│   ├── show.ts             Full conversation view
│   ├── live-tree.ts        Live animated dashboard
│   ├── diff.ts             Side-by-side trace comparison
│   ├── stats.ts            Aggregated analytics
│   └── json.ts             JSON output
├── pricing/
│   ├── pricing-db.ts       Pricing database (300+ models)
│   ├── fallback-prices.json  Bundled offline prices
│   └── fetch-prices.ts     LiteLLM price fetcher
├── storage/
│   ├── save.ts             Trace persistence
│   ├── load.ts             Trace loading + listing
│   └── index.ts            Directory management
├── types/
│   ├── trace.ts            Core data types (Trace, Step, LLMStep, StepContent, etc.)
│   └── config.ts           CLI configuration types
└── ui/
    ├── theme.ts            Color palette, glyphs, layout helpers
    ├── matrix-banner.ts    Animated header banner
    ├── live-controller.ts  Orchestrates the live TUI render loop
    └── live-region.ts      Terminal region management (cursor control)
```

---

## Development

```bash
# Install dependencies
npm install

# Build (tsup → dist/)
npm run build

# Watch mode (rebuild on changes)
npm run dev

# Type check (no emit)
npm run lint

# Run tests
npm test

# Run tests in watch mode
npm run test:watch
```

---

## Testing

**131 tests across 13 test files**, covering:

| Area | Tests | Coverage |
|------|-------|----------|
| **Redaction** | 28 | All 8 provider key formats, adversarial nesting, PII, Luhn, edge cases |
| **Content extraction** | 14 | OpenAI, Anthropic, Gemini, multimodal, errors, truncation, redaction-within-content |
| **Warning engine** | 15 | Context growth, duplicates, cost concentration, HTTP errors, retries, severity sorting |
| **Cost calculator** | 11 | Known models, unknown models, null tokens, formatting |
| **Providers** | 24 | URL detection, request/response parsing for OpenAI + Anthropic + registry |
| **NDJSON tail** | 4 | Missing files, partial lines, malformed JSON, offset advancing |
| **Compare/Show** | 9 | Semantic step-matching, backward compatibility, grep, retry markers |
| **Trace builder** | 6 | Content capture, error detection, retry marking, opt-out |
| **Integration** | 4 | End-to-end Node.js + Python interception with real HTTP servers |

```bash
npm test
```

---

## License

MIT — see [LICENSE](LICENSE).

---

<div align="center">

**Built by [Ronak Rahane](https://github.com/ronakrahane)**

*"The best debugging tool is the one with zero setup cost."*

</div>
