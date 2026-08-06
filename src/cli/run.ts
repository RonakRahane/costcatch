/**
 * `costcatch run` command — the default command.
 *
 * Flow:
 *   1. Detect the runtime (python/node).
 *   2. Spawn the child with the interceptor injected.
 *   3. Drive the terminal experience:
 *        · live TUI    (TTY, colored, not --json/--quiet)
 *        · plain lines (CI / piped / --no-color)
 *   4. Render the final static trace exactly once, then save if asked.
 *   5. Post-run features:
 *        · --inspect      → render the full conversation content (show view)
 *        · --compare-last → auto-diff against the prior saved trace
 *        · --max-cost/--max-calls → CI assertion gates (non-zero exit)
 *
 * Exit-code contract (see {@link ExitCode}): the traced program's own status is
 * passed through untouched unless costcatch itself has something to report.
 */

import type { RunFlags } from "../types/config.js";
import { detectRuntime } from "../core/runtime-detect.js";
import { spawnTraced } from "../core/tracer.js";
import { runLive, runPlain, type RunContext, type RunResult } from "../ui/live-controller.js";
import { renderTree } from "../renderers/tree.js";
import { renderJson } from "../renderers/json.js";
import { renderShow } from "../renderers/show.js";
import { renderDiff } from "../renderers/diff.js";
import { saveTrace } from "../storage/save.js";
import { c, dim, glyph } from "../ui/theme.js";
import { formatCost } from "../core/cost-calculator.js";
import { findPriorTrace } from "../core/compare-last.js";
import { diffTraces } from "../core/diff-engine.js";
import { ExitCode } from "./exit-codes.js";
import { getProviderNames } from "../providers/registry.js";
import type { Trace, LLMStep } from "../types/trace.js";

export async function runCommand(userCommand: string[], flags: RunFlags): Promise<number> {
  const useColor = !flags.noColor && !process.env.NO_COLOR;

  const runtime = detectRuntime(userCommand);
  if (!runtime) {
    console.error(c("err", `\n  ${glyph.err} Could not detect runtime for: ${userCommand[0]}`));
    console.error(dim("    The first argument must be a python or node executable."));
    console.error(dim("    Supported: python, python3, python3.x, node, nodejs, npx, tsx, ts-node, bun, deno"));
    console.error(dim("    Example: costcatch python my_agent.py\n"));
    return ExitCode.Usage;
  }

  // A mistyped provider would otherwise filter every call away and report a
  // perfectly plausible empty trace, which reads as "your agent made no LLM
  // calls" — the single most misleading thing this tool can say.
  if (flags.filter) {
    const known = getProviderNames();
    if (!known.some((name) => name.toLowerCase() === flags.filter!.toLowerCase())) {
      console.error(c("err", `\n  ${glyph.err} Unknown provider for --filter: ${flags.filter}`));
      console.error(dim(`    Known providers: ${known.join(", ")}\n`));
      return ExitCode.Usage;
    }
  }

  const startedAt = new Date().toISOString();
  const ctx: RunContext = {
    script: extractScriptName(userCommand),
    runtime,
    command: userCommand.join(" "),
    startedAt,
    showCost: flags.cost !== false,
    filter: flags.filter,
    thresholdMs: flags.threshold,
    budgetUsd: flags.budget,
    redactPii: flags.redact !== false,
  };

  // --compare-last requires a saved trace to diff against.
  const shouldSave = Boolean(flags.save || flags.saveAs || flags.compareLast);

  // Live TUI only when we own an interactive, colored terminal.
  const liveMode = process.stdout.isTTY === true && useColor && !flags.json && !flags.quiet;

  // In --json mode we pipe the child's output to OUR stderr so stdout stays a
  // pure JSON document (safe to `| jq`). Live mode also pipes (to render the
  // child's output above the box). Otherwise inherit stdio directly.
  const pipeChildOutput = liveMode || flags.json;

  let result: RunResult;
  try {
    const handle = spawnTraced(userCommand, runtime, { pipeChildOutput });
    result = liveMode
      ? await runLive(handle, ctx)
      : await runPlain(handle, ctx, {
          // Progressive lines only for a plain human terminal — never for json/quiet.
          progressive: !flags.json && !flags.quiet,
          childToStderr: flags.json,
        });
  } catch (err) {
    // Setup failures (missing interceptors, unwritable temp dir) are ours, not
    // the user's program's — report them distinctly from a child exit code.
    console.error(c("err", `\n  ${glyph.err} ${err instanceof Error ? err.message : String(err)}\n`));
    return ExitCode.Internal;
  }

  const { trace, exitCode, budgetExceeded } = result;

  if (budgetExceeded) {
    console.error(
      c("err", `\n  ${glyph.err} BUDGET: run stopped — spend passed --budget ${formatCost(flags.budget ?? 0)}`),
    );
  }

  // ── No calls captured ──
  if (trace.steps.length === 0) {
    if (flags.json) {
      console.log(renderJson(trace));
    } else if (!flags.quiet) {
      console.log(c("warn", `\n  ${glyph.warn} No LLM API calls detected during this run.`));
      console.log(dim("    Supported: OpenAI · Anthropic · Groq · Mistral · Google · Ollama · Cohere · OpenRouter"));
      console.log(dim("    (If your agent did call an LLM, it may use an unsupported transport.)\n"));
    }
    return budgetExceeded ? ExitCode.GateFailed : exitCode;
  }

  // ── Final render (exactly once) ──
  if (flags.json) {
    console.log(renderJson(trace));
  } else if (flags.quiet) {
    const cost = trace.totalCostUsd !== null ? formatCost(trace.totalCostUsd) : "$?.??";
    console.log(
      `${trace.summary.totalSteps} steps · ${trace.summary.llmCalls} LLM calls · ${cost} · ${(trace.durationMs / 1000).toFixed(1)}s`,
    );
  } else {
    console.log(renderTree(trace, ctx.showCost, useColor));
  }

  // ── Streaming tip ──
  const hasUnknown = trace.steps.some((s) => s.type === "llm" && (s as LLMStep).inputTokens === null);
  if (hasUnknown && !flags.json && !flags.quiet) {
    console.log(dim(`  ${glyph.spark} Some calls have unknown tokens (streaming without usage data).`));
    console.log(dim("     Add stream_options: { include_usage: true } for OpenAI streamed calls.\n"));
  }

  // ── Save ──
  let saved: Trace | null = null;
  if (shouldSave) {
    try {
      const savedPath = saveTrace(trace, process.cwd(), flags.saveAs);
      saved = trace;
      if (!flags.json && !flags.quiet) {
        console.log(`  ${c("ok", glyph.ok)} Trace saved: ${c("accent", savedPath)}\n`);
      }
    } catch (err) {
      // A failed save is worth reporting, but the run itself still succeeded and
      // its trace has already been rendered.
      console.error(c("warn", `  ${glyph.warn} ${err instanceof Error ? err.message : String(err)}\n`));
    }
  }

  // ── --inspect: show full conversation content ──
  if (flags.inspect && !flags.json) {
    console.log(renderShow(trace, { useColor }));
  }

  // ── --compare-last: auto-diff against prior saved trace ──
  if (flags.compareLast && !flags.json) {
    if (!saved) {
      console.log(dim(`  ${glyph.spark} --compare-last needs a saved trace; the save above failed.\n`));
    } else {
      const prior = findPriorTrace(trace, process.cwd());
      if (prior) {
        const diff = diffTraces(prior, trace);
        if (!flags.quiet) {
          console.log(dim(`  ${glyph.flow} comparing against: ${prior.runId} (${prior.script})\n`));
        }
        console.log(renderDiff(diff, useColor));
      } else if (!flags.quiet) {
        console.log(
          dim(`  ${glyph.spark} No prior trace found for ${ctx.script} — run again with --save to enable auto-diff.\n`),
        );
      }
    }
  }

  // ── CI assertion gates ──
  let ciFailure = budgetExceeded;
  if (flags.maxCost !== undefined) {
    if (trace.totalCostUsd === null) {
      // Refusing to pass an unverifiable gate: with an unknown model in the
      // trace, "cost <= max" cannot be established, and silently succeeding
      // would make the gate useless exactly when pricing data is missing.
      console.error(
        c("err", `\n  ${glyph.err} CI GATE: --max-cost cannot be evaluated — at least one call has unknown pricing.`),
      );
      console.error(dim("    Run `costcatch init` to refresh the pricing database.\n"));
      ciFailure = true;
    } else if (trace.totalCostUsd > flags.maxCost) {
      console.error(
        c(
          "err",
          `\n  ${glyph.err} CI GATE: cost ${formatCost(trace.totalCostUsd)} exceeds --max-cost ${formatCost(flags.maxCost)}`,
        ),
      );
      ciFailure = true;
    }
  }
  if (flags.maxCalls !== undefined && trace.summary.llmCalls > flags.maxCalls) {
    console.error(
      c("err", `\n  ${glyph.err} CI GATE: ${trace.summary.llmCalls} LLM calls exceeds --max-calls ${flags.maxCalls}`),
    );
    ciFailure = true;
  }

  if (ciFailure) return ExitCode.GateFailed;
  return exitCode;
}

/**
 * Extract a friendly script name from the user's command.
 *
 * Handles `python -m package`, `python -c '<inline>'`, and interpreter flags
 * that appear before the script path (`node --enable-source-maps agent.js`).
 */
function extractScriptName(command: string[]): string {
  for (let i = 1; i < command.length; i++) {
    const arg = command[i];
    if (arg === "-m") return i + 1 < command.length ? command[i + 1] : "<module>";
    if (arg === "-c") return "<inline>";
    if (arg.startsWith("-")) continue;
    return arg;
  }
  return command[command.length - 1] || "unknown";
}
