/**
 * `costcatch replay` command.
 *
 * Re-display a previously saved trace.
 */

import chalk from "chalk";
import { loadTrace, listTraces } from "../storage/load.js";
import { renderTree } from "../renderers/tree.js";
import { renderJson } from "../renderers/json.js";
import { ExitCode } from "./exit-codes.js";

export async function replayCommand(
  filepath: string | undefined,
  options: { json?: boolean; cost?: boolean; noColor?: boolean },
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

  if (options.json) {
    console.log(renderJson(trace));
  } else {
    console.log(renderTree(trace, options.cost ?? true, useColor));
  }
  return ExitCode.Success;
}
