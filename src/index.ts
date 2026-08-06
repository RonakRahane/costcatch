/**
 * costcatch — CLI entry point.
 *
 * Zero-instrumentation LLM agent tracer & cost tracker.
 * Like `time` but for AI agents.
 *
 * ── Argument handling ──────────────────────────────────────────────────────
 * `run` (the default command) wraps ANOTHER program, so argv is split before
 * commander ever sees it: everything up to the first runtime executable (or a
 * `--` terminator) belongs to costcatch, everything after belongs to the user.
 * See `splitInvocation` in src/core/runtime-detect.ts for why.
 */

import { Command, CommanderError } from "commander";
import { runCommand } from "./cli/run.js";
import { replayCommand } from "./cli/replay.js";
import { diffCommand } from "./cli/diff.js";
import { statsCommand } from "./cli/stats.js";
import { watchCommand } from "./cli/watch.js";
import { initCommand } from "./cli/init.js";
import { showCommand } from "./cli/show.js";
import { estimateCommand } from "./cli/estimate.js";
import { splitInvocation } from "./core/runtime-detect.js";
import { getVersion } from "./core/version.js";
import { ExitCode } from "./cli/exit-codes.js";

/** Subcommands that take their own arguments rather than wrapping a program. */
const NON_WRAPPING_COMMANDS = new Set([
  "show",
  "estimate",
  "replay",
  "diff",
  "stats",
  "init",
  "help",
]);

/**
 * Parse a required numeric option, failing loudly on garbage.
 *
 * `parseInt`/`parseFloat` return NaN for non-numeric input, and NaN silently
 * disables every comparison it takes part in — so `--max-cost abc` used to
 * create a CI gate that could never fail. A typo in a cost guard has to be an
 * error, not a no-op.
 */
function numberOption(name: string, min: number) {
  return (value: string): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < min) {
      throw new CommanderError(
        ExitCode.Usage,
        "costcatch.invalidArgument",
        `error: option '${name}' expects a number >= ${min}, got '${value}'`,
      );
    }
    return parsed;
  };
}

const program = new Command();

program
  .name("costcatch")
  .description("Zero-instrumentation LLM agent tracer & cost tracker. Like `time` but for AI agents.")
  .version(getVersion(), "-v, --version", "Print the costcatch version")
  .showHelpAfterError("(run `costcatch --help` for usage)")
  .exitOverride(); // we own process.exit — see the bottom of this file

// ── Shared option wiring ───────────────────────────────────────────────────
// `run` and `watch` accept the same trace-shaping flags.
function withTraceOptions(cmd: Command): Command {
  return cmd
    .option("--save", "Save trace to .costcatch/", false)
    .option("--save-as <name>", "Save with a specific name")
    .option("--no-cost", "Hide the per-step cost breakdown")
    .option("--json", "Output raw JSON instead of the tree", false)
    .option("--no-color", "Plain text output (for CI)")
    .option("--filter <provider>", "Only show calls to a specific provider")
    .option("--threshold <ms>", "Warn on LLM calls slower than N ms", numberOption("--threshold", 1))
    .option("--quiet", "Only show summary, not full tree", false)
    .option("--no-redact", "Keep PII (emails/phones/cards) in captured content; secrets are always redacted")
    .option("--inspect", "After the run, show full conversation content for each step", false)
    .option("--compare-last", "Auto-diff against the most recent saved trace for this script", false)
    .option("--max-cost <usd>", "CI gate: non-zero exit if total cost exceeds N USD", numberOption("--max-cost", 0))
    .option("--max-calls <n>", "CI gate: non-zero exit if LLM call count exceeds N", numberOption("--max-calls", 0))
    .option("--budget <usd>", "Mid-run guard: terminate the program once spend exceeds N USD", numberOption("--budget", 0));
}

// ── run (default) ──────────────────────────────────────────────
// `costcatch run python my_agent.py` or just `costcatch python my_agent.py`
const runCmd = withTraceOptions(
  program
    .command("run", { isDefault: true })
    .description("Trace a script (default command — `run` is optional)")
    .argument("[command...]", "The program to trace, e.g. `python agent.py`"),
);

runCmd.addHelpText(
  "after",
  `
Examples:
  $ costcatch python agent.py
  $ costcatch --save --max-cost 0.50 python agent.py
  $ costcatch -- python agent.py --json     # '--' passes --json to YOUR program
`,
);

runCmd.action(async (commandArgs: string[], options) => {
  const userCommand = pendingUserCommand.length > 0 ? pendingUserCommand : commandArgs;

  if (userCommand.length === 0) {
    console.error("Error: No command specified.");
    console.error("Usage: costcatch python my_agent.py [args...]");
    console.error("       costcatch node my_agent.js [args...]");
    console.error("       costcatch -- <any command> [args...]");
    exitCode = ExitCode.Usage;
    return;
  }

  exitCode = await runCommand(userCommand, {
    save: options.save ?? false,
    saveAs: options.saveAs,
    cost: options.cost !== false, // commander sets `cost:false` only with --no-cost
    json: options.json ?? false,
    noColor: options.color === false,
    filter: options.filter,
    threshold: options.threshold,
    quiet: options.quiet ?? false,
    redact: options.redact !== false, // commander sets `redact:false` only with --no-redact
    inspect: options.inspect ?? false,
    compareLast: options.compareLast ?? false,
    maxCost: options.maxCost,
    maxCalls: options.maxCalls,
    budget: options.budget,
  });
});

// ── show ───────────────────────────────────────────────────────
program
  .command("show [file]")
  .description("Inspect the full conversation content of a saved trace (defaults to latest)")
  .option("--step <n>", "Show only step N (1-indexed)", numberOption("--step", 1))
  .option("--grep <term>", "Search for a string across all steps")
  .option("--no-color", "Plain text output")
  .action(async (file, options) => {
    exitCode = await showCommand(file, {
      step: options.step,
      grep: options.grep,
      noColor: options.color === false,
    });
  });

// ── estimate ───────────────────────────────────────────────────
program
  .command("estimate [file]")
  .description("Estimate token count and cost for a prompt file")
  .option("--model <name>", "Target model (comma-separated for comparison)")
  .option("--text <string>", "Inline prompt text")
  .option("--breakdown", "Show per-section token distribution", false)
  .option("--json", "Machine-readable output", false)
  .option("--no-color", "Plain text output")
  .option("--max-cost <usd>", "CI gate: exit 1 if estimated cost exceeds N USD", numberOption("--max-cost", 0))
  .action(async (file, options) => {
    exitCode = await estimateCommand(file, {
      model: options.model,
      text: options.text,
      breakdown: options.breakdown ?? false,
      json: options.json ?? false,
      noColor: options.color === false,
      maxCost: options.maxCost,
    });
  });

// ── replay ─────────────────────────────────────────────────────
program
  .command("replay [file]")
  .description("Re-display a saved trace (defaults to latest)")
  .option("--no-cost", "Hide the cost breakdown")
  .option("--json", "Output as JSON", false)
  .option("--no-color", "Plain text output")
  .action(async (file, options) => {
    exitCode = await replayCommand(file, {
      json: options.json,
      cost: options.cost !== false,
      noColor: options.color === false,
    });
  });

// ── diff ───────────────────────────────────────────────────────
program
  .command("diff [file1] [file2]")
  .description("Compare two saved traces side by side (defaults to last 2 runs)")
  .option("--no-color", "Plain text output")
  .action(async (file1, file2, options) => {
    exitCode = await diffCommand(file1, file2, { noColor: options.color === false });
  });

// ── stats ──────────────────────────────────────────────────────
program
  .command("stats")
  .description("Show aggregated analytics across saved traces")
  .option("--today", "Show stats for today only", false)
  .option("--week", "Show stats for the last 7 days", false)
  .option("--script <name>", "Filter by script name")
  .option("--model <name>", "Filter by model name")
  .option("--no-color", "Plain text output")
  .action(async (options) => {
    exitCode = await statsCommand({
      today: options.today,
      week: options.week,
      script: options.script,
      model: options.model,
      noColor: options.color === false,
    });
  });

// ── watch ──────────────────────────────────────────────────────
withTraceOptions(
  program
    .command("watch")
    .description("Traced run that always saves, with the live view on")
    .argument("[command...]", "The program to trace"),
).action(async (commandArgs: string[], options) => {
  const userCommand = pendingUserCommand.length > 0 ? pendingUserCommand : commandArgs;

  if (userCommand.length === 0) {
    console.error("Error: No command specified.");
    console.error("Usage: costcatch watch python my_agent.py");
    exitCode = ExitCode.Usage;
    return;
  }

  exitCode = await watchCommand(userCommand, {
    noColor: options.color === false,
    filter: options.filter,
    threshold: options.threshold,
    maxCost: options.maxCost,
    maxCalls: options.maxCalls,
    budget: options.budget,
    inspect: options.inspect ?? false,
    compareLast: options.compareLast ?? false,
    saveAs: options.saveAs,
  });
});

// ── init ───────────────────────────────────────────────────────
program
  .command("init")
  .description("Set up .costcatch/ and fetch the latest pricing database")
  .option("--offline", "Skip the pricing download and use bundled prices", false)
  .action(async (options) => {
    exitCode = await initCommand({ offline: options.offline ?? false });
  });

// ── Parse and execute ──────────────────────────────────────────

/**
 * The user's command, extracted before commander runs.
 *
 * Empty for non-wrapping subcommands; `run`/`watch` prefer it over commander's
 * variadic argument because commander would otherwise treat the traced
 * program's own flags as costcatch flags.
 */
let pendingUserCommand: string[] = [];

/** Set by each action; `process.exitCode` is assigned once at the very end. */
let exitCode: number = ExitCode.Success;

/**
 * Every flag costcatch itself understands, derived from the live command
 * definitions so it cannot drift as options are added.
 */
function ownFlagNames(): Set<string> {
  const names = new Set<string>();
  for (const command of [program, ...program.commands]) {
    for (const option of command.options) {
      if (option.long) names.add(option.long);
      if (option.short) names.add(option.short);
    }
  }
  return names;
}

/**
 * Warn when a costcatch-looking flag was handed to the traced program.
 *
 * argv is split at the first runtime executable, so `costcatch python agent.py
 * --save` gives `--save` to the agent — the same rule `time` and `env` follow.
 * That is the right semantic, but silently doing nothing is a terrible way to
 * express it, so we say what happened and how to get the other behaviour.
 */
function warnAboutMisplacedFlags(userCommand: string[]): void {
  const known = ownFlagNames();
  const misplaced = userCommand.slice(1).filter((token) => known.has(token));
  if (misplaced.length === 0) return;

  process.stderr.write(
    `costcatch: ${misplaced.join(", ")} came after your command, so ${
      misplaced.length === 1 ? "it was" : "they were"
    } passed to it rather than to costcatch.\n` +
      `           Put costcatch's flags first: costcatch ${misplaced.join(" ")} ${userCommand[0]} …\n` +
      `           To silence this and keep passing them through, use: costcatch -- ${userCommand.join(" ")}\n`,
  );
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const first = argv.find((a) => !a.startsWith("-"));
  const hasTerminator = argv.includes("--");

  let ownArgs = argv;
  if (first === undefined || !NON_WRAPPING_COMMANDS.has(first)) {
    const split = splitInvocation(argv);
    ownArgs = split.ownArgs;
    pendingUserCommand = split.userCommand;

    // An explicit `--` means the user already decided; don't second-guess them.
    if (!hasTerminator) warnAboutMisplacedFlags(pendingUserCommand);

    // `costcatch run python …` / `costcatch watch python …`: the subcommand name
    // is part of costcatch's own args, and splitInvocation already left it there.
    // `costcatch python …` has no subcommand, so the default command applies.
  }

  try {
    await program.parseAsync([process.argv[0], process.argv[1], ...ownArgs]);
  } catch (err) {
    // exitOverride turns --help / --version / parse failures into throws.
    if (err instanceof CommanderError) {
      if (err.code === "commander.helpDisplayed" || err.code === "commander.version") return ExitCode.Success;
      if (err.code === "commander.help") return ExitCode.Success;
      if (err.message) process.stderr.write(`${err.message}\n`);
      return err.exitCode || ExitCode.Usage;
    }
    throw err;
  }

  return exitCode;
}

main()
  .then((code) => {
    // Set exitCode rather than calling process.exit() so buffered stdout is
    // flushed. `process.exit` truncates output when stdout is a pipe, which is
    // exactly how `costcatch --json … | jq` is used.
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`costcatch: ${message}\n`);
    if (process.env.COSTCATCH_DEBUG && err instanceof Error && err.stack) {
      process.stderr.write(`${err.stack}\n`);
    }
    process.exitCode = ExitCode.Internal;
  });
