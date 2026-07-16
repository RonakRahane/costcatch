/**
 * CostCatch banner — ASCII art wordmark and init splash.
 *
 * The splash renders a two-panel Feynman-style layout:
 *   ┌─────────────────────────────────────────────────────────────────────────┐
 *   │                        costcatch                                       │
 *   │                          v0.1.0                                        │
 *   ├────────────────────────────┬────────────────────────────────────────────┤
 *   │ About                     │ Commands                                  │
 *   │  ...                      │  run     trace an agent script            │
 *   │                           │  ...                                      │
 *   └────────────────────────────┴────────────────────────────────────────────┘
 */

import chalk from "chalk";
import CFonts from "cfonts";
import { palette, glyph, dim } from "./theme.js";

/** Glyphs the "un-settled" columns cycle through before landing. */
const MATRIX_GLYPHS = "▁▂▃▄▅▆▇█░▒▓╌╍┄┅";

/**
 * Deterministic pseudo-random in [0,1) from two integers.
 */
function rand(a: number, b: number): number {
  const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Reveal `target` left-to-right with a dot-matrix shimmer.
 */
export function matrixReveal(target: string, tick: number, revealTicks: number = 14): string {
  if (tick >= revealTicks) return chalk.white.bold(target);

  let out = "";
  for (let i = 0; i < target.length; i++) {
    const ch = target[i];
    if (ch === " ") {
      out += " ";
      continue;
    }
    const threshold = (i / target.length) * revealTicks;
    if (tick >= threshold) {
      out += chalk.white(ch);
    } else {
      const g = MATRIX_GLYPHS[Math.floor(rand(i, tick) * MATRIX_GLYPHS.length)];
      const near = tick / Math.max(threshold, 1);
      out += chalk.hex(near > 0.6 ? "#aaaaaa" : palette.faint)(g);
    }
  }
  return out;
}

/** The static one-line wordmark used in headers. */
export function wordmark(): string {
  return chalk.white.bold("costcatch");
}

/**
 * The full splash — Feynman-style two-column panel.
 *
 * Shows the big ASCII wordmark, version, then a split box with
 * tool info on the left and command reference on the right.
 */
export function renderSplash(): void {
  // ── Big ASCII wordmark ──
  CFonts.say("cost|catch", {
    font: "tiny",
    align: "left",
    colors: ["white"],
    background: "transparent",
    space: false,
    letterSpacing: 1,
  });

  const version = process.env.COSTCATCH_VERSION ?? "0.1.0";
  const width = Math.min(process.stdout.columns || 88, 88);
  const f = chalk.hex(palette.faint);

  // Version line
  const versionText = dim(`v${version}`);
  const vPad = Math.max(0, Math.floor(width / 2) - 3);
  console.log(" ".repeat(vPad) + versionText);
  console.log();

  // ── Two-column split box ──
  const leftWidth = 30;
  const rightWidth = width - leftWidth - 5; // 5 = │ borders + padding

  // Top border
  console.log(
    f(glyph.tl) + f(glyph.h.repeat(leftWidth + 2)) + f(glyph.tj) + f(glyph.h.repeat(rightWidth + 2)) + f(glyph.tr),
  );

  // Left column content
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

  // Right column content
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

  // Normalize to same height
  const maxLines = Math.max(leftLines.length, rightLines.length);
  while (leftLines.length < maxLines) leftLines.push("");
  while (rightLines.length < maxLines) rightLines.push("");

  // Render rows
  for (let i = 0; i < maxLines; i++) {
    const left = leftLines[i];
    const right = rightLines[i];
    const leftVis = left ? stringWidthLocal(left) : 0;
    const rightVis = right ? stringWidthLocal(right) : 0;
    const leftPad = Math.max(0, leftWidth - leftVis);
    const rightPad = Math.max(0, rightWidth - rightVis);

    console.log(
      f(glyph.v) + " " + (left || "") + " ".repeat(leftPad) + " " +
      f(glyph.v) + " " + (right || "") + " ".repeat(rightPad) + " " +
      f(glyph.v),
    );
  }

  // Bottom border
  console.log(
    f(glyph.bl) + f(glyph.h.repeat(leftWidth + 2)) + f(glyph.bj) + f(glyph.h.repeat(rightWidth + 2)) + f(glyph.br),
  );

  console.log();
}

/**
 * Local string-width helper to avoid importing from theme
 * (prevents circular dependency issues).
 */
function stringWidthLocal(s: string): number {
  // Strip ANSI escape codes and count visible characters
  // eslint-disable-next-line no-control-regex
  const stripped = s.replace(/\x1b\[[0-9;]*m/g, "");
  return stripped.length;
}
