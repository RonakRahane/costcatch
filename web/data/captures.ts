// Terminal captures for the docs page, copied from real runs of the demo agents.
// Keep every space as printed, since the boxes only line up if nothing is retyped or reflowed.

export interface Capture {
  /** The invocation, without its leading `$`. */
  command: string;
  /** stdout + stderr exactly as printed. */
  output: string;
  /** The process exit status. */
  exitCode: number;
}

export const CAPTURES = {
  help: {
    command: `costcatch --help`,
    output: `Usage: costcatch [options] [command]

Zero-instrumentation LLM agent tracer & cost tracker. Like \`time\` but for AI agents.

Options:
  -v, --version                   Print the costcatch version
  -h, --help                      display help for command

Commands:
  run [options] [command...]      Trace a script (default command; \`run\` is optional)
  show [options] [file]           Inspect the full conversation content of a saved trace
                                  (defaults to latest)
  estimate [options] [file]       Estimate token count and cost for a prompt file
  replay [options] [file]         Re-display a saved trace (defaults to latest)
  diff [options] [file1] [file2]  Compare two saved traces side by side (defaults to last 2
                                  runs)
  stats [options]                 Show aggregated analytics across saved traces
  watch [options] [command...]    Traced run that always saves, with the live view on
  clean [options]                 Delete old saved traces from .costcatch/
  init [options]                  Set up .costcatch/ and fetch the latest pricing database
  help [command]                  display help for command`,
    exitCode: 0,
  },
  init: {
    command: `costcatch init`,
    output: `

 ██████╗ ██████╗ ███████╗████████╗ ██████╗ █████╗ ████████╗ ██████╗██╗  ██╗
██╔════╝██╔═══██╗██╔════╝╚══██╔══╝██╔════╝██╔══██╗╚══██╔══╝██╔════╝██║  ██║
██║     ██║   ██║███████╗   ██║   ██║     ███████║   ██║   ██║     ███████║
██║     ██║   ██║╚════██║   ██║   ██║     ██╔══██║   ██║   ██║     ██╔══██║
╚██████╗╚██████╔╝███████║   ██║   ╚██████╗██║  ██║   ██║   ╚██████╗██║  ██║
 ╚═════╝ ╚═════╝ ╚══════╝   ╚═╝    ╚═════╝╚═╝  ╚═╝   ╚═╝    ╚═════╝╚═╝  ╚═╝



┌────────────────────────────────┬────── v0.1.0 ───────────────────────────────────────┐
│                                │                                                     │
│ About                          │ Commands                                            │
│ Zero-instrumentation LLM       │   run          trace a script (default)             │
│ agent tracer & cost tracker.   │   estimate     estimate prompt token cost           │
│ Like \`time\`, for AI agents.    │   show         inspect conversation content         │
│                                │   diff         compare two saved traces             │
│ Features                       │   stats        aggregated analytics                 │
│ · live trace in the terminal   │   replay       re-display a saved trace             │
│ · per-call cost tracking       │   watch        run, always saved                    │
│ · prompt cost estimation       │   clean        prune old saved traces               │
│ · auto-diff between runs       │   init         setup & fetch pricing                │
│ · CI assertion gates           │                                                     │
│ · secret & PII redaction       │ Quick Start                                         │
│                                │ $ costcatch python3 agent.py                        │
│                                │ $ costcatch node agent.mjs                          │
│                                │                                                     │
└────────────────────────────────┴─────────────────────────────────────────────────────┘

- fetching latest model pricing…

┌──────────────────────────────────────────────────────────────────────────────┐
│ costcatch                                                               init │
│                                                                              │
│ ✓ created .costcatch/ (.costcatch)                                           │
│ ✓ added .costcatch/ to .gitignore                                            │
│ ✓ fetched latest pricing (5,831 models)                                      │
│                                                                              │
│ ready · run \`costcatch --help\` to see all commands                           │
└──────────────────────────────────────────────────────────────────────────────┘
`,
    exitCode: 0,
  },
  initOffline: {
    command: `costcatch init --offline`,
    output: `

 ██████╗ ██████╗ ███████╗████████╗ ██████╗ █████╗ ████████╗ ██████╗██╗  ██╗
██╔════╝██╔═══██╗██╔════╝╚══██╔══╝██╔════╝██╔══██╗╚══██╔══╝██╔════╝██║  ██║
██║     ██║   ██║███████╗   ██║   ██║     ███████║   ██║   ██║     ███████║
██║     ██║   ██║╚════██║   ██║   ██║     ██╔══██║   ██║   ██║     ██╔══██║
╚██████╗╚██████╔╝███████║   ██║   ╚██████╗██║  ██║   ██║   ╚██████╗██║  ██║
 ╚═════╝ ╚═════╝ ╚══════╝   ╚═╝    ╚═════╝╚═╝  ╚═╝   ╚═╝    ╚═════╝╚═╝  ╚═╝



┌────────────────────────────────┬────── v0.1.0 ───────────────────────────────────────┐
│                                │                                                     │
│ About                          │ Commands                                            │
│ Zero-instrumentation LLM       │   run          trace a script (default)             │
│ agent tracer & cost tracker.   │   estimate     estimate prompt token cost           │
│ Like \`time\`, for AI agents.    │   show         inspect conversation content         │
│                                │   diff         compare two saved traces             │
│ Features                       │   stats        aggregated analytics                 │
│ · live trace in the terminal   │   replay       re-display a saved trace             │
│ · per-call cost tracking       │   watch        run, always saved                    │
│ · prompt cost estimation       │   clean        prune old saved traces               │
│ · auto-diff between runs       │   init         setup & fetch pricing                │
│ · CI assertion gates           │                                                     │
│ · secret & PII redaction       │ Quick Start                                         │
│                                │ $ costcatch python3 agent.py                        │
│                                │ $ costcatch node agent.mjs                          │
│                                │                                                     │
└────────────────────────────────┴─────────────────────────────────────────────────────┘


┌──────────────────────────────────────────────────────────────────────────────┐
│ costcatch                                                               init │
│                                                                              │
│ ✓ created .costcatch/ (.costcatch)                                           │
│ ✓ added .costcatch/ to .gitignore                                            │
│ · --offline: skipped pricing download, using bundled prices                  │
│                                                                              │
│ ready · run \`costcatch --help\` to see all commands                           │
└──────────────────────────────────────────────────────────────────────────────┘
`,
    exitCode: 0,
  },
  run: {
    command: `costcatch run --save node --env-file=.env test_agent.mjs`,
    output: `┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ costcatch                              deepseek/deepseek-v4-flash-0731  ·  ⧗ 35.6s  $0.00019 │
│                                                                                              │
│ ✓ Step 1  13.0s  526 tok in → 271 tok out  $0.000065  █████  ⟳ 128 cached                    │
│    ├─ ▸ get_weather(city="Tokyo")                                                            │
│    ├─ ▸ get_weather(city="London")                                                           │
│    └─ ▸ calculate(expression="240*4")                                                        │
│                                                                                              │
│ ✓ Step 2   9.9s  691 tok in → 204 tok out  $0.000048  ███▓░  ⟳ 512 cached                    │
│    ├─ ▸ calculate(expression="(31-18)*9/5")                                                  │
│    └─ ▸ convert_currency(amount=960, from="GBP", to="INR")                                   │
│                                                                                              │
│ ✓ Step 3   5.0s  847 tok in →  49 tok out  $0.000027  ██░░░  ⟳ 640 cached                    │
│    └─ ▸ calculate(expression="101103.8/3")                                                   │
│                                                                                              │
│ ✓ Step 4   7.7s  917 tok in → 182 tok out  $0.000047  ███▒░  ⟳ 768 cached                    │
│    └─ ✓ stop, final answer                                                                   │
│                                                                                              │
│ ── summary                                                                                   │
│ 4 LLM calls  ·  6 tool calls  ·  35.6s  ·  $0.00019                                          │
│ 3.0k tok in → 706 tok out                                                                    │
│ at 1 run/day = $0.01/mo  ·  at 100 runs/day = $0.56/mo  ·  at 1000 runs/day = $5.59/mo       │
│ run 2026-09-02T06-54-46                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────────────┘

  ✓ Trace saved: .costcatch/2026-09-02T06-54-46-test_agent.json`,
    exitCode: 0,
  },
  runQuiet: {
    command: `costcatch run --quiet node --env-file=.env test_simple.mjs`,
    output: `[simple] reply:  Hi John!
1 steps · 1 LLM calls · $0.000017 · 7.1s`,
    exitCode: 0,
  },
  runJson: {
    command: `costcatch run --json node --env-file=.env test_simple.mjs`,
    output: `[simple] reply:  Hello John, thanks for sharing your contact details!
{
  "runId": "2026-09-02T06-55-29",
  "script": "test_simple.mjs",
  "runtime": "node",
  "durationMs": 7266,
  "totalCostUsd": 0.00002036,
  "steps": [
    {
      "type": "llm",
      "id": 1,
      "durationMs": 7266,
      "provider": "openrouter",
      "model": "deepseek/deepseek-v4-flash-0731",
      "inputTokens": 36,
      "outputTokens": 116,
      "cachedTokens": 0,
      "costUsd": 0.00002036,
      "toolCalls": [],
      "isStreaming": false,
      "finishReason": "stop",
      "statusCode": 200,
      "error": null,
      "content": {
        "system": null,
        "messages": [
          {
            "role": "user",
            "content": "My email is «email» and my phone is «phone». Reply with exactly one short sentence greeting me."
          }
        ],
        "output": " Hello John, thanks for sharing your contact details!",
        "truncated": false
      },
      "retryOf": null
    }
  ],
  "warnings": [],
  "summary": {
    "llmCalls": 1,
    "toolCalls": 0,
    "totalInputTokens": 36,
    "totalOutputTokens": 116,
    "totalSteps": 1,
    "retries": 0,
    "wastedCostUsd": 0
  },
  "startedAt": "2026-09-02T06:55:29.723Z",
  "command": "node --env-file=.env test_simple.mjs"
}`,
    exitCode: 0,
  },
  runNoColor: {
    command: `costcatch run --no-color node --env-file=.env test_simple.mjs`,
    output: `[simple] reply:  Hello, John!

costcatch  14.0s · $0.000052

  1. LLM  deepseek/deepseek-v4-flash-0731 14.0s  36 tok in -> 314 tok out  $0.000052

  1 LLM call · 0 tool calls · 14.0s · $0.000052`,
    exitCode: 0,
  },
  runInspect: {
    command: `costcatch run --inspect node --env-file=.env test_simple.mjs`,
    output: `┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ costcatch                                                                  ⧗ 8.1s  $0.000028 │
│ show: test_simple.mjs (1 LLM call)                                                           │
│                                                                                              │
│ ── ✓ Step 1 deepseek/deepseek-v4-…  8.1s  36 tok in → 166 tok out  $0.000028                 │
│                                                                                              │
│ USER                                                                                         │
│   My email is «email» and my phone is «phone». Reply with exactly one short sentence greetin │
│   g me.                                                                                      │
│                                                                                              │
│ OUTPUT                                                                                       │
│    Hello!                                                                                    │
│                                                                                              │
│ 2026-09-02T06-55-37                                                                          │
└──────────────────────────────────────────────────────────────────────────────────────────────┘`,
    exitCode: 0,
  },
  runThreshold: {
    command: `costcatch run --threshold 3000 node --env-file=.env test_simple.mjs`,
    output: `┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ costcatch                             deepseek/deepseek-v4-flash-0731  ·  ⧗ 11.4s  $0.000037 │
│                                                                                              │
│ ✓ Step 1  11.4s  36 tok in → 221 tok out  $0.000037                                          │
│    └─ ✓ stop, final answer                                                                   │
│                                                                                              │
│ ── summary                                                                                   │
│ 1 LLM call  ·  0 tool calls  ·  11.4s  ·  $0.000037                                          │
│ 36 tok in → 221 tok out                                                                      │
│ at 1 run/day = $0.00/mo  ·  at 100 runs/day = $0.11/mo  ·  at 1000 runs/day = $1.11/mo       │
│                                                                                              │
│ ── warnings                                                                                  │
│ ● Step 1 took 11.4s (threshold: 3.0s)                                                        │
│ run 2026-09-02T06-57-57                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────────────┘`,
    exitCode: 0,
  },
  runSaveAs: {
    command: `costcatch run --save-as baseline --no-cost node --env-file=.env test_simple.mjs`,
    output: `┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ costcatch                                         deepseek/deepseek-v4-flash-0731  ·  ⧗ 8.3s │
│                                                                                              │
│ ✓ Step 1   8.3s  36 tok in → 186 tok out                                                     │
│    └─ ✓ stop, final answer                                                                   │
│                                                                                              │
│ ── summary                                                                                   │
│ 1 LLM call  ·  0 tool calls  ·  8.3s                                                         │
│ 36 tok in → 186 tok out                                                                      │
│ run 2026-09-02T06-59-08                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────────────┘

  ✓ Trace saved: .costcatch/baseline.json`,
    exitCode: 0,
  },
  runNoRedact: {
    command: `costcatch run --no-redact --save-as noredact-demo node --env-file=.env test_simple.mjs`,
    output: `┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ △ PII redaction is OFF (--no-redact).                                                        │
│   Emails, phone numbers and card numbers were captured as written.                           │
│   The saved trace contains them in plain text.                                               │
└──────────────────────────────────────────────────────────────────────────────────────────────┘

  ✓ Trace saved: .costcatch/noredact-demo.json`,
    exitCode: 0,
  },
  runCompareLast: {
    command: `costcatch run --compare-last node --env-file=.env test_agent.mjs`,
    output: `┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ costcatch                                                              diff · before → after │
│                                                                                              │
│ Steps                   4 → 6                +2                                              │
│ LLM calls               4 → 6                +2                                              │
│ Tool calls              6 → 8                +2                                              │
│ Duration            35.6s → 50.0s          +40%                                              │
│ Cost             $0.00019 → $0.00043      +132%                                              │
│ Max context tok       917 → 1,641          +724                                              │
│                                                                                              │
│ ── removed calls                                                                             │
│   · calculate({"expression":"240*4"})                                                        │
│   · calculate({"expression":"(31-18)*9/5"})                                                  │
│   · calculate({"expression":"101103.8/3"})                                                   │
│                                                                                              │
│ ── added calls                                                                               │
│   + calculate({"expression":"(31*9/5)+32"})                                                  │
│   + calculate({"expression":"(18*9/5)+32"})                                                  │
│   + calculate({"expression":"87.8 - 64.4"})                                                  │
│   + calculate({"expression":"240 * 4"})                                                      │
│   + calculate({"expression":"101103.8 / 3"})                                                 │
│                                                                                              │
│ ── input-token delta by step (before → after)                                                │
│   Step 5: 847 → 1,504 (+78%)                                                                 │
│   Step 6: 917 → 1,641 (+79%)                                                                 │
│                                                                                              │
│ $0.00025 more expensive                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────────────┘`,
    exitCode: 0,
  },
  maxCostPass: {
    command: `costcatch run --max-cost 0.50 node --env-file=.env test_simple.mjs`,
    output: `┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ costcatch                              deepseek/deepseek-v4-flash-0731  ·  ⧗ 6.7s  $0.000024 │
│                                                                                              │
│ ✓ Step 1   6.7s  36 tok in → 136 tok out  $0.000024                                          │
│    └─ ✓ stop, final answer                                                                   │
│                                                                                              │
│ ── summary                                                                                   │
│ 1 LLM call  ·  0 tool calls  ·  6.7s  ·  $0.000024                                           │
│ 36 tok in → 136 tok out                                                                      │
│ at 1 run/day = $0.00/mo  ·  at 100 runs/day = $0.07/mo  ·  at 1000 runs/day = $0.71/mo       │
│ run 2026-09-02T06-55-46                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────────────┘`,
    exitCode: 0,
  },
  maxCostFail: {
    command: `costcatch run --max-cost 0.000001 node --env-file=.env test_simple.mjs`,
    output: `┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ costcatch                              deepseek/deepseek-v4-flash-0731  ·  ⧗ 9.6s  $0.000032 │
│                                                                                              │
│ ✓ Step 1   9.6s  36 tok in → 188 tok out  $0.000032                                          │
│    └─ ✓ stop, final answer                                                                   │
│                                                                                              │
│ ── summary                                                                                   │
│ 1 LLM call  ·  0 tool calls  ·  9.6s  ·  $0.000032                                           │
│ 36 tok in → 188 tok out                                                                      │
│ at 1 run/day = $0.00/mo  ·  at 100 runs/day = $0.10/mo  ·  at 1000 runs/day = $0.96/mo       │
│ run 2026-09-02T06-55-53                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────────────┘


┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ✗ CI GATE: cost $0.000032 exceeds --max-cost $0.0000010                                      │
└──────────────────────────────────────────────────────────────────────────────────────────────┘`,
    exitCode: 1,
  },
  maxCalls: {
    command: `costcatch run --max-calls 2 node --env-file=.env test_agent.mjs`,
    output: `┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ costcatch                             deepseek/deepseek-v4-flash-0731  ·  ⧗ 100.3s  $0.00022 │
│                                                                                              │
│ ✓ Step 1  25.4s  526 tok in → 167 tok out  $0.000039  ███▓░  ⟳ 384 cached                    │
│    ├─ ▸ get_weather(city="Tokyo")                                                            │
│    └─ ▸ get_weather(city="London")                                                           │
│                                                                                              │
│ ✓ Step 2  18.4s  670 tok in → 202 tok out  $0.000047  ████▒  ⟳ 512 cached                    │
│    ├─ ▸ calculate(expression="(31 - 18) * 9 / 5")                                            │
│    └─ ▸ calculate(expression="240 * 4")                                                      │
│                                                                                              │
│ ✓ Step 3  13.1s  800 tok in → 215 tok out  $0.000051  █████  ⟳ 640 cached                    │
│    └─ ▸ convert_currency(amount=960, from="GBP", to="INR")                                   │
│                                                                                              │
│ ✓ Step 4  10.1s  917 tok in →  97 tok out  $0.000033  ███░░  ⟳ 768 cached                    │
│    └─ ▸ calculate(expression="101103.8 / 3")                                                 │
│                                                                                              │
│ ✓ Step 5  33.3s  999 tok in → 189 tok out  $0.000052  █████  ⟳ 768 cached                    │
│    └─ ✓ stop, final answer                                                                   │
│                                                                                              │
│ ── summary                                                                                   │
│ 5 LLM calls  ·  6 tool calls  ·  100.3s  ·  $0.00022                                         │
│ 3.9k tok in → 870 tok out                                                                    │
│ at 1 run/day = $0.01/mo  ·  at 100 runs/day = $0.66/mo  ·  at 1000 runs/day = $6.63/mo       │
│ run 2026-09-02T06-56-03                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────────────┘


┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ✗ CI GATE: 5 LLM calls exceeds --max-calls 2                                                 │
└──────────────────────────────────────────────────────────────────────────────────────────────┘`,
    exitCode: 1,
  },
  budget: {
    command: `costcatch run --budget 0.00005 node --env-file=.env test_agent.mjs`,
    output: `┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ✗ BUDGET: run stopped, spend passed --budget $0.000050                                       │
└──────────────────────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ costcatch                              deepseek/deepseek-v4-flash-0731  ·  ⧗ 13.4s  $0.00013 │
│                                                                                              │
│ ✓ Step 1   8.4s  526 tok in → 163 tok out  $0.000038  ██░░░  ⟳ 384 cached                    │
│    ├─ ▸ get_weather(city="Tokyo")                                                            │
│    └─ ▸ get_weather(city="London")                                                           │
│                                                                                              │
│ ✓ Step 2   5.0s  812 tok in → 238 tok out  $0.000096  █████                                  │
│    ├─ ▸ calculate(expression="(31*9/5)+32")                                                  │
│    └─ ▸ calculate(expression="(18*9/5)+32")                                                  │
│                                                                                              │
│ ── summary                                                                                   │
│ 2 LLM calls  ·  4 tool calls  ·  13.4s  ·  $0.00013                                          │
│ 1.3k tok in → 401 tok out                                                                    │
│ at 1 run/day = $0.00/mo  ·  at 100 runs/day = $0.40/mo  ·  at 1000 runs/day = $4.01/mo       │
│                                                                                              │
│ ── warnings                                                                                  │
│ ● Step 2 = 71% of total cost (context bloat likely)                                          │
│ run 2026-09-02T06-57-43                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────────────┘`,
    exitCode: 1,
  },
  watch: {
    command: `costcatch watch node --env-file=.env test_simple.mjs`,
    output: `┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ costcatch                              deepseek/deepseek-v4-flash-0731  ·  ⧗ 8.5s  $0.000019 │
│                                                                                              │
│ ✓ Step 1   8.5s  36 tok in → 109 tok out  $0.000019                                          │
│    └─ ✓ stop, final answer                                                                   │
│                                                                                              │
│ ── summary                                                                                   │
│ 1 LLM call  ·  0 tool calls  ·  8.5s  ·  $0.000019                                           │
│ 36 tok in → 109 tok out                                                                      │
│ at 1 run/day = $0.00/mo  ·  at 100 runs/day = $0.06/mo  ·  at 1000 runs/day = $0.58/mo       │
│ run 2026-09-02T06-59-31                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────────────┘

  ✓ Trace saved: .costcatch/2026-09-02T06-59-31-test_simple.json`,
    exitCode: 0,
  },
  showStep: {
    command: `costcatch show .costcatch/2026-09-02T06-58-18-test_agent.json --step 2`,
    output: `┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ costcatch                                                                  ⧗ 50.0s  $0.00043 │
│ show: test_agent.mjs (6 LLM calls)                                                           │
│                                                                                              │
│ ── ✓ Step 2 deepseek/deepseek-v4-…  13.8s  668 tok in → 337 tok out  $0.000068               │
│                                                                                              │
│ SYSTEM                                                                                       │
│   You are a travel planning assistant. Always use the provided tools for weather lookups, ar │
│   ithmetic, and currency conversion. Never do math in your head.                             │
│                                                                                              │
│ USER                                                                                         │
│   I'm planning a trip. 1) What's the temperature difference in Fahrenheit between Tokyo and  │
│   London right now? 2) My hotel in London costs 240 GBP per night for 4 nights - what's the  │
│   total in INR? 3) If I split that INR total evenly across 3 people, how much does each pers │
│   on pay? Use your tools for every lookup and calculation, then give me a final summary.     │
│ ASSISTANT                                                                                    │
│    I'll help you with all three parts. Let me start by getting the current weather for both  │
│   cities.                                                                                    │
│                                                                                              │
│                                                                                              │
│ TOOL                                                                                         │
│   {"temp_c":31,"condition":"humid, sunny"}                                                   │
│ TOOL                                                                                         │
│   {"temp_c":18,"condition":"overcast, light rain"}                                           │
│                                                                                              │
│ OUTPUT                                                                                       │
│    I'll calculate the temperatures in Fahrenheit and then find the difference.               │
│                                                                                              │
│                                                                                              │
│                                                                                              │
│ TOOL CALLS                                                                                   │
│   ▸ calculate({"expression":"(31*9/5)+32"})                                                  │
│   ▸ calculate({"expression":"(18*9/5)+32"})                                                  │
│ 2026-09-02T06-58-18                                                                          │
└──────────────────────────────────────────────────────────────────────────────────────────────┘`,
    exitCode: 0,
  },
  showGrep: {
    command: `costcatch show .costcatch/2026-09-02T06-58-18-test_agent.json --grep convert_currency`,
    output: `┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ costcatch                                                                  ⧗ 50.0s  $0.00043 │
│ show: test_agent.mjs (6 LLM calls)                                                           │
│                                                                                              │
│ ── ✓ Step 4 deepseek/deepseek-v4-…  4.2s  1,345 tok in → 133 tok out  $0.000088              │
│                                                                                              │
│ SYSTEM                                                                                       │
│   You are a travel planning assistant. Always use the provided tools for weather lookups, ar │
│   ithmetic, and currency conversion. Never do math in your head.                             │
│                                                                                              │
│ USER                                                                                         │
│   I'm planning a trip. 1) What's the temperature difference in Fahrenheit between Tokyo and  │
│   London right now? 2) My hotel in London costs 240 GBP per night for 4 nights - what's the  │
│   total in INR? 3) If I split that INR total evenly across 3 people, how much does each pers │
│   on pay? Use your tools for every lookup and calculation, then give me a final summary.     │
│ ASSISTANT                                                                                    │
│    I'll help you with all three parts. Let me start by getting the current weather for both  │
│   cities.                                                                                    │
│                                                                                              │
│                                                                                              │
│ TOOL                                                                                         │
│   {"temp_c":31,"condition":"humid, sunny"}                                                   │
│ TOOL                                                                                         │
│   {"temp_c":18,"condition":"overcast, light rain"}                                           │
│ ASSISTANT                                                                                    │
│    I'll calculate the temperatures in Fahrenheit and then find the difference.               │
│                                                                                              │
│                                                                                              │
│ TOOL                                                                                         │
│   {"result":87.8}                                                                            │
│ TOOL                                                                                         │
│   {"result":64.4}                                                                            │
│ ASSISTANT                                                                                    │
│    Now let me calculate the temperature difference and convert the hotel cost.               │
│                                                                                              │
│                                                                                              │
│ TOOL                                                                                         │
│   {"result":23.39999999999999}                                                               │
│ TOOL                                                                                         │
│   {"result":960}                                                                             │
│                                                                                              │
│ OUTPUT                                                                                       │
│   The temperature difference is approximately 23.4°F and the total hotel cost is 960 GBP. No │
│   w let me convert that to INR.                                                              │
│                                                                                              │
│ TOOL CALLS                                                                                   │
│   ▸ convert_currency({"amount":960,"from":"GBP","to":"INR"})                                 │
│                                                                                              │
│ 1 step match "convert_currency"                                                              │
│ 2026-09-02T06-58-18                                                                          │
└──────────────────────────────────────────────────────────────────────────────────────────────┘`,
    exitCode: 0,
  },
  replay: {
    command: `costcatch replay .costcatch/2026-09-02T06-58-18-test_agent.json`,
    output: `┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ costcatch                              deepseek/deepseek-v4-flash-0731  ·  ⧗ 50.0s  $0.00043 │
│                                                                                              │
│ ✓ Step 1   9.5s    526 tok in → 171 tok out  $0.000039  █▓░░░  ⟳ 384 cached                  │
│    ├─ ▸ get_weather(city="Tokyo")                                                            │
│    └─ ▸ get_weather(city="London")                                                           │
│                                                                                              │
│ ✓ Step 2  13.8s    668 tok in → 337 tok out  $0.000068  ██▓░░  ⟳ 512 cached                  │
│    ├─ ▸ calculate(expression="(31*9/5)+32")                                                  │
│    └─ ▸ calculate(expression="(18*9/5)+32")                                                  │
│                                                                                              │
│ ✓ Step 3   9.7s    798 tok in → 124 tok out  $0.000055  ██░░░  ⟳ 128 cached                  │
│    ├─ ▸ calculate(expression="87.8 - 64.4")                                                  │
│    └─ ▸ calculate(expression="240 * 4")                                                      │
│                                                                                              │
│ ✓ Step 4   4.2s  1,345 tok in → 133 tok out  $0.000088  ███▓░  ⟳ 512 cached                  │
│    └─ ▸ convert_currency(amount=960, from="GBP", to="INR")                                   │
│                                                                                              │
│ ✓ Step 5   3.8s  1,504 tok in → 116 tok out  $0.000061  ██▒░░  ⟳ 1,280 cached                │
│    └─ ▸ calculate(expression="101103.8 / 3")                                                 │
│                                                                                              │
│ ✓ Step 6   9.0s  1,641 tok in → 389 tok out   $0.00012  █████  ⟳ 1,280 cached                │
│    └─ ✓ stop, final answer                                                                   │
│                                                                                              │
│ ── summary                                                                                   │
│ 6 LLM calls  ·  8 tool calls  ·  50.0s  ·  $0.00043                                          │
│ 6.5k tok in → 1.3k tok out                                                                   │
│ at 1 run/day = $0.01/mo  ·  at 100 runs/day = $1.29/mo  ·  at 1000 runs/day = $12.94/mo      │
│                                                                                              │
│ ── warnings                                                                                  │
│ ● Context grew 3.1× across calls (526 → 1,641 tokens)                                        │
│ run 2026-09-02T06-58-18                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────────────┘`,
    exitCode: 0,
  },
  replayNoCost: {
    command: `costcatch replay --no-cost .costcatch/2026-09-02T06-58-18-test_agent.json`,
    output: `┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ costcatch                                        deepseek/deepseek-v4-flash-0731  ·  ⧗ 50.0s │
│                                                                                              │
│ ✓ Step 1   9.5s    526 tok in → 171 tok out  ⟳ 384 cached                                    │
│    ├─ ▸ get_weather(city="Tokyo")                                                            │
│    └─ ▸ get_weather(city="London")                                                           │
│                                                                                              │
│ ✓ Step 2  13.8s    668 tok in → 337 tok out  ⟳ 512 cached                                    │
│    ├─ ▸ calculate(expression="(31*9/5)+32")                                                  │
│    └─ ▸ calculate(expression="(18*9/5)+32")                                                  │
│                                                                                              │
│ ✓ Step 3   9.7s    798 tok in → 124 tok out  ⟳ 128 cached                                    │
│    ├─ ▸ calculate(expression="87.8 - 64.4")                                                  │
│    └─ ▸ calculate(expression="240 * 4")                                                      │
│                                                                                              │
│ ✓ Step 4   4.2s  1,345 tok in → 133 tok out  ⟳ 512 cached                                    │
│    └─ ▸ convert_currency(amount=960, from="GBP", to="INR")                                   │
│                                                                                              │
│ ✓ Step 5   3.8s  1,504 tok in → 116 tok out  ⟳ 1,280 cached                                  │
│    └─ ▸ calculate(expression="101103.8 / 3")                                                 │
│                                                                                              │
│ ✓ Step 6   9.0s  1,641 tok in → 389 tok out  ⟳ 1,280 cached                                  │
│    └─ ✓ stop, final answer                                                                   │
│                                                                                              │
│ ── summary                                                                                   │
│ 6 LLM calls  ·  8 tool calls  ·  50.0s                                                       │
│ 6.5k tok in → 1.3k tok out                                                                   │
│                                                                                              │
│ ── warnings                                                                                  │
│ ● Context grew 3.1× across calls (526 → 1,641 tokens)                                        │
│ run 2026-09-02T06-58-18                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────────────┘`,
    exitCode: 0,
  },
  diff: {
    command: `costcatch diff .costcatch/2026-09-02T06-54-46-test_agent.json .costcatch/2026-09-02T06-58-18-test_agent.json`,
    output: `┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ costcatch                                                              diff · before → after │
│                                                                                              │
│ Steps                   4 → 6                +2                                              │
│ LLM calls               4 → 6                +2                                              │
│ Tool calls              6 → 8                +2                                              │
│ Duration            35.6s → 50.0s          +40%                                              │
│ Cost             $0.00019 → $0.00043      +132%                                              │
│ Max context tok       917 → 1,641          +724                                              │
│                                                                                              │
│ ── removed calls                                                                             │
│   · calculate({"expression":"240*4"})                                                        │
│   · calculate({"expression":"(31-18)*9/5"})                                                  │
│   · calculate({"expression":"101103.8/3"})                                                   │
│                                                                                              │
│ ── added calls                                                                               │
│   + calculate({"expression":"(31*9/5)+32"})                                                  │
│   + calculate({"expression":"(18*9/5)+32"})                                                  │
│   + calculate({"expression":"87.8 - 64.4"})                                                  │
│   + calculate({"expression":"240 * 4"})                                                      │
│   + calculate({"expression":"101103.8 / 3"})                                                 │
│                                                                                              │
│ ── input-token delta by step (before → after)                                                │
│   Step 2: 691 → 668 (-3%)                                                                    │
│   Step 5: 847 → 1,504 (+78%)                                                                 │
│   Step 6: 917 → 1,641 (+79%)                                                                 │
│                                                                                              │
│ $0.00025 more expensive                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────────────┘`,
    exitCode: 0,
  },
  diffJson: {
    command: `costcatch diff --json .costcatch/2026-09-02T06-54-46-test_agent.json .costcatch/2026-09-02T06-58-18-test_agent.json`,
    output: `{
  "before": {
    "totalSteps": 4,
    "llmCalls": 4,
    "toolCalls": 6,
    "durationMs": 35605,
    "costUsd": 0.000186234,
    "maxContext": 917
  },
  "after": {
    "totalSteps": 6,
    "llmCalls": 6,
    "toolCalls": 8,
    "durationMs": 49973,
    "costUsd": 0.000431282,
    "maxContext": 1641
  },
  "delta": {
    "steps": 2,
    "llmCalls": 2,
    "toolCalls": 2,
    "durationMs": 14368,
    "costUsd": 0.000245048,
    "maxContext": 724
  },
  "addedToolCalls": [
    "calculate({\\"expression\\":\\"(31*9/5)+32\\"})",
    "calculate({\\"expression\\":\\"(18*9/5)+32\\"})",
    "calculate({\\"expression\\":\\"87.8 - 64.4\\"})",
    "calculate({\\"expression\\":\\"240 * 4\\"})",
… (output continues)`,
    exitCode: 0,
  },
  stats: {
    command: `costcatch stats`,
    output: `┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ costcatch                                                                   stats · all time │
│                                                                                              │
│ Total runs:      12                                                                          │
│ Total cost:      $0.00119                                                                    │
│ Avg cost/run:    $0.000099                                                                   │
│                                                                                              │
│ ── most expensive scripts                                                                    │
│   $0.00106  test_agent.mjs  (5 runs)                                                         │
│   $0.00011  test_simple.mjs  (6 runs)                                                        │
│   $0.000017  agent.py  (1 runs)                                                              │
│                                                                                              │
│ ── most expensive models                                                                     │
│   $0.00119  deepseek/deepseek-v4-flash-0731  (32 calls)                                      │
│                                                                                              │
│ ── tokens per run                                                                            │
│   avg input tok/run:   1,690                                                                 │
│   avg output tok/run:  475                                                                   │
│                                                                                              │
│ ── slowest runs                                                                              │
│      55.6s  test_agent.mjs  2026-08-29T07-08-28                                              │
│      54.7s  test_agent.mjs  2026-08-29T07-12-52                                              │
│      50.0s  test_agent.mjs  2026-09-02T06-58-18                                              │
│                                                                                              │
│ 12 runs · $0.00119 total                                                                     │
└──────────────────────────────────────────────────────────────────────────────────────────────┘`,
    exitCode: 0,
  },
  statsJson: {
    command: `costcatch stats --json`,
    output: `{
  "period": "all time",
  "totalRuns": 12,
  "totalCostUsd": 0.001191297,
  "avgCostUsd": 0.00009927475,
  "scripts": [
    {
      "script": "test_agent.mjs",
      "costUsd": 0.0010619820000000002,
      "runs": 5
    },
    {
      "script": "test_simple.mjs",
      "costUsd": 0.00011186000000000002,
      "runs": 6
    },
    {
      "script": "/private/tmp/claude-501/-Users-ronakrahane-Desktop-agent-trace/1176dce3-d472-40c0-ba49-35d0c89f9b16/scratchpad/live/agent.py",
      "costUsd": 0.000017455,
      "runs": 1
    }
  ],
  "models": [
    {
      "model": "deepseek/deepseek-v4-flash-0731",
      "costUsd": 0.0011912970000000004,
      "calls": 32
    }
  ],
  "avgInputTokensPerRun": 1690,
  "avgOutputTokensPerRun": 475,
  "slowestRuns": [
    {
      "script": "test_agent.mjs",
… (output continues)`,
    exitCode: 0,
  },
  estimateCompare: {
    command: `costcatch estimate prompt.txt --model gpt-4o,claude-sonnet-4,deepseek/deepseek-v4-flash-0731`,
    output: `┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ costcatch                                                                estimate · 3 models │
│                                                                                              │
│ File  prompt.txt  ·  361 chars                                                               │
│                                                                                              │
│   ● Model Comparison                                                                         │
│                                                                                              │
│   ┌──────────────────────┬────────┬────────────┬────────────┐                                │
│   │ Model                │ Tokens │       Cost │ Impact     │                                │
│   ├──────────────────────┼────────┼────────────┼────────────┤                                │
│   │ deepseek-v4-flash-0… │    ~91 │ $0.0000059 │ ░░░░░░░░░░ │                                │
│   │ gpt-4o               │    ~91 │   $0.00023 │ ████████░░ │                                │
│   │ claude-sonnet-4      │   ~101 │   $0.00030 │ ██████████ │                                │
│   └──────────────────────┴────────┴────────────┴────────────┘                                │
│                                                                                              │
│     ✦ deepseek/deepseek-v4-… is 98% cheaper than claude-sonnet-4                             │
│                                                                                              │
│   ● Tokenizer Details                                                                        │
│                                                                                              │
│     ┌────────────────────────────┬───────────────┬─────────────┬────────────┐                │
│     │ Model                      │ Tokenizer     │       Ratio │ Confidence │                │
│     ├────────────────────────────┼───────────────┼─────────────┼────────────┤                │
│     │ deepseek/deepseek-v4-flas… │ generic-bpe   │ ~4.0 ch/tok │     ✓ ±10% │                │
│     │ gpt-4o                     │ o200k_base    │ ~4.0 ch/tok │     ✓ ±10% │                │
│     │ claude-sonnet-4            │ claude-bpe-v1 │ ~3.6 ch/tok │     ✓ ±10% │                │
│     └────────────────────────────┴───────────────┴─────────────┴────────────┘                │
│                                                                                              │
│ ✦ character-ratio heuristics · actual tokens may vary                                        │
└──────────────────────────────────────────────────────────────────────────────────────────────┘`,
    exitCode: 0,
  },
  estimateBreakdown: {
    command: `costcatch estimate prompt.txt --model gpt-4o --breakdown`,
    output: `┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ costcatch                                                                  estimate · gpt-4o │
│                                                                                              │
│ File     prompt.txt                                                                          │
│ Model    gpt-4o                                                                              │
│ Content  prose · o200k_base · ~4.0 chars/tok                                                 │
│                                                                                              │
│   ● Token Estimate                                                                           │
│                                                                                              │
│     ┌──────────────────┬────────┐                                                            │
│     │ Metric           │  Value │                                                            │
│     ├──────────────────┼────────┤                                                            │
│     │ Characters       │    361 │                                                            │
│     │ Estimated Tokens │    ~91 │                                                            │
│     │ Confidence       │ ✓ ±10% │                                                            │
│     └──────────────────┴────────┘                                                            │
│                                                                                              │
│   ● Cost Estimate (input only)                                                               │
│                                                                                              │
│     ┌──────────────────────────┬─────────────────────┐                                       │
│     │ Scale                    │ Est. Cost (Monthly) │                                       │
│     ├──────────────────────────┼─────────────────────┤                                       │
│     │ Per single call          │            $0.00023 │                                       │
│     │ 10 calls/day (300/mo)    │            $0.06825 │                                       │
│     │ 100 calls/day (3k/mo)    │            $0.68250 │                                       │
│     │ 1,000 calls/day (30k/mo) │            $6.82500 │                                       │
│     └──────────────────────────┴─────────────────────┘                                       │
│                                                                                              │
│   ● Breakdown                                                                                │
│                                                                                              │
│     ┌────────────────────────────────┬────────┬─────┬──────────────┐                         │
│     │ Section                        │ Tokens │   % │ Distribution │                         │
│     ├────────────────────────────────┼────────┼─────┼──────────────┤                         │
│     │ You are a senior support engi… │     34 │ 38% │ ███▓░░░░░░   │                         │
│     │ The customer reports that the… │     56 │ 62% │ ██████░░░░   │                         │
│     └────────────────────────────────┴────────┴─────┴──────────────┘                         │
│                                                                                              │
│ ✦ character-ratio heuristics · actual tokens may vary                                        │
└──────────────────────────────────────────────────────────────────────────────────────────────┘`,
    exitCode: 0,
  },
  estimateJson: {
    command: `costcatch estimate prompt.txt --model gpt-4o --json`,
    output: `{
  "file": "prompt.txt",
  "models": [
    {
      "model": "gpt-4o",
      "estimatedTokens": 91,
      "characterCount": 361,
      "charsPerToken": 4,
      "tokenizerFamily": "o200k_base",
      "confidence": "high",
      "margin": 0.1,
      "contentType": "prose",
      "costUsd": 0.0002275,
      "costPerMonth100": 0.68,
      "sections": null
    }
  ]
}`,
    exitCode: 0,
  },
  estimateGate: {
    command: `costcatch estimate prompt.txt --model gpt-4o --max-cost 0.00001`,
    output: `└──────────────────────────────────────────────────────────────────────────────────────────────┘


┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ✗ CI GATE: estimated cost $0.00023 exceeds --max-cost $0.000010                              │
└──────────────────────────────────────────────────────────────────────────────────────────────┘`,
    exitCode: 1,
  },
  cleanNoCriterion: {
    command: `costcatch clean`,
    output: `┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ ✗ Nothing to do: pass --keep <n> and/or --older-than <days>.                                 │
│   costcatch clean --keep 50 keep the 50 newest traces                                        │
│   costcatch clean --older-than 30 delete traces older than 30 days                           │
│   add --dry-run to preview without deleting                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────┘`,
    exitCode: 2,
  },
  cleanDryRun: {
    command: `costcatch clean --keep 4 --dry-run`,
    output: `┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ costcatch                                                                    clean · dry run │
│                                                                                              │
│ ── would delete                                                                              │
│   sec-audit.json                                                                             │
│   2026-08-29T08-30-17-test_agent.json                                                        │
│   2026-08-29T07-14-25-test_simple.json                                                       │
│   simple-baseline.json                                                                       │
│   2026-08-29T07-12-52-test_agent.json                                                        │
│   2026-08-29T07-09-47-test_simple.json                                                       │
│   2026-08-29T07-08-28-test_agent.json                                                        │
│   2026-08-22T14-33-20-agent.json                                                             │
│                                                                                              │
│ 8 of 12 traces would be deleted · nothing was removed                                        │
└──────────────────────────────────────────────────────────────────────────────────────────────┘`,
    exitCode: 0,
  },
  errRuntime: {
    command: `costcatch run ruby agent.rb`,
    output: `✗ Could not detect runtime for: ruby
    The first argument must be a python or node executable.
    Supported: python, python3, python3.x, node, nodejs, npx, tsx, ts-node
    bun and deno are not supported: neither honours --require, so nothing
    would be captured. Use \`node\` for those scripts to trace them.

    Example: costcatch python my_agent.py`,
    exitCode: 2,
  },
  errFilter: {
    command: `costcatch run --filter openai-typo node -e 1`,
    output: `✗ Unknown provider for --filter: openai-typo
    Known providers: openai, anthropic, openrouter, groq, mistral, google, ollama, cohere, generic`,
    exitCode: 2,
  },
  errNoCalls: {
    command: `costcatch run node -e console.log('no llm here')`,
    output: `┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ △ No LLM API calls detected during this run.                                                 │
│   Supported: openai · anthropic · openrouter · groq · mistral · google · ollama · cohere ·   │
│     generic                                                                                  │
│   If your agent did call an LLM, it may use an unsupported transport.                        │
└──────────────────────────────────────────────────────────────────────────────────────────────┘`,
    exitCode: 0,
  },
  errFilterUnused: {
    command: `costcatch run --filter anthropic node --env-file=.env test_simple.mjs`,
    output: `
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ △ No LLM API calls to anthropic during this run.                                             │
│   --filter anthropic hides any calls to other providers.                                     │
│   Re-run without the flag to see whether other providers were called.                        │
└──────────────────────────────────────────────────────────────────────────────────────────────┘`,
    exitCode: 0,
  },
  traceFile: {
    command: `cat .costcatch/2026-09-02T06-55-29-test_simple.json`,
    output: `{
  "runId": "2026-09-02T06-55-29",     // also the filename and the display id
  "script": "test_simple.mjs",
  "runtime": "node",                   // "node" | "python"
  "durationMs": 7266,                  // first request start → last response end
  "totalCostUsd": 0.00002036,           // null if ANY step is unpriced
  "steps": [
    {
      "type": "llm",                   // "llm" | "tool"
      "id": 1,
      "durationMs": 7266,
      "provider": "openrouter",
      "model": "deepseek/deepseek-v4-flash-0731",
      "inputTokens": 36,               // TOTAL prompt tokens, cached included
      "outputTokens": 116,
      "cachedTokens": 0,               // subset of inputTokens
      "costUsd": 0.00002036,
      "toolCalls": [],                 // [{ name, input }]
      "isStreaming": false,
      "finishReason": "stop",
      "statusCode": 200,
      "error": null,                   // { type, message } on failure
      "content": {
        "system": null,
        "messages": [{ "role": "user", "content": "… «email» … «phone» …" }],
        "output": " Hello John, …",
        "truncated": false             // true once the 8 MB content budget is hit
      },
      "retryOf": null                  // step id whose prompt this repeats
    }
  ],
  "warnings": [],                      // [{ severity, code, message, stepIds }]
  "summary": {
    "llmCalls": 1, "toolCalls": 0,
    "totalInputTokens": 36, "totalOutputTokens": 116, "totalSteps": 1,
    "retries": 0, "wastedCostUsd": 0
  },
  "startedAt": "2026-09-02T06:55:29.723Z",
  "command": "node --env-file=.env test_simple.mjs"   // redacted
}`,
    exitCode: 0,
  },
} satisfies Record<string, Capture>;

export type CaptureId = keyof typeof CAPTURES;
