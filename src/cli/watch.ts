// `costcatch watch` is `run` with saving always on.

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
