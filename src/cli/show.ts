/**
 * `costcatch show` command.
 *
 * Read the actual conversation content of any saved step. Supports `--step N`
 * to focus on one call, and `--grep` to search across all steps.
 *
 * Backward-compatible: traces saved before content capture show a helpful note
 * instead of crashing.
 */

import chalk from "chalk";
import { loadTrace, listTraces } from "../storage/load.js";
import { renderShow, type ShowOptions } from "../renderers/show.js";
import { ExitCode } from "./exit-codes.js";

export async function showCommand(
  filepath: string | undefined,
  options: { step?: number; grep?: string; noColor?: boolean },
): Promise<number> {
  const useColor = !options.noColor && !process.env.NO_COLOR;

  let targetPath = filepath;
  if (!targetPath) {
    const traces = listTraces(process.cwd());
    if (traces.length > 0) {
      targetPath = traces[0];
    } else {
      console.error(chalk.yellow("No saved traces found in .costcatch/. Run `costcatch --save <command>` first."));
      return ExitCode.Usage;
    }
  }

  let trace;
  try {
    trace = loadTrace(targetPath);
  } catch (err) {
    console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
    return ExitCode.Usage;
  }

  const showOpts: ShowOptions = {
    step: options.step ?? null,
    grep: options.grep ?? null,
    useColor,
  };

  console.log(renderShow(trace, showOpts));
  return ExitCode.Success;
}
