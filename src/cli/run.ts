// `costcatch run`, the default command. Runs the program with the interceptor and checks the CI gates.

import type { RunFlags } from "../types/config.js";
import { findRuntime } from "../core/runtime-detect.js";
import { spawnTraced } from "../core/tracer.js";
import { runLive, runPlain, type RunContext, type RunResult } from "../ui/live-controller.js";
import { renderTree, countFailures, failureSummary } from "../renderers/tree.js";
import { renderJson } from "../renderers/json.js";
import { renderShow } from "../renderers/show.js";
import { renderDiff } from "../renderers/diff.js";
import { saveTrace } from "../storage/save.js";
import {
  c,
  dim,
  glyph,
  insideTurboTui,
  notice,
  outputMode,
  plural,
  prefixGutter,
  reserveColumns,
  setTerminalSizeSource,
  terminalSize,
  terminalSizePinned,
} from "../ui/theme.js";
import { followTurboPane, openRunnerTerminal } from "../ui/runner-terminal.js";
import { setLiveBoxFill } from "../renderers/live-tree.js";
import { formatCost, formatTotalCost } from "../core/cost-calculator.js";
import { isUnpricedCall, NOT_RECORDED_ERROR, unpricedCallsOf } from "../core/step-checks.js";
import { findPriorTrace } from "../core/compare-last.js";
import { diffTraces } from "../core/diff-engine.js";
import { ExitCode } from "./exit-codes.js";
import { getProviderNames } from "../providers/registry.js";
import type { Trace, LLMStep } from "../types/trace.js";
import { redactString } from "../core/redact.js";
import { ENV_MAX_TRACE_BYTES } from "../core/constants.js";

export async function runCommand(userCommand: string[], flags: RunFlags): Promise<number> {
  const useColor = !flags.noColor && !process.env.NO_COLOR;

  const found = findRuntime(userCommand);
  if (!found) {
    console.error(c("err", `\n  ${glyph.err} Could not detect runtime for: ${userCommand[0]}`));
    console.error(dim("    The command must name a python or node executable, directly or after a"));
    console.error(dim("    launcher such as `poetry run`, `uv run` or `env`."));
    console.error(dim("    Supported: python, python3, python3.x, node, nodejs, npx, tsx, ts-node"));
    console.error(dim("    bun and deno are not supported: neither honours --require, so nothing"));
    console.error(dim("    would be captured. Use `node` for those scripts to trace them.\n"));
    console.error(dim("    Example: costcatch python my_agent.py"));
    console.error(dim("             costcatch -- uv run python my_agent.py\n"));
    return ExitCode.Usage;
  }
  const runtime = found.runtime;
  const launcher = found.index > 0 ? redactString(userCommand[0]) : null;

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
    script: redactString(extractScriptName(userCommand.slice(found.index)), flags.redact !== false),
    runtime,
    // Redact the command too, since argv can carry keys like `--api-key sk-...`.
    command: redactString(userCommand.join(" "), flags.redact !== false),
    startedAt,
    showCost: flags.cost !== false,
    filter: flags.filter,
    thresholdMs: flags.threshold,
    budgetUsd: flags.budget,
    redactPii: flags.redact !== false,
  };

  // --compare-last needs a saved trace to diff against.
  const shouldSave = Boolean(flags.save || flags.saveAs || flags.compareLast);

  let liveMode = outputMode() === "redraw" && useColor && !flags.json && !flags.quiet;
  const turboPane = liveMode && insideTurboTui();
  const gutter = liveMode ? prefixGutter() : 0;
  reserveColumns(gutter);
  // Task runners never resize a task's pty, so measure the runner's terminal or fall back to plain lines.
  if (turboPane) {
    const turboWindow = terminalSizePinned() ? null : openRunnerTerminal();
    if (turboWindow) setTerminalSizeSource(followTurboPane(terminalSize(), turboWindow));
    else setLiveBoxFill(false);
  } else if (gutter > 0 && !terminalSizePinned()) {
    const runnerTerminal = openRunnerTerminal();
    if (runnerTerminal) {
      setTerminalSizeSource(runnerTerminal);
    } else {
      liveMode = false;
      console.error(
        dim(
          `  ${glyph.warn} live view off: costcatch cannot see this terminal's size behind the task runner,` +
            ` and a box it cannot re-measure breaks when the window is resized.` +
            ` Set COLUMNS and LINES to turn it back on.`,
        ),
      );
    }
  }

  // --json sends the program's output to stderr to keep stdout clean.
  const pipeChildOutput = liveMode || flags.json;

  let result: RunResult;
  try {
    const handle = spawnTraced(userCommand, runtime, { pipeChildOutput });
    result = liveMode
      ? await runLive(handle, ctx, { gutter, anchored: turboPane })
      : await runPlain(handle, ctx, {
          progressive: !flags.json && !flags.quiet,
          childToStderr: flags.json,
        });
  } catch (err) {
    console.error(c("err", `\n  ${glyph.err} ${err instanceof Error ? err.message : String(err)}\n`));
    return ExitCode.Internal;
  }

  const { trace, exitCode, budgetExceeded, captureLimited } = result;

  if (budgetExceeded) {
    console.error(notice("err", `BUDGET: run stopped, spend passed --budget ${formatCost(flags.budget ?? 0)}`));
  }
  if (captureLimited) {
    console.error(
      notice("warn", "Capture limit reached: later LLM calls in this run were not recorded.", [
        "Costs and counts below are a lower bound.",
        `Raise ${ENV_MAX_TRACE_BYTES} (bytes) to record more.`,
      ]),
    );
  }

  if (trace.steps.length === 0) {
    if (flags.json) {
      console.log(renderJson(trace));
    } else if (result.failedToStart) {
      // The tracer already printed why it failed.
    } else if (!flags.quiet) {
      if (flags.filter) {
        console.log(
          notice("warn", `No LLM API calls to ${flags.filter} during this run.`, [
            `--filter ${flags.filter} hides any calls to other providers.`,
            "Re-run without the flag to see whether other providers were called.",
          ]),
        );
      } else {
        console.log(
          notice("warn", "No LLM API calls detected during this run.", [
            `Supported: ${getProviderNames().join(" · ")}`,
            "If your agent did call an LLM, it may use an unsupported transport.",
            ...(launcher ? [`Or ${launcher} may not have passed the environment on to ${runtime}.`] : []),
          ]),
        );
      }
    }
    return budgetExceeded ? ExitCode.GateFailed : exitCode;
  }

  if (flags.json) {
    console.log(renderJson(trace));
  } else if (flags.quiet) {
    const cost = formatTotalCost(trace.totalCostUsd, unpricedCallsOf(trace));
    console.log(
      `${trace.summary.totalSteps} steps · ${trace.summary.llmCalls} LLM calls · ${cost} · ${(trace.durationMs / 1000).toFixed(1)}s`,
    );
  } else {
    console.log(renderTree(trace, ctx.showCost, useColor));
  }

  // Skip failed calls, because a 429 has no usage and stream_options is not the cause.
  const hasUnknown = trace.steps.some((s) => {
    if (s.type !== "llm") return false;
    const llm = s as LLMStep;
    const failed = Boolean(llm.error) || (llm.statusCode !== undefined && llm.statusCode >= 400);
    return llm.isStreaming && !failed && llm.inputTokens === null;
  });
  if (hasUnknown && !flags.json && !flags.quiet) {
    console.log(
      notice("warn", "Some calls have unknown tokens (streaming without usage data).", [
        "Add stream_options: { include_usage: true } to OpenAI chat-completion streams.",
      ]),
    );
  }

  // The tree looks the same with redaction off, so warn before PII ends up in a commit.
  if (flags.redact === false && !flags.json && !flags.quiet) {
    console.log(
      notice("warn", "PII redaction is OFF (--no-redact).", [
        "Emails, phone numbers and card numbers were captured as written.",
        shouldSave ? "The saved trace contains them in plain text." : "Nothing was saved, so they exist only in this output.",
      ]),
    );
  }

  let saved: Trace | null = null;
  let savedPath: string | undefined;
  if (shouldSave) {
    try {
      savedPath = saveTrace(trace, process.cwd(), flags.saveAs);
      saved = trace;
      if (!flags.json && !flags.quiet) {
        console.log(`  ${c("ok", glyph.ok)} Trace saved: ${c("accent", savedPath)}\n`);
      }
    } catch (err) {
      console.error(c("warn", `  ${glyph.warn} ${err instanceof Error ? err.message : String(err)}\n`));
    }
  }

  if (flags.inspect && !flags.json) {
    console.log(renderShow(trace, { useColor }));
  }

  if (flags.compareLast && !flags.json && !flags.quiet) {
    if (!saved) {
      console.log(dim(`  ${glyph.spark} --compare-last needs a saved trace; the save above failed.\n`));
    } else {
      const prior = findPriorTrace(trace, process.cwd(), savedPath);
      if (prior) {
        const diff = diffTraces(prior, trace);
        if (!flags.quiet) {
          console.log(dim(`  ${glyph.flow} comparing against: ${prior.runId} (${prior.script})\n`));
        }
        console.log(renderDiff(diff, useColor));
      } else if (!flags.quiet) {
        console.log(
          dim(`  ${glyph.spark} No prior trace found for ${ctx.script}. Run again with --save to enable auto-diff.\n`),
        );
      }
    }
  }

  let ciFailure = budgetExceeded;
  if (flags.maxCost !== undefined) {
    // Check each step, because totalCostUsd is set as soon as any one step has a price.
    const llmSteps = trace.steps.filter((s): s is LLMStep => s.type === "llm");
    const succeeded = llmSteps.filter((s) => !s.error && (s.statusCode === undefined || s.statusCode < 400));
    // A call that failed after a 2xx response may still be billed, but it has no usage to show.
    const brokeOff = llmSteps.filter((s) => s.error && isUnpricedCall(s) && s.error.type !== NOT_RECORDED_ERROR);
    const noUsage = [...succeeded.filter((s) => s.inputTokens === null || s.outputTokens === null), ...brokeOff];
    const noPricing = succeeded.filter((s) => s.inputTokens !== null && s.outputTokens !== null && s.costUsd === null);

    if (noPricing.length > 0) {
      const models = [...new Set(noPricing.map((s) => s.model))];
      console.error(notice("err", `CI GATE: --max-cost cannot be evaluated, no pricing for ${models.join(", ")}.`));
      console.error(dim("    Run `costcatch init` to refresh the pricing database.\n"));
      ciFailure = true;
    } else if (noUsage.length > 0) {
      const models = [...new Set(noUsage.map((s) => s.model))];
      console.error(notice("err", `CI GATE: --max-cost cannot be evaluated, no token usage for ${models.join(", ")}.`));
      console.error(dim("    A streamed call reports usage only when the request asks for it.\n"));
      ciFailure = true;
    } else if (trace.totalCostUsd === null && succeeded.length > 0) {
      console.error(notice("err", `CI GATE: --max-cost cannot be evaluated, no priced calls in this run.`));
      ciFailure = true;
    } else if (trace.totalCostUsd !== null && trace.totalCostUsd > flags.maxCost) {
      console.error(
        notice("err", `CI GATE: cost ${formatCost(trace.totalCostUsd)} exceeds --max-cost ${formatCost(flags.maxCost)}`),
      );
      ciFailure = true;
    } else if (captureLimited) {
      console.error(notice("err", "CI GATE: --max-cost cannot be evaluated, the capture limit cut the run short."));
      ciFailure = true;
    }
  }
  if (flags.maxCalls !== undefined && trace.summary.llmCalls > flags.maxCalls) {
    console.error(notice("err", `CI GATE: ${trace.summary.llmCalls} LLM calls exceeds --max-calls ${flags.maxCalls}`));
    ciFailure = true;
  } else if (flags.maxCalls !== undefined && captureLimited) {
    console.error(notice("err", "CI GATE: --max-calls cannot be evaluated, the capture limit cut the run short."));
    ciFailure = true;
  }

  if (flags.maxErrors !== undefined) {
    const failures = countFailures(trace.steps);
    const errors = failures.calls + failures.tools;
    if (errors > flags.maxErrors) {
      const which = failureSummary(failures);
      console.error(
        notice("err", `CI GATE: ${plural(errors, "error")} (${which}) exceeds --max-errors ${flags.maxErrors}`),
      );
      ciFailure = true;
    } else if (captureLimited) {
      console.error(notice("err", "CI GATE: --max-errors cannot be evaluated, the capture limit cut the run short."));
      ciFailure = true;
    }
  }

  if (ciFailure) return ExitCode.GateFailed;
  return exitCode;
}

const VALUE_OPTIONS = new Set([
  "-r", "--require", "--import", "--loader", "--experimental-loader", "--env-file", "--env-file-if-exists",
  "-C", "--conditions", "--input-type", "--inspect-port", "--title", "--watch-path",
  "-W", "-X", "--check-hash-based-pycs",
  "-P", "--project", "-O", "--compiler-options",
]);

const INLINE_OPTIONS = new Set(["-c", "-e", "--eval", "-p", "--print"]);

// In `npx tsx agent.ts` the first argument is a tool, not the script.
const TOOL_RUNNERS = new Set(["npx"]);

export function extractScriptName(command: string[]): string {
  const runner = command[0] ? command[0].replace(/\\/g, "/").split("/").pop()!.replace(/\.(exe|cmd|bat)$/i, "") : "";
  let skipTool = TOOL_RUNNERS.has(runner.toLowerCase());
  for (let i = 1; i < command.length; i++) {
    const arg = command[i];
    if (arg === "-m") return i + 1 < command.length ? command[i + 1] : "<module>";
    if (INLINE_OPTIONS.has(arg)) return "<inline>";
    if (VALUE_OPTIONS.has(arg)) {
      i++;
      continue;
    }
    if (arg.startsWith("-")) continue;
    if (skipTool) {
      skipTool = false;
      continue;
    }
    return arg;
  }
  return command[command.length - 1] || "unknown";
}
