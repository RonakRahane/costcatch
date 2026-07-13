// `costcatch stats` summarizes the newest saved traces.

import chalk from "chalk";
import { loadAllTraces } from "../storage/load.js";
import { renderStats, computeStats } from "../renderers/stats.js";
import { renderJson } from "../renderers/json.js";
import type { StatsFlags } from "../types/config.js";
import { ExitCode } from "./exit-codes.js";

const MAX_TRACES = 2_000;

export async function statsCommand(flags: StatsFlags & { noColor?: boolean; json?: boolean }): Promise<number> {
  const useColor = !flags.noColor && !process.env.NO_COLOR;

  const traces = loadAllTraces(process.cwd(), MAX_TRACES);
  const filter = { today: flags.today, week: flags.week, script: flags.script, model: flags.model };

  if (flags.json) {
    console.log(renderJson(computeStats(traces, filter)));
    return ExitCode.Success;
  }

  if (traces.length === 0) {
    console.log(chalk.dim("\n  No saved traces found in .costcatch/"));
    console.log(chalk.dim("  Run costcatch with --save to start collecting data.\n"));
    return ExitCode.Success;
  }

  console.log(renderStats(traces, filter, useColor));
  return ExitCode.Success;
}
