/**
 * `costcatch diff` command.
 *
 * Compare two saved traces side by side.
 */

import chalk from "chalk";
import { loadTrace, listTraces } from "../storage/load.js";
import { diffTraces } from "../core/diff-engine.js";
import { renderDiff } from "../renderers/diff.js";
import { ExitCode } from "./exit-codes.js";

/**
 * @param file1 - Path to the "before" trace.
 * @param file2 - Path to the "after" trace.
 */
export async function diffCommand(
  file1: string | undefined,
  file2: string | undefined,
  options: { noColor?: boolean },
): Promise<number> {
  const useColor = !options.noColor && !process.env.NO_COLOR;

  let f1 = file1;
  let f2 = file2;
  if (!f1 || !f2) {
    const traces = listTraces(process.cwd());
    if (traces.length >= 2) {
      f1 = traces[1]; // previous run (before)
      f2 = traces[0]; // latest run (after)
    } else if (traces.length === 1) {
      f1 = traces[0];
      f2 = traces[0];
    } else {
      console.error(chalk.yellow("No saved traces found in .costcatch/. Run `costcatch --save <command>` first."));
      return ExitCode.Usage;
    }
  }

  try {
    const before = loadTrace(f1);
    const after = loadTrace(f2);
    console.log(renderDiff(diffTraces(before, after), useColor));
    return ExitCode.Success;
  } catch (err) {
    console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
    return ExitCode.Usage;
  }
}
