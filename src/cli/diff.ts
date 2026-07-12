// `costcatch diff` compares two saved traces, by default the newest and the previous run of its script.

import chalk from "chalk";
import * as path from "node:path";
import { loadTrace, listTraces } from "../storage/load.js";
import { diffTraces } from "../core/diff-engine.js";
import { renderDiff } from "../renderers/diff.js";
import { renderJson } from "../renderers/json.js";
import { ExitCode } from "./exit-codes.js";
import { NO_SAVED_TRACES } from "./trace-arg.js";

export async function diffCommand(
  file1: string | undefined,
  file2: string | undefined,
  options: { noColor?: boolean; json?: boolean },
): Promise<number> {
  const useColor = !options.noColor && !process.env.NO_COLOR;

  let f1 = file1;
  let f2 = file2;

  if (f1 && !f2) {
    const traces = listTraces(process.cwd());
    const idx = traces.findIndex((t) => path.resolve(t) === path.resolve(f1 as string));
    if (idx >= 0 && idx + 1 < traces.length) {
      f2 = f1;
      f1 = traces[idx + 1];
    } else {
      console.error(
        chalk.yellow(`No earlier saved trace to compare ${f1} against. Pass two files to diff explicitly.`),
      );
      return ExitCode.Usage;
    }
  }

  if (!f1 || !f2) {
    const traces = listTraces(process.cwd());
    if (traces.length >= 2) {
      const latest = traces[0];
      let script: string | null = null;
      try {
        script = loadTrace(latest).script;
      } catch {
      }

      let partner: string | undefined;
      if (script !== null) {
        for (const candidate of traces.slice(1)) {
          try {
            if (loadTrace(candidate).script === script) {
              partner = candidate;
              break;
            }
          } catch {
          }
        }
      }

      if (partner) {
        f1 = partner;
        f2 = latest;
      } else {
        f1 = traces[1];
        f2 = latest;
        console.error(
          chalk.yellow(
            `Note: only one saved run of ${script ?? "the latest script"} exists, so this diff compares different scripts.`,
          ),
        );
      }
    } else if (traces.length === 1) {
      console.error(chalk.yellow("Only one saved trace in .costcatch/, so there is nothing to compare it with. Save another run, or pass two files."));
      return ExitCode.Usage;
    } else {
      console.error(chalk.yellow(NO_SAVED_TRACES));
      return ExitCode.Usage;
    }
  }

  try {
    const before = loadTrace(f1);
    const after = loadTrace(f2);
    const diff = diffTraces(before, after);
    if (options.json) {
      console.log(renderJson(diff));
    } else {
      console.log(renderDiff(diff, useColor));
    }
    return ExitCode.Success;
  } catch (err) {
    console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
    return ExitCode.Usage;
  }
}
