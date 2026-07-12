// `costcatch replay` prints a saved trace again as a tree or JSON.

import { renderTree } from "../renderers/tree.js";
import { renderJson } from "../renderers/json.js";
import { ExitCode } from "./exit-codes.js";
import { loadTraceArg } from "./trace-arg.js";

export async function replayCommand(
  filepath: string | undefined,
  options: { json?: boolean; cost?: boolean; noColor?: boolean },
): Promise<number> {
  const useColor = !options.noColor && !process.env.NO_COLOR;

  const trace = loadTraceArg(filepath);
  if (!trace) return ExitCode.Usage;

  if (options.json) {
    console.log(renderJson(trace));
  } else {
    console.log(renderTree(trace, options.cost ?? true, useColor));
  }
  return ExitCode.Success;
}
