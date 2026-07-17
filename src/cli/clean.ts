// `costcatch clean` deletes saved traces by count (--keep) or age (--older-than).

import * as fs from "node:fs";
import * as path from "node:path";
import { listTraces } from "../storage/load.js";
import { boxed, dim, glyph, notice, c, faint } from "../ui/theme.js";
import { ExitCode } from "./exit-codes.js";

export interface CleanFlags {
  keep?: number;
  olderThanDays?: number;
  dryRun?: boolean;
}

export async function cleanCommand(flags: CleanFlags): Promise<number> {
  if (flags.keep === undefined && flags.olderThanDays === undefined) {
    console.error(
      notice("err", "Nothing to do: pass --keep <n> and/or --older-than <days>.", [
        "costcatch clean --keep 50           keep the 50 newest traces",
        "costcatch clean --older-than 30     delete traces older than 30 days",
        "add --dry-run to preview without deleting",
      ]),
    );
    return ExitCode.Usage;
  }

  // In $HOME, .costcatch/ also holds the pricing cache, which a clean must not delete.
  const files = listTraces(process.cwd()) // newest first
    .filter((f) => path.basename(f) !== "pricing.json");
  if (files.length === 0) {
    console.log(notice("ok", "No saved traces in .costcatch/ — nothing to clean."));
    return ExitCode.Success;
  }

  const olderThan = (file: string, days: number): boolean => {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    try {
      return fs.statSync(file).mtimeMs < cutoff;
    } catch {
      return false;
    }
  };

  const protectedCount = flags.keep ?? 0;
  const candidates = files.slice(protectedCount);
  const toDelete = new Set<string>(
    flags.olderThanDays === undefined
      ? candidates
      : candidates.filter((f) => olderThan(f, flags.olderThanDays as number)),
  );

  if (toDelete.size === 0) {
    console.log(notice("ok", `All ${files.length} traces match the retention rules — nothing to delete.`));
    return ExitCode.Success;
  }

  if (flags.dryRun) {
    console.log(
      boxed({
        rows: [
          faint("── ") + dim("would delete"),
          ...[...toDelete].map((f) => `  ${dim(path.basename(f))}`),
        ],
        headerRight: dim(`clean ${glyph.dot} dry run`),
        footer: dim(
          `${toDelete.size} of ${files.length} traces would be deleted ${glyph.dot} nothing was removed`,
        ),
      }),
    );
    return ExitCode.Success;
  }

  const rows: string[] = [faint("── ") + dim("deleted")];
  let deleted = 0;
  for (const file of toDelete) {
    try {
      fs.unlinkSync(file);
      deleted++;
      rows.push(`  ${dim(path.basename(file))}`);
    } catch (err) {
      rows.push(
        `  ${c("err", glyph.err)} ${c("err", path.basename(file))} ${dim(err instanceof Error ? err.message : String(err))}`,
      );
    }
  }

  console.log(
    boxed({
      rows,
      headerRight: dim(`clean ${glyph.dot} ${deleted} deleted`),
      footer: `${c("ok", glyph.ok)} ${dim(`${deleted} of ${files.length} traces deleted ${glyph.dot} ${files.length - deleted} kept`)}`,
    }),
  );
  return ExitCode.Success;
}
