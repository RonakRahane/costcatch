// CLI entry point. Splits argv between costcatch and the wrapped program, then runs commander.

import { Command, CommanderError, Option } from "commander";
import { runCommand } from "./cli/run.js";
import { replayCommand } from "./cli/replay.js";
import { diffCommand } from "./cli/diff.js";
import { statsCommand } from "./cli/stats.js";
import { watchCommand } from "./cli/watch.js";
import { initCommand } from "./cli/init.js";
import { showCommand } from "./cli/show.js";
import { estimateCommand } from "./cli/estimate.js";
import { cleanCommand } from "./cli/clean.js";
import { firstProgramToken, splitInvocation } from "./core/runtime-detect.js";
import { getVersion } from "./core/version.js";
import { ExitCode } from "./cli/exit-codes.js";
import { setColorEnabled } from "./ui/theme.js";

const NON_WRAPPING_COMMANDS = new Set([
  "show",
  "estimate",
  "replay",
  "diff",
  "stats",
  "init",
  "clean",
  "help",
]);

// Number() reads "" as 0 and "0x10" as 16, so an unset `--keep "$KEEP"` would delete every trace.
const DECIMAL = /^\s*(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\s*$/i;

function numberOption(name: string, min: number, { integer = false } = {}) {
  const kind = integer ? "a whole number" : "a number";
  return (value: string): number => {
    const parsed = DECIMAL.test(value) ? Number(value) : Number.NaN;
    if (!Number.isFinite(parsed) || parsed < min || (integer && !Number.isInteger(parsed))) {
      throw new CommanderError(
        ExitCode.Usage,
        "costcatch.invalidArgument",
        `error: option '${name}' expects ${kind} >= ${min}, got '${value}'`,
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
  .exitOverride();

function withSharedTraceOptions(cmd: Command): Command {
  return cmd
    .option("--save-as <name>", "Save with a specific name")
    .option("--no-cost", "Hide the per-step cost breakdown")
    .option("--no-color", "Plain text output (for CI)")
    .option("--filter <provider>", "Only show calls to a specific provider")
    .option("--threshold <ms>", "Warn on LLM calls slower than N ms", numberOption("--threshold", 1))
    .option("--no-redact", "Keep PII (emails/phones/cards) in captured content; secrets are always redacted")
    .option("--inspect", "After the run, show full conversation content for each step", false)
    .option("--compare-last", "Auto-diff against the most recent saved trace for this script", false)
    .option("--max-cost <usd>", "CI gate: non-zero exit if total cost exceeds N USD", numberOption("--max-cost", 0))
    .option("--max-calls <n>", "CI gate: non-zero exit if LLM call count exceeds N", numberOption("--max-calls", 0, { integer: true }))
    .option(
      "--max-errors <n>",
      "CI gate: non-zero exit if failed LLM calls plus failed tool calls exceed N",
      numberOption("--max-errors", 0, { integer: true }),
    )
    .option("--budget <usd>", "Mid-run guard: terminate the program once spend exceeds N USD", numberOption("--budget", 0));
}

function withTraceOptions(cmd: Command): Command {
  return withSharedTraceOptions(
    cmd
      .option("--save", "Save trace to .costcatch/", false)
      .option("--json", "Output raw JSON instead of the tree", false)
      .option("--quiet", "Only show summary, not full tree", false),
  );
}

const runCmd = withTraceOptions(
  program
    .command("run", { isDefault: true })
    .description("Trace a script (default command; `run` is optional)")
    .argument("[command...]", "The program to trace, e.g. `python agent.py`"),
);

runCmd.addHelpText(
  "after",
  `
Examples:
  $ costcatch python3 agent.py
  $ costcatch --save --max-cost 0.50 python3 agent.py
  $ costcatch -- python3 agent.py --json    # '--' passes --json to YOUR program
`,
);

runCmd.action(async (commandArgs: string[], options) => {
  const userCommand = tracedCommand(commandArgs);

  if (userCommand.length === 0) {
    console.error("Error: No command specified.");
    console.error("Usage: costcatch python3 my_agent.py [args...]");
    console.error("       costcatch node my_agent.js [args...]");
    console.error("       costcatch -- <any command> [args...]");
    exitCode = ExitCode.Usage;
    return;
  }

  exitCode = await runCommand(userCommand, {
    save: options.save ?? false,
    saveAs: options.saveAs,
    cost: options.cost !== false,
    json: options.json ?? false,
    noColor: options.color === false,
    filter: options.filter,
    threshold: options.threshold,
    quiet: options.quiet ?? false,
    redact: options.redact !== false,
    inspect: options.inspect ?? false,
    compareLast: options.compareLast ?? false,
    maxCost: options.maxCost,
    maxCalls: options.maxCalls,
    maxErrors: options.maxErrors,
    budget: options.budget,
  });
});

program
  .command("show [file]")
  .description("Inspect the full conversation content of a saved trace (defaults to latest)")
  .option("--step <n>", "Show only step N (1-indexed)", numberOption("--step", 1, { integer: true }))
  .option("--grep <term>", "Search for a string across all steps")
  .option("--no-color", "Plain text output")
  .action(async (file, options) => {
    exitCode = await showCommand(file, {
      step: options.step,
      grep: options.grep,
      noColor: options.color === false,
    });
  });

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

program
  .command("diff [file1] [file2]")
  .description("Compare two saved traces side by side (defaults to last 2 runs)")
  .option("--json", "Machine-readable output", false)
  .option("--no-color", "Plain text output")
  .action(async (file1, file2, options) => {
    exitCode = await diffCommand(file1, file2, { noColor: options.color === false, json: options.json ?? false });
  });

program
  .command("stats")
  .description("Show aggregated analytics across saved traces")
  .option("--today", "Show stats for today only", false)
  .option("--week", "Show stats for the last 7 days", false)
  .option("--script <name>", "Filter by script name")
  .option("--model <name>", "Filter by model name")
  .option("--json", "Machine-readable output", false)
  .option("--no-color", "Plain text output")
  .action(async (options) => {
    exitCode = await statsCommand({
      today: options.today,
      week: options.week,
      script: options.script,
      model: options.model,
      noColor: options.color === false,
      json: options.json ?? false,
    });
  });

const watchCmd = withSharedTraceOptions(
  program
    .command("watch")
    .description("Traced run that always saves, with the live view on")
    .argument("[command...]", "The program to trace"),
);
watchCmd.addOption(new Option("--save", "watch always saves; accepted for compatibility").hideHelp());
watchCmd.addOption(new Option("--json", "ignored by watch; accepted for compatibility").hideHelp());
watchCmd.addOption(new Option("--quiet", "ignored by watch; accepted for compatibility").hideHelp());
watchCmd.action(async (commandArgs: string[], options) => {
  const userCommand = tracedCommand(commandArgs);

  if (userCommand.length === 0) {
    console.error("Error: No command specified.");
    console.error("Usage: costcatch watch python my_agent.py");
    exitCode = ExitCode.Usage;
    return;
  }

  exitCode = await watchCommand(userCommand, {
    noColor: options.color === false,
    // Pass every shared flag on, or watch accepts it and quietly ignores it.
    redact: options.redact !== false,
    cost: options.cost !== false,
    filter: options.filter,
    threshold: options.threshold,
    maxCost: options.maxCost,
    maxCalls: options.maxCalls,
    maxErrors: options.maxErrors,
    budget: options.budget,
    inspect: options.inspect ?? false,
    compareLast: options.compareLast ?? false,
    saveAs: options.saveAs,
  });
});

program
  .command("clean")
  .description("Delete old saved traces from .costcatch/")
  .option("--keep <n>", "Keep only the N newest traces", numberOption("--keep", 0, { integer: true }))
  // --older-than 0 would put the cutoff at now and delete every trace.
  .option("--older-than <days>", "Delete traces older than N days", numberOption("--older-than", 1))
  .option("--dry-run", "Preview what would be deleted without deleting", false)
  .option("--no-color", "Plain text output")
  .action(async (options) => {
    exitCode = await cleanCommand({
      keep: options.keep,
      olderThanDays: options.olderThan,
      dryRun: options.dryRun ?? false,
    });
  });

program
  .command("init")
  .description("Set up .costcatch/ and fetch the latest pricing database")
  .option("--offline", "Skip the pricing download and use bundled prices", false)
  .option("--no-color", "Plain text output")
  .action(async (options) => {
    exitCode = await initCommand({
      offline: options.offline ?? false,
      noColor: options.color === false,
    });
  });

let pendingUserCommand: string[] = [];

// A launcher like `poetry run` ends up in commander's variadic argument, so it goes first.
function tracedCommand(commandArgs: string[]): string[] {
  return [...commandArgs, ...pendingUserCommand];
}

let exitCode: number = ExitCode.Success;

function ownFlagNames(): Set<string> {
  const names = new Set<string>();
  for (const command of [runCmd, watchCmd]) {
    for (const option of command.options) {
      if (option.long) names.add(option.long);
      if (option.short) names.add(option.short);
    }
  }
  return names;
}

function ownValueFlags(): Set<string> {
  const names = new Set<string>();
  for (const command of [runCmd, watchCmd]) {
    for (const option of command.options) {
      if (!option.required && !option.optional) continue;
      if (option.long) names.add(option.long);
      if (option.short) names.add(option.short);
    }
  }
  return names;
}

function firstPositional(argv: string[], valueFlags: Set<string>): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--") return undefined;
    if (valueFlags.has(token)) {
      i++;
      continue;
    }
    if (!token.startsWith("-")) return token;
  }
  return undefined;
}

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
  const valueFlags = ownValueFlags();
  const first = firstPositional(argv, valueFlags);
  const hasTerminator = argv.includes("--");

  // Read --no-color from raw argv, because commander parses it too late for the theme helpers.
  setColorEnabled(!argv.includes("--no-color") && !process.env.NO_COLOR);

  let ownArgs = argv;
  if (first === undefined || !NON_WRAPPING_COMMANDS.has(first)) {
    let split = splitInvocation(argv, valueFlags);
    if (split.userCommand.length === 0) {
      // Hand the program over anyway, so `deno run --allow-net x.ts` reports deno as unsupported.
      const start = firstProgramToken(argv, valueFlags);
      if (start !== -1) split = { ownArgs: argv.slice(0, start), userCommand: argv.slice(start) };
    }
    ownArgs = split.ownArgs;
    pendingUserCommand = split.userCommand;

    if (!hasTerminator) warnAboutMisplacedFlags(pendingUserCommand);
  }

  try {
    await program.parseAsync([process.argv[0], process.argv[1], ...ownArgs]);
  } catch (err) {
    if (err instanceof CommanderError) {
      if (err.code === "commander.helpDisplayed" || err.code === "commander.version") return ExitCode.Success;
      if (err.code === "commander.help") return ExitCode.Success;
      // Commander has already printed its own errors, but not the ones numberOption throws.
      if (err.message && !err.code.startsWith("commander.")) process.stderr.write(`${err.message}\n`);
      // Commander would exit 1, which CI reads as a failed --max-cost gate.
      return ExitCode.Usage;
    }
    throw err;
  }

  return exitCode;
}

main()
  .then((code) => {
    // process.exit() can cut off buffered stdout in a pipe like `costcatch --json | jq`.
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
