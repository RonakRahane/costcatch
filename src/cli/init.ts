// `costcatch init` creates .costcatch/ and downloads current prices unless --offline is set.

import ora from "ora";
import chalk from "chalk";
import { initTracesDir } from "../storage/index.js";
import { fetchLatestPricing } from "../pricing/fetch-prices.js";
import { getPricingInfo, pricingCachePath, resetPricingDb } from "../pricing/pricing-db.js";
import { renderSplash } from "../ui/matrix-banner.js";
import { noColorChalk, dim, boxed, glyph } from "../ui/theme.js";
import { ExitCode } from "./exit-codes.js";

export interface InitFlags {
  offline: boolean;
  noColor?: boolean;
}

export async function initCommand(flags: InitFlags = { offline: false }): Promise<number> {
  const cwd = process.cwd();
  const useColor = !flags.noColor && !process.env.NO_COLOR;
  const c = useColor ? chalk : noColorChalk();

  await renderSplash(useColor);

  let traces: ReturnType<typeof initTracesDir>;
  try {
    traces = initTracesDir(cwd);
  } catch (err) {
    console.error(c.red(`  ✗ could not create .costcatch/: ${err instanceof Error ? err.message : String(err)}`));
    return ExitCode.Internal;
  }

  // Report the .gitignore result truthfully, or traces full of prompts can get committed.
  const gitignoreRow = {
    added: `${c.white("✓")} added ${c.white.bold(".costcatch/")} to ${dim(".gitignore")}`,
    present: `${c.white("✓")} ${c.white.bold(".costcatch/")} ${dim("is already in .gitignore")}`,
    failed: `${c.white(glyph.warn)} ${dim("could not update .gitignore: add .costcatch/ to it yourself, traces hold prompts")}`,
  }[traces.gitignore];
  const rows: string[] = [`${c.white("✓")} created ${c.white.bold(".costcatch/")} ${dim(`(${traces.dir})`)}`, gitignoreRow];

  let exitCode: number = ExitCode.Success;
  if (flags.offline) {
    rows.push(`${c.white("·")} ${dim("--offline: skipped pricing download, using bundled prices")}`);
  } else {
    const spinner = ora({ text: dim("fetching latest model pricing…"), color: "white", stream: process.stderr }).start();
    const result = await fetchLatestPricing();
    resetPricingDb();
    spinner.stop();
    if (result === "saved") {
      const { models } = getPricingInfo();
      rows.push(`${c.white("✓")} fetched latest pricing ${dim(`(${models.toLocaleString()} models)`)}`);
    } else if (result === "unwritable") {
      rows.push(`${c.white("✗")} ${dim(`fetched pricing but could not write ${pricingCachePath()}; runs keep using bundled prices`)}`);
      exitCode = ExitCode.Internal;
    } else {
      rows.push(`${c.white(glyph.warn)} ${dim("couldn't fetch pricing (offline?), using bundled prices")}`);
    }
  }

  console.log(
    boxed({
      rows,
      headerRight: dim("init"),
      footer: dim("ready · run `costcatch --help` to see all commands"),
    }),
  );
  return exitCode;
}
