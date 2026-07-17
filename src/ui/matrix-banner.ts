// Draws the splash screen for `costcatch init`.

import chalk from "chalk";
import { palette, glyph, dim, labelRule, visibleLength, noColorChalk } from "./theme.js";
import { getVersion } from "../core/version.js";

async function renderWordmarkArt(useColor = true): Promise<void> {
  try {
    // cfonts is about 1 MB, so it's imported here to keep other commands from loading it.
    const { default: CFonts } = await import("cfonts");
    CFonts.say("COSTCATCH", {
      font: "block",
      align: "left",
      // cfonts writes its own color codes, so --no-color has to be passed to it too.
      colors: useColor ? ["white"] : ["candy"],
      background: "transparent",
      space: false,
      letterSpacing: 0,
      ...(useColor ? {} : { env: "node", colors: ["system"] }),
    });
  } catch {
    const paint = useColor ? chalk : noColorChalk();
    console.log(paint.white.bold("\n  costcatch"));
  }
}

export async function renderSplash(useColor = true): Promise<void> {
  await renderWordmarkArt(useColor);

  const width = Math.min(process.stdout.columns || 88, 88);
  // chalk.hex() writes color codes even when color is off, so use a no-color instance.
  const paint = useColor ? chalk : noColorChalk();
  const f = paint.hex(palette.faint);

  console.log();

  const leftWidth = 30;
  const rightWidth = Math.max(24, width - leftWidth - 7);

  const topRule =
    glyph.tl + glyph.h.repeat(leftWidth + 2) + glyph.tj + glyph.h.repeat(rightWidth + 2) + glyph.tr;
  console.log(labelRule(topRule, `v${getVersion()}`));

  const leftLines = [
    "",
    paint.white.bold("About"),
    dim("Zero-instrumentation LLM"),
    dim("agent tracer & cost tracker."),
    dim("Like `time`, for AI agents."),
    "",
    paint.white.bold("Features"),
    dim("· live trace in the terminal"),
    dim("· per-call cost tracking"),
    dim("· prompt cost estimation"),
    dim("· auto-diff between runs"),
    dim("· CI assertion gates"),
    dim("· secret & PII redaction"),
    "",
  ];

  const rightLines = [
    "",
    paint.white.bold("Commands"),
    `  ${paint.white("run")}          ${dim("trace a script (default)")}`,
    `  ${paint.white("estimate")}     ${dim("estimate prompt token cost")}`,
    `  ${paint.white("show")}         ${dim("inspect conversation content")}`,
    `  ${paint.white("diff")}         ${dim("compare two saved traces")}`,
    `  ${paint.white("stats")}        ${dim("aggregated analytics")}`,
    `  ${paint.white("replay")}       ${dim("re-display a saved trace")}`,
    `  ${paint.white("watch")}        ${dim("run, always saved")}`,
    `  ${paint.white("clean")}        ${dim("prune old saved traces")}`,
    `  ${paint.white("init")}         ${dim("setup & fetch pricing")}`,
    "",
    paint.white.bold("Quick Start"),
    // Use python3, because macOS doesn't ship a python command.
    dim("$ costcatch python3 agent.py"),
    dim("$ costcatch node agent.mjs"),
    "",
  ];

  const maxLines = Math.max(leftLines.length, rightLines.length);
  while (leftLines.length < maxLines) leftLines.push("");
  while (rightLines.length < maxLines) rightLines.push("");

  for (let i = 0; i < maxLines; i++) {
    const left = leftLines[i] || "";
    const right = rightLines[i] || "";
    // Use visibleLength, because .length counts color codes and gets wide characters wrong.
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
