// Loads the trace a `show` or `replay` argument names, or the newest saved trace.

import chalk from "chalk";
import { loadTrace, listTraces } from "../storage/load.js";
import type { Trace } from "../types/trace.js";

export const NO_SAVED_TRACES = "No saved traces found in .costcatch/. Run `costcatch --save <command>` first.";

// Returns null after printing the reason, so callers should not print another error.
export function loadTraceArg(filepath: string | undefined): Trace | null {
  const targetPath = filepath || listTraces(process.cwd())[0];
  if (!targetPath) {
    console.error(chalk.yellow(NO_SAVED_TRACES));
    return null;
  }

  try {
    return loadTrace(targetPath);
  } catch (err) {
    console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
    return null;
  }
}
