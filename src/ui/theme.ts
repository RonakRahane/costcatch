/**
 * Visual theme — the single source of truth for CostCatch's look.
 *
 * Design language: clean black-and-white, monochrome terminal aesthetic.
 * Square borders, generous spacing, high contrast. Every color role lives
 * here so the whole tool stays visually coherent.
 */

import chalk from "chalk";
import stringWidth from "string-width";

// ---------------------------------------------------------------------------
// Palette — monochrome black & white
// ---------------------------------------------------------------------------

/**
 * Raw hex values, by semantic role.
 *
 * Professional dark-mode palette inspired by Claude Code's terminal UI:
 * subtle blue-cyan accents, green success, amber costs, muted purple tokens.
 */
export const palette = {
  text: "#e8eaed",     // soft white — primary text (easy on the eyes)
  dim: "#8b8f96",      // cool gray — secondary text
  faint: "#4a4e54",    // dark gray — borders, connectors
  accent: "#7cacf8",   // soft blue — accents, step numbers
  accent2: "#a78bfa",  // muted purple — spinners, secondary accents
  ok: "#6bcb77",       // soft green — success badges
  warn: "#f7c948",     // warm amber — warnings, tool calls
  err: "#f87171",      // soft red — errors
  cost: "#fbbf24",     // golden amber — money (draws the eye)
  token: "#a78bfa",    // muted purple — token counts
} as const;

export type ColorRole = keyof typeof palette;

/** Whether truecolor/ANSI output is appropriate for the current stream. */
export function colorEnabled(): boolean {
  if (process.env.NO_COLOR) return false;
  return chalk.level > 0;
}

/** Color a string by semantic role. */
export function c(role: ColorRole, s: string): string {
  return chalk.hex(palette[role])(s);
}

/** Bold + colored by role. */
export function cb(role: ColorRole, s: string): string {
  return chalk.hex(palette[role]).bold(s);
}

/** Plain dim helper. */
export function dim(s: string): string {
  return chalk.hex(palette.dim)(s);
}

export function faint(s: string): string {
  return chalk.hex(palette.faint)(s);
}

// ---------------------------------------------------------------------------
// Glyphs — square box-drawing + status
// ---------------------------------------------------------------------------

/** Box-drawing + status glyphs. Square borders for the clean look. */
export const glyph = {
  // square box
  tl: "┌",
  tr: "┐",
  bl: "└",
  br: "┘",
  h: "─",
  v: "│",
  // junction (for split panels)
  tj: "┬",
  bj: "┴",
  mj: "┼",
  ml: "├",
  mr: "┤",
  // tree connectors
  branch: "├─",
  leaf: "└─",
  pipe: "│ ",
  // status
  ok: "✓",
  warn: "⚠",
  err: "✗",
  dot: "·",
  bullet: "●",
  arrow: "→",
  flow: "⇢",
  bolt: "⚡",
  clock: "⧗",
  cache: "♻",
  spark: "✦",
} as const;

/** Braille spinner frames — smooth, low-noise. */
export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Return the spinner frame for a given tick. */
export function spinnerFrame(tick: number): string {
  return SPINNER[tick % SPINNER.length];
}

/** Circled step numbers 1–20, then falls back to "(n)". */
// const CIRCLED = [
//   "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩",
//   "⑪", "⑫", "⑬", "⑭", "⑮", "⑯", "⑰", "⑱", "⑲", "⑳",
// ];

export function stepNumber(id: number): string {
  return `▶ Step ${id}`;
}

// ---------------------------------------------------------------------------
// Wordmark
//
// These live here rather than in ui/matrix-banner.ts because every renderer
// needs them, and matrix-banner pulls in `cfonts` (~1 MB of font tables) for the
// `init` splash alone. Importing the wordmark used to drag cfonts into the
// startup path of every single command.
// ---------------------------------------------------------------------------

/** The static one-line wordmark used in headers. */
export function wordmark(): string {
  return chalk.white.bold("costcatch");
}

/** Glyphs the "un-settled" columns cycle through before landing. */
const MATRIX_GLYPHS = "▁▂▃▄▅▆▇█░▒▓╌╍┄┅";

/** Deterministic pseudo-random in [0,1) from two integers. */
function rand(a: number, b: number): number {
  const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Reveal `target` left-to-right with a dot-matrix shimmer. */
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

// ---------------------------------------------------------------------------
// Gradient — now monochrome (white → gray fade)
// ---------------------------------------------------------------------------

const gradientCache = new Map<string, string>();

/**
 * Build a per-character monochrome gradient across `text`.
 * White → gray for the clean B&W look.
 */
export function gradient(text: string, hex1: string = "#7cacf8", hex2: string = "#a78bfa"): string {
  const key = `${text}\0${hex1}\0${hex2}`;
  const cached = gradientCache.get(key);
  if (cached) return cached;

  const [r1, g1, b1] = hexToRgb(hex1);
  const [r2, g2, b2] = hexToRgb(hex2);

  let out = "";
  const n = Math.max(text.length - 1, 1);
  for (let i = 0; i < text.length; i++) {
    const t = i / n;
    out += chalk.rgb(
      Math.round(r1 + (r2 - r1) * t),
      Math.round(g1 + (g2 - g1) * t),
      Math.round(b1 + (b2 - b1) * t),
    )(text[i]);
  }
  gradientCache.set(key, out);
  return out;
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

/** Terminal width, capped for readability. */
export function termWidth(max: number = 120): number {
  return Math.min(process.stdout.columns || 120, max);
}

/** Visible width in terminal cells (ANSI-stripped, wide-glyph aware). */
export function visibleLength(s: string): number {
  return stringWidth(s);
}

/** Pad a possibly-colored string to `width` visible columns. */
export function padVisible(s: string, width: number): string {
  const len = visibleLength(s);
  return len >= width ? s : s + " ".repeat(width - len);
}

/** Truncate a plain string to maxLen, adding an ellipsis. */
export function truncate(s: string, maxLen: number): string {
  return s.length <= maxLen ? s : s.slice(0, maxLen - 1) + "…";
}

// ---------------------------------------------------------------------------
// Square-box frame — shared across all renderers
// ---------------------------------------------------------------------------

/** Solid top border: `┌────────────────────────────┐`. */
export function frameTopSolid(width: number): string {
  return faint(glyph.tl + glyph.h.repeat(Math.max(0, width - 2)) + glyph.tr);
}

/** Solid bottom border: `└────────────────────────────┘`. */
export function frameBottomSolid(width: number): string {
  return faint(glyph.bl + glyph.h.repeat(Math.max(0, width - 2)) + glyph.br);
}

/** Solid middle divider border: `├────────────────────────────┤`. */
export function frameDivider(width: number): string {
  return faint(glyph.ml + glyph.h.repeat(Math.max(0, width - 2)) + glyph.mr);
}

/** Framed header line with left+right content inside the box: `│ left                    right │`. */
export function frameHeader(left: string, right: string, width: number): string {
  const inner = width - 4; // "│ " ... " │"
  const visLeft = visibleLength(left);
  const visRight = visibleLength(right);
  const pad = Math.max(0, inner - visLeft - visRight);
  return `${faint(glyph.v)} ${left}${" ".repeat(pad)}${right} ${faint(glyph.v)}`;
}

/** Top rule: solid top border + framed header line inside the box. */
export function frameTop(left: string, right: string, width: number): string {
  return `${frameTopSolid(width)}\n${frameHeader(left, right, width)}`;
}

/** Bottom rule: framed content line inside the box + solid bottom border. */
export function frameBottom(text: string, width: number): string {
  return `${frameLine(text, width)}\n${frameBottomSolid(width)}`;
}

/** A framed body line with left+right rails, padded to width. */
export function frameLine(content: string, width: number): string {
  const inner = width - 4; // "│ " ... " │"
  const vis = visibleLength(content);
  const pad = vis < inner ? " ".repeat(inner - vis) : "";
  return `${faint(glyph.v)} ${content}${pad} ${faint(glyph.v)}`;
}
