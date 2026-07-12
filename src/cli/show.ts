// `costcatch show` prints the conversation in a saved trace, filtered by --step or --grep.

import { renderShow, type ShowOptions } from "../renderers/show.js";
import { ExitCode } from "./exit-codes.js";
import { loadTraceArg } from "./trace-arg.js";

export async function showCommand(
  filepath: string | undefined,
  options: { step?: number; grep?: string; noColor?: boolean },
): Promise<number> {
  const useColor = !options.noColor && !process.env.NO_COLOR;

  const trace = loadTraceArg(filepath);
  if (!trace) return ExitCode.Usage;

  if (options.step !== undefined && !trace.steps.some((s) => s.type === "llm" && s.id === options.step)) {
    const count = trace.steps.filter((s) => s.type === "llm").length;
    console.error(`Step ${options.step} not found: this trace has ${count} LLM ${count === 1 ? "step" : "steps"}.`);
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
