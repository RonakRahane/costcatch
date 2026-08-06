/**
 * `costcatch init` command.
 *
 * Renders the splash, creates the `.costcatch/` directory (and gitignores it),
 * and refreshes the local pricing database.
 */

import ora from "ora";
import chalk from "chalk";
import { initTracesDir } from "../storage/index.js";
import { fetchLatestPricing } from "../pricing/fetch-prices.js";
import { getPricingInfo, resetPricingDb } from "../pricing/pricing-db.js";
import { renderSplash } from "../ui/matrix-banner.js";
import { dim } from "../ui/theme.js";
import { ExitCode } from "./exit-codes.js";

export interface InitFlags {
  /** Skip the pricing download entirely. */
  offline: boolean;
}

export async function initCommand(flags: InitFlags = { offline: false }): Promise<number> {
  const cwd = process.cwd();

  await renderSplash();

  let tracesDir: string;
  try {
    tracesDir = initTracesDir(cwd);
  } catch (err) {
    console.error(chalk.red(`  ✗ could not create .costcatch/: ${err instanceof Error ? err.message : String(err)}`));
    return ExitCode.Internal;
  }

  console.log(`  ${chalk.white("✓")} created ${chalk.white.bold(".costcatch/")} ${dim(`(${tracesDir})`)}`);
  console.log(`  ${chalk.white("✓")} added ${chalk.white.bold(".costcatch/")} to ${dim(".gitignore")}`);
  console.log();

  if (flags.offline) {
    console.log(`  ${chalk.white("·")} ${dim("--offline: skipped pricing download, using bundled prices")}`);
  } else {
    // A spinner on a non-TTY writes control codes into CI logs; ora's own
    // isEnabled check handles that, but be explicit about the stream.
    const spinner = ora({ text: dim("fetching latest model pricing…"), color: "white", stream: process.stderr }).start();
    const ok = await fetchLatestPricing();
    resetPricingDb();
    if (ok) {
      const { models } = getPricingInfo();
      spinner.succeed(chalk.white(`fetched latest pricing (${models.toLocaleString()} models)`));
    } else {
      spinner.warn(dim("couldn't fetch pricing (offline?) — using bundled prices"));
    }
  }
  console.log();

  console.log(dim("  ready. run `costcatch --help` to see all commands."));
  console.log();
  return ExitCode.Success;
}
