/**
 * `costcatch watch` command.
 *
 * A traced run that always saves. On an interactive terminal `run` already
 * renders the live in-place trace (spinners, ticking timers, animated header),
 * so `watch` is `run --save` with saving guaranteed on.
 */

import { runCommand } from "./run.js";
import type { RunFlags } from "../types/config.js";

export async function watchCommand(
  userCommand: string[],
  flags: Partial<RunFlags>,
): Promise<number> {
  return runCommand(userCommand, {
    ...flags,
    save: true,
    cost: flags.cost !== false,
    json: false,
    noColor: flags.noColor ?? false,
    quiet: false,
    inspect: flags.inspect ?? false,
    compareLast: flags.compareLast ?? false,
  });
}
