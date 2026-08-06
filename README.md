<div align="center">

# costcatch ⚡

### Zero-instrumentation, terminal-native LLM agent tracer

**Like `time`, but for AI agents.**

[![npm version](https://img.shields.io/npm/v/costcatch.svg)](https://www.npmjs.com/package/costcatch)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.17-brightgreen.svg)](https://nodejs.org)
[![CI](https://github.com/costcatch/costcatch/actions/workflows/ci.yml/badge.svg)](https://github.com/costcatch/costcatch/actions/workflows/ci.yml)

**No code changes. No SDK. No account. No API keys given to us. Fully local.**

</div>

---

## What is costcatch?

`costcatch` captures every LLM API call your AI agent makes — models, tokens,
cost, tool calls, conversation content, errors, and retries — and renders it as
a live, in-place trace in your terminal.

You prefix your command with `costcatch`, exactly like you'd prefix it with `time`:

```bash
costcatch python my_agent.py
costcatch node   my_agent.js
```

While your program runs, you see a live dashboard:

```
┌─ ⚡ costcatch ────────────────────────────────────────── ⧗ 18.3s  $0.21 ─┐
│                                                                          │
│ ✓ ① claude-sonnet-4        0.8s   1,203 → 87 tok   $0.004                │
│    └─ ⚡ web_search("Tesla Q4 2024 revenue")                             │
│                                                                          │
│ ✓ ② claude-sonnet-4        1.4s   5,891 → 92 tok   $0.019                │
│    ⚠ context grew 4.9× (1,203 → 5,891 tok)                               │
│                                                                          │
│ ⠹ ·· claude-sonnet-4       2.3s   thinking…                              │
│                                                                          │
│ ── summary                                                               │
│ 3 LLM calls  ·  2 tool calls  ·  18.3s  ·  $0.21                         │
│ 20k → 271 tok  ·  at 100 runs/day = $630/mo                              │
└─ 3 calls · 20k→271 tok · $0.21 ──────────────────────────────────────────┘
```

In-flight calls show a live spinner and ticking timer. Completed calls settle
into the tree with exact tokens and cost. Your program's own stdout scrolls
above the box, untouched. On exit, the live region collapses into one clean,
final trace.

---

## Why costcatch?

Every existing LLM tracer has a tax:

| Tool | Tax |
|------|-----|
| **LangSmith** | Requires LangChain |
| **Helicone** | Requires changing your API base URL (proxy) |
| **Langfuse / Braintrust** | Cloud-first, needs an account + API key |
| **OpenTelemetry** | Takes an afternoon to wire up with custom spans |
| **Datadog LLM Observability** | Enterprise pricing, agent overhead |

`costcatch` has **zero tax**:

- ✅ Works by **prefixing your command** — no code changes, no SDK imports, no decorators
- ✅ Captures at the **HTTP layer** — survives SDK version bumps, works across any library
- ✅ **Fully local** — your data never leaves your machine
- ✅ **Free and open source** — MIT, no account, no cloud, no telemetry

---

## Table of Contents

- [Install](#install)
- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [Commands](#commands)
- [Features](#features)
- [Supported Providers](#supported-providers)
- [Streaming & Token Accuracy](#streaming--token-accuracy)
- [Exit Codes](#exit-codes)
- [Environment Variables](#environment-variables)
- [Honest Limitations](#honest-limitations)
- [Architecture](#architecture)
- [Development](#development)
- [Security](#security)
- [License](#license)

---

## Install

```bash
npm install -g costcatch
```

Then, in your project directory:

```bash
costcatch init
```

This creates `.costcatch/` (and `.gitignore`s it) and fetches the latest model
pricing database from LiteLLM. Use `costcatch init --offline` to skip the
download and stay on the bundled price snapshot.

> **Python support ships inside the npm package** — there is nothing to `pip install`.

### Requirements

- Node.js ≥ 18.17
- Python 3.8+ (only for tracing Python agents — no pip install required)

---

## Quick Start

> **Flags come first.** Like `time` and `env`, costcatch treats everything from
> your program's name onward as *your* command — so `costcatch --save python
> agent.py` saves the trace, while `costcatch python agent.py --save` passes
> `--save` to your agent. costcatch warns you if it spots one of its own flags
> in that position.

```bash
# Trace a Python agent
costcatch python my_agent.py

# Trace a Node.js agent
costcatch node my_agent.js

# Save the trace for later inspection
costcatch --save python my_agent.py

# Read what the model actually saw and said
costcatch show .costcatch/2026-07-25T14-32-17-my_agent.json
costcatch show trace.json --step 3           # zoom into step 3
costcatch show trace.json --grep "search"    # find + highlight a string

# Iterate on a prompt and see what changed
costcatch --save python my_agent.py
#   …edit your prompt…
costcatch --save --compare-last python my_agent.py

# Use as a CI regression gate
costcatch --max-cost 0.10 --max-calls 8 python tests/agent_test.py
```

### Passing flags to *your* program

Because the split happens at the first runtime executable, your program's flags
stay yours automatically:

```bash
costcatch --save python agent.py --verbose --json   # --verbose/--json go to agent.py
```

If your command doesn't start with a recognized runtime, or you want to pass
through something costcatch also defines, use `--`:

```bash
costcatch --save -- python agent.py --save   # the second --save goes to agent.py
costcatch --save -- poetry run python agent.py
```

---

## How It Works

`costcatch` spawns your program with a runtime-specific hook injected, captures
outbound HTTP requests to known LLM endpoints, streams them to a temporary
NDJSON file, and renders the trace in real time.

### Node.js interception

Injects an interceptor via `node --require` that patches `https.request`,
`http.request`, `https.get`, `http.get`, and `globalThis.fetch`.

### Python interception

Prepends a directory to `PYTHONPATH` so a `sitecustomize.py` auto-loads and
patches `httpx.Client`, `httpx.AsyncClient`, and `urllib3.HTTPConnectionPool`
(which covers `requests`, most SDKs, LangChain, LiteLLM, CrewAI, and friends).
If your environment already had its own `sitecustomize`, costcatch chains to it
rather than shadowing it.

### Safety guarantees

The interceptor is **purely observational**, and this is the property the whole
design is built around:

- Every patched path is wrapped so an internal failure degrades to "captured
  nothing", never "broke your agent"
- Response bodies are cloned or spliced back — never consumed out from under you
- Streamed responses are tee'd as *you* consume them, so `stream=True` works
- An error your program didn't handle stays unhandled: installing costcatch will
  not turn a crash into a silent hang
- Buffering is bounded (2 MiB/response, 64 MiB/run) so a tracer can never OOM
  the program it's watching
- Request headers are never read, so your API keys are never in a trace

### Two-phase protocol

Interceptors emit a `phase: "start"` record when a matched request is
dispatched, then a `phase: "end"` record when the response completes. That's
what enables in-flight spinners, correct timing for overlapping calls, and
progressive rendering.

---

## Commands

### `run` (default)

Trace any Python or Node.js command. `run` is optional.

```bash
costcatch python my_agent.py
costcatch run node my_agent.js   # equivalent
```

| Flag | Description |
|------|-------------|
| `--save` | Save the trace to `.costcatch/` |
| `--save-as <name>` | Save with a specific filename (overwrites) |
| `--inspect` | After the run, show the full conversation content of every step |
| `--compare-last` | Auto-diff against the most recent saved trace for this script (implies `--save`) |
| `--max-cost <usd>` | **CI gate**: exit 1 if total cost exceeds N USD |
| `--max-calls <n>` | **CI gate**: exit 1 if LLM call count exceeds N |
| `--budget <usd>` | **Mid-run guard**: terminate the program once spend passes N USD |
| `--threshold <ms>` | Flag LLM calls slower than N ms (default 10000) |
| `--filter <provider>` | Only trace one provider, e.g. `--filter anthropic` |
| `--no-cost` | Hide the cost column |
| `--no-redact` | Keep PII in captured content (secrets are still redacted) |
| `--json` | Emit the trace as JSON, for `jq` / CI. Suppresses all animation |
| `--no-color` | Plain, ANSI-free output (also honors `NO_COLOR`) |
| `--quiet` | Print only the one-line summary |

**`--max-cost` and unknown pricing.** If any call in the trace uses a model
costcatch can't price, the gate **fails** rather than passing. A gate that
silently succeeds when it can't be evaluated isn't a gate.

**Output modes.** The live TUI activates only on an interactive, colored
terminal. In CI, when piped, or with `--json` / `--quiet` / `--no-color`, output
falls back to clean sequential lines — no cursor control, safe for log files.

---

### `show`

Read the actual conversation — system prompt, messages, model output, errors —
for every step in a saved trace.

```bash
costcatch show trace.json               # all steps
costcatch show trace.json --step 3      # zoom into step 3
costcatch show trace.json --grep "loop" # search + highlight matches
```

Agent debugging is almost never "what did it call?" — it's **"what was in the
prompt that made it loop?"**

---

### `estimate`

Estimate token count and cost for a prompt *before* you send it.

```bash
costcatch estimate prompt.txt --model gpt-4o
costcatch estimate --text "You are a helpful assistant..."
cat prompt.md | costcatch estimate --model gpt-4o,claude-sonnet-4
costcatch estimate prompt.txt --breakdown       # per-section distribution
costcatch estimate prompt.txt --max-cost 0.05   # CI gate
```

Estimates are character-ratio based (±10–15% for English prose) — see
[Streaming & Token Accuracy](#streaming--token-accuracy) for why, and note that
*traced* token counts are exact, never estimated.

---

### `replay`

Re-render a saved trace without re-running the script.

```bash
costcatch replay .costcatch/2026-07-25T14-32-17-agent.json
costcatch replay trace.json --json
```

---

### `diff`

Compare two saved traces — steps, tokens, cost, latency, added/removed tool calls.

```bash
costcatch diff before.json after.json
```

---

### `stats`

Aggregated analytics across all saved traces in your project.

```bash
costcatch stats                        # all time
costcatch stats --today
costcatch stats --week
costcatch stats --script my_agent.py
costcatch stats --model gpt-4o
```

---

### `watch`

A traced run that always saves. Same as `run --save`.

```bash
costcatch watch python my_agent.py
```

---

### `init`

```bash
costcatch init             # create .costcatch/, fetch latest pricing
costcatch init --offline   # skip the download, use bundled prices
```

---

## Features

### Live terminal dashboard

Renders in place at ~12 FPS: in-flight calls with spinner and ticking timer,
completed calls with status badge, tokens and cost, tool calls inline under the
step that triggered them, and a running totals footer. Your program's output
scrolls above the box, untouched.

### Warning engine

From the raw traffic alone, costcatch reconstructs behavior and flags problems:

| Warning | Severity | What it detects |
|---------|----------|-----------------|
| **HTTP errors** | 🔴 Critical | 429 rate limits, 500s, 401 auth failures |
| **Silent retries** | 🟡 Warn | Same prompt re-sent after a failure (SDK auto-retry) |
| **Context bloat** | 🟡 / 🔴 | Input tokens growing >3× across calls — the #1 cost driver |
| **Context spike** | 🟡 Warn | Input tokens growing >4× between adjacent steps |
| **Duplicate tool calls** | 🟡 / ℹ️ | Identical or >80%-similar calls to the same tool |
| **Cost concentration** | 🟡 Warn | A single step consuming >50% of total cost |
| **Latency spikes** | ℹ️ Info | Steps exceeding `--threshold` (default 10s) |

### CI assertion gates

```bash
costcatch python tests/agent_test.py --max-cost 0.10 --max-calls 8
costcatch python tests/agent_test.py --json | jq '.summary'
```

A snapshot test for agent *behavior* — it catches the regression where a prompt
change makes the agent loop, use more calls, or pick a pricier model.

### Mid-run budget guard

```bash
costcatch python my_agent.py --budget 1.00
```

Unlike `--max-cost` (which reports after the fact), `--budget` watches spend as
calls land and terminates the program once it passes the limit — SIGTERM first,
SIGKILL after a grace period.

### Automatic redaction

Everything captured is scrubbed before it is stored or printed:

**Terminal escapes** are always stripped. Model output is attacker-influenceable
and gets printed to your terminal; raw ANSI could otherwise clear your screen or
overwrite lines to forge output.

**Secrets** are always redacted: OpenAI (`sk-*`), Anthropic (`sk-ant-*`), Google
(`AIza*`), AWS (`AKIA*`/`ASIA*`), Groq, Replicate, GitHub, Slack, Hugging Face,
OpenRouter, JWTs, `Bearer` tokens, and labeled `api_key: value` pairs.

**PII** is redacted by default and opt-out with `--no-redact`: emails,
separator-formatted phone numbers, and Luhn-valid card numbers.

> Redaction is **best-effort**, not a guarantee. Review a trace before sharing
> it publicly. Request headers — where API keys actually live — are never
> captured in the first place.

### Cost tracking

- Token counts come **straight from the API response** — never estimated
- ~30 models priced offline out of the box; `costcatch init` pulls 1,000+ from LiteLLM
- **A wrong price is worse than no price**: if costcatch can't confidently
  resolve a model, it shows `$?.??` rather than guessing a sibling model's rate

---

## Supported Providers

| Provider | Detection | Notes |
|----------|-----------|-------|
| **OpenAI** | `api.openai.com` | Streaming, tools, vision |
| **Azure OpenAI** | `*.openai.azure.com` | Same parser as OpenAI |
| **Anthropic** | `api.anthropic.com` | System prompts, content blocks, `tool_use`, cache metrics |
| **Google Gemini** | `generativelanguage.googleapis.com`, `aiplatform.googleapis.com` | Model read from the URL path |
| **OpenRouter** | `openrouter.ai` | OpenAI-compatible |
| **Groq** | `api.groq.com` | OpenAI-compatible |
| **Mistral** | `api.mistral.ai` | OpenAI-compatible |
| **Ollama** | `:11434` | Local models |
| **Cohere** | `api.cohere.com`, `api.cohere.ai` | Native chat/generate parser |
| **Generic** | Any URL with `/chat/completions` | Catches vLLM, Together, Fireworks, LiteLLM proxies, … |

Missing one? [Open a provider request](https://github.com/costcatch/costcatch/issues/new?template=provider_request.yml).

---

## Streaming & Token Accuracy

| Provider | Streaming | Token accuracy |
|----------|-----------|----------------|
| **Anthropic** | ✅ Streams always include usage | Exact |
| **OpenAI** | ⚠️ Requires `stream_options: { include_usage: true }` | Exact when enabled |
| **Others** | ✅ Best-effort SSE reassembly | Exact when usage is present |

If OpenAI streaming usage is missing, the call is still captured (model, timing,
tool calls) and costcatch prints a tip explaining how to enable it. **Traced
token counts are never estimated or fabricated** — a call with no usage data
shows `tokens ?`, not a guess.

(The separate `estimate` command *is* an estimate, and labels itself as one.)

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success — and the traced program exited 0 |
| `1` | A `--max-cost` / `--max-calls` / `--budget` gate failed |
| `2` | Bad invocation: unknown runtime, missing arguments, unreadable input |
| `70` | costcatch itself failed (missing interceptor, unwritable temp dir) |
| `127` | The traced program could not be started |
| *other* | The traced program's own exit code, passed through (128+N for signals) |

---

## Environment Variables

| Variable | Effect |
|----------|--------|
| `NO_COLOR` | Disable all color (standard) |
| `COSTCATCH_DEBUG=1` | Print stack traces for internal errors |
| `COSTCATCH_VERSION` | Override the reported version |
| `COSTCATCH_MAX_BODY_BYTES` | Per-response capture ceiling (default 2 MiB) |
| `COSTCATCH_MAX_TRACE_BYTES` | Per-run capture ceiling (default 64 MiB) |

---

## Honest Limitations

### What costcatch can NOT see

Because tracing happens at the HTTP layer, not inside your code:

- **Local tool execution** (a Python function your agent calls) makes no HTTP
  request, so it isn't its own step. You see it as the `tool_use` block the model
  requested and as context growth on the next call.
- **Concurrent calls** are captured and grouped, but HTTP alone can't attribute
  them to named graph nodes.
- **gRPC transports** (some Google Cloud paths) bypass HTTP interception.
- **`bun` and `deno`** are not supported: neither honours `--require`, so
  costcatch reports "could not detect runtime" rather than producing an empty
  trace that looks like a working one.
- **aiohttp** is not yet patched on the Python side; `httpx` and `urllib3`
  (which covers `requests`) are.

### Other things worth knowing

- **Cached-token pricing is not modelled.** Cached input tokens are captured and
  displayed, but priced at the normal input rate, so a run using prompt caching
  is reported as *more* expensive than it actually was.
- **Content storage is bounded, not deduplicated.** Chat APIs resend the whole
  history each turn, so a very long run hits an 8 M-character content budget;
  past that, steps keep every metric but stop storing conversation text and are
  marked `truncated`.
- **`estimate` is a heuristic.** Character-ratio based, ±10–15% for English
  prose, wider for code and CJK. It reports its own confidence and margin.

### What costcatch IS

A **developer tool**, not a production monitoring system. **Single-machine** —
it sees the process tree it spawns. **Best-effort** — if interception fails,
your program still runs correctly; the trace just has gaps.

---

## Architecture

```
src/
├── index.ts               CLI entry: argv splitting, commander wiring, exit codes
├── cli/                   One file per command; each returns an exit code
├── core/
│   ├── constants.ts        Cross-process contract with the interceptors
│   ├── tracer.ts           Spawns the child with the interceptor injected
│   ├── trace-builder.ts    Raw HTTP calls → structured Trace
│   ├── content-extractor.ts  Conversation extraction from request/response
│   ├── redact.ts           Control-char scrubbing + secret/PII redaction
│   ├── cost-calculator.ts  USD from tokens + pricing DB
│   ├── warning-engine.ts   Context bloat, errors, retries, duplicates
│   ├── diff-engine.ts      Two-trace comparison
│   ├── ndjson-tail.ts      Incremental reader for the live view
│   ├── runtime-detect.ts   Runtime classification + argv splitting
│   └── version.ts          Single-sourced version
├── interceptors/
│   ├── node/preload.cjs           Injected via --require
│   └── python/sitecustomize.py    Injected via PYTHONPATH
├── providers/             URL → parser (openai, anthropic, google, … , generic)
├── pricing/               Model → price resolution + bundled snapshot
├── renderers/             Pure state → string. No I/O.
├── storage/               Atomic saves, validated loads
├── types/                 Trace and config types
└── ui/                    Theme, live region, live controller
```

Dependencies point inward: `cli → core/renderers/storage → types`.

---

## Development

```bash
npm ci
python -m pip install httpx requests   # for the Python integration tests

npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run build       # tsup → dist/
npm run verify      # all three, as CI runs them
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the rules that matter when touching
the interceptors or the pricing resolver.

### Testing

293 tests across 25 files. Unit tests cover redaction (including ReDoS
resistance), content extraction, the warning engine, pricing resolution, argv
splitting, storage, and every provider parser. Integration tests spawn real
`node` and `python` processes against a local mock server and assert both that
calls are captured *and* that the traced program's own behavior is unchanged.

---

## Security

See [SECURITY.md](SECURITY.md) for the threat model, what data is captured and
where it lives, and how to report a vulnerability privately.

---

## License

MIT — see [LICENSE](LICENSE).

---

<div align="center">

**Built by [Ronak Rahane](https://github.com/ronakrahane)**

*"The best debugging tool is the one with zero setup cost."*

</div>
