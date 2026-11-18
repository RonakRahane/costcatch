# Changelog

Notable changes to costcatch. Versions follow [Semantic Versioning](https://semver.org/).

## 0.2.0 (2026-11-18)

- Raise the minimum supported Node.js version to 20.19.0.
- Update vulnerable npm development and build dependencies.
- Run CI on Node.js 20.19, 22, and 24.
- Refresh the README and website CLI captures with the November 18 pricing data.

## 0.1.0 (2026-10-27)

The first public release.

- Trace any Python or Node.js agent, script or backend by putting `costcatch` in
  front of its command. No code changes.
- A live view of every LLM call while the program runs, then the full trace:
  tokens, cost, tool calls and the size of their results, failures, and timing
  for every step.
- Warnings for failed calls and tools, tool loops, retries, cut-off or blocked
  output, growing context, large tool results, duplicate calls, expensive steps
  and slow steps.
- Costs from public price lists that `costcatch init` downloads, including
  prompt caching, Anthropic's one-hour and OpenAI's 30-minute and 12-hour cache
  writes, long-prompt rates, flex and priority processing, US-only inference,
  fast mode and web search fees. Anything that can't be priced shows `$?.??`
  instead of a guess, and a run tells you when `costcatch init` hasn't been run.
- CI gates: `--max-cost`, `--max-calls` and `--max-errors`, and `--budget` to
  stop a runaway agent.
- Commands to read and compare saved runs (`show`, `replay`, `diff`, `stats`),
  to price a prompt before sending it (`estimate`), and to set up and tidy up
  (`init`, `clean`).
- Secrets are always removed from traces, and personal data is removed by
  default.
- Providers: OpenAI and Azure OpenAI, Anthropic and Claude on Vertex AI, Gemini,
  OpenRouter, Groq, Mistral, Cohere, Ollama, and any OpenAI-compatible server.
