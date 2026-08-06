/**
 * `costcatch stats` command.
 *
 * Show aggregated analytics across saved traces.
 */

import chalk from "chalk";
import { loadAllTraces } from "../storage/load.js";
import { renderStats } from "../renderers/stats.js";
import type { StatsFlags } from "../types/config.js";
import { ExitCode } from "./exit-codes.js";

/**
 * Cap on how many trace files `stats` reads in one pass.
 *
 * A long-lived project accumulates thousands of traces; parsing every one just
 * to print five leaderboards makes the command slower the longer you use the
 * tool. Traces are read newest-first, which is what the aggregates are about.
 */
const MAX_TRACES = 2_000;

export async function statsCommand(flags: StatsFlags & { noColor?: boolean }): Promise<number> {
  const useColor = !flags.noColor && !process.env.NO_COLOR;

  const traces = loadAllTraces(process.cwd(), MAX_TRACES);

  if (traces.length === 0) {
    console.log(chalk.dim("\n  No saved traces found in .costcatch/"));
    console.log(chalk.dim("  Run costcatch with --save to start collecting data.\n"));
    return ExitCode.Success;
  }

  console.log(
    renderStats(
      traces,
      { today: flags.today, week: flags.week, script: flags.script, model: flags.model },
      useColor,
    ),
  );
  return ExitCode.Success;
}
