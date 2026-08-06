/**
 * CostCatch splash — the two-panel banner shown by `costcatch init`.
 *
 *   ┌────────────────────────────┬────────────────────────────────────────────┐
 *   │ About                      │ Commands                                   │
 *   │  ...                       │  run     trace an agent script             │
 *   └────────────────────────────┴────────────────────────────────────────────┘
 *
 * `cfonts` (the big ASCII wordmark) is imported DYNAMICALLY. It ships ~1 MB of
 * font tables, and `init` is the only command that renders it — a static import
 * here would pay that parse cost on every `costcatch run`, which is the one
 * command whose startup latency users actually feel.
 *
 * The header wordmark helpers (`wordmark`, `matrixReveal`) live in ui/theme.ts
 * for the same reason: renderers need them, but must not need cfonts.
 */

import chalk from "chalk";
import { palette, glyph, dim, visibleLength } from "./theme.js";
import { getVersion } from "../core/version.js";

/** Render the big ASCII wordmark, degrading to plain text if cfonts fails. */
async function renderWordmarkArt(): Promise<void> {
  try {
    const { default: CFonts } = await import("cfonts");
    CFonts.say("cost|catch", {
      font: "tiny",
      align: "left",
      colors: ["white"],
      background: "transparent",
      space: false,
      letterSpacing: 1,
    });
  } catch {
    // Missing optional font data or a non-TTY that cfonts dislikes — the splash
    // is decoration, so fall back rather than failing `init`.
    console.log(chalk.white.bold("\n  costcatch"));
  }
}

/**
 * The full splash — ASCII wordmark, version, then a split info/commands panel.
 */
export async function renderSplash(): Promise<void> {
  await renderWordmarkArt();

  const width = Math.min(process.stdout.columns || 88, 88);
  const f = chalk.hex(palette.faint);

  const versionText = dim(`v${getVersion()}`);
  console.log(" ".repeat(Math.max(0, Math.floor(width / 2) - 3)) + versionText);
  console.log();

  // Two-column split box. `leftWidth` is fixed; the right column absorbs the
  // remaining terminal width, with a floor so a narrow terminal still renders.
  const leftWidth = 30;
  const rightWidth = Math.max(24, width - leftWidth - 5); // 5 = borders + padding

  console.log(
    f(glyph.tl) + f(glyph.h.repeat(leftWidth + 2)) + f(glyph.tj) + f(glyph.h.repeat(rightWidth + 2)) + f(glyph.tr),
  );

  const leftLines = [
    "",
    chalk.white.bold("About"),
    dim("Zero-instrumentation LLM"),
    dim("agent tracer & cost tracker."),
    dim("Like `time`, for AI agents."),
    "",
    chalk.white.bold("Features"),
    dim("· live tracing dashboard"),
    dim("· per-call cost tracking"),
    dim("· prompt cost estimation"),
    dim("· auto-diff between runs"),
    dim("· CI assertion gates"),
    dim("· secret & PII redaction"),
    "",
  ];

  const rightLines = [
    "",
    chalk.white.bold("Commands"),
    `  ${chalk.white("run")}          ${dim("trace a script (default)")}`,
    `  ${chalk.white("estimate")}     ${dim("estimate prompt token cost")}`,
    `  ${chalk.white("show")}         ${dim("inspect conversation content")}`,
    `  ${chalk.white("diff")}         ${dim("compare two saved traces")}`,
    `  ${chalk.white("stats")}        ${dim("aggregated analytics")}`,
    `  ${chalk.white("replay")}       ${dim("re-display a saved trace")}`,
    `  ${chalk.white("watch")}        ${dim("live streaming view")}`,
    `  ${chalk.white("init")}         ${dim("setup & fetch pricing")}`,
    "",
    chalk.white.bold("Quick Start"),
    dim("$ costcatch python agent.py"),
    dim("$ costcatch estimate prompt.txt"),
    "",
  ];

  const maxLines = Math.max(leftLines.length, rightLines.length);
  while (leftLines.length < maxLines) leftLines.push("");
  while (rightLines.length < maxLines) rightLines.push("");

  for (let i = 0; i < maxLines; i++) {
    const left = leftLines[i] || "";
    const right = rightLines[i] || "";
    // `visibleLength` is ANSI-aware AND wide-glyph aware; the old local helper
    // only stripped SGR codes and counted code units, so the box drifted on any
    // line containing a wide character.
    const leftPad = Math.max(0, leftWidth - visibleLength(left));
    const rightPad = Math.max(0, rightWidth - visibleLength(right));

    console.log(
      f(glyph.v) + " " + left + " ".repeat(leftPad) + " " +
        f(glyph.v) + " " + right + " ".repeat(rightPad) + " " +
        f(glyph.v),
    );
  }

  console.log(
    f(glyph.bl) + f(glyph.h.repeat(leftWidth + 2)) + f(glyph.bj) + f(glyph.h.repeat(rightWidth + 2)) + f(glyph.br),
  );
  console.log();
}
