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

/** Raw hex values, by semantic role. Monochrome — pure black & white. */
export const palette = {
  text: "#ffffff",     // pure white — primary text
  dim: "#999999",      // medium gray — secondary text
  faint: "#555555",    // dark gray — borders, connectors
  accent: "#cccccc",   // light gray — accents
  accent2: "#aaaaaa",  // medium-light gray
  ok: "#ffffff",       // white — success
  warn: "#bbbbbb",     // light gray — warnings
  err: "#ffffff",      // white — errors (rely on glyphs ✗)
  cost: "#ffffff",     // white — money
  token: "#dddddd",    // near-white — token counts
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
const CIRCLED = [
  "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩",
  "⑪", "⑫", "⑬", "⑭", "⑮", "⑯", "⑰", "⑱", "⑲", "⑳",
];

export function stepNumber(id: number): string {
  return id >= 1 && id <= CIRCLED.length ? CIRCLED[id - 1] : `(${id})`;
}

// ---------------------------------------------------------------------------
// Gradient — now monochrome (white → gray fade)
// ---------------------------------------------------------------------------

const gradientCache = new Map<string, string>();

/**
 * Build a per-character monochrome gradient across `text`.
 * White → gray for the clean B&W look.
 */
export function gradient(text: string, hex1: string = "#ffffff", hex2: string = "#888888"): string {
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
export function termWidth(max: number = 90): number {
  return Math.min(process.stdout.columns || 90, max);
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

/** Top rule: `┌─ left ───────── right ─┐`. */
export function frameTop(left: string, right: string, width: number): string {
  const inner = width - 2;
  const used = visibleLength(left) + visibleLength(right) + 2;
  const fill = Math.max(1, inner - used - 2);
  return (
    faint(glyph.tl + glyph.h) + " " + left + " " +
    faint(glyph.h.repeat(fill)) + " " + right + " " +
    faint(glyph.h + glyph.tr)
  );
}

/** Bottom rule: `└─ text ─────────────┘`. */
export function frameBottom(text: string, width: number): string {
  const inner = width - 2;
  const used = visibleLength(text) + 2;
  const fill = Math.max(1, inner - used - 2);
  return faint(glyph.bl + glyph.h) + " " + text + " " + faint(glyph.h.repeat(fill) + glyph.h + glyph.br);
}

/** A framed body line with left+right rails, padded to width. */
export function frameLine(content: string, width: number): string {
  const inner = width - 4; // "│ " ... " │"
  const vis = visibleLength(content);
  const pad = vis < inner ? " ".repeat(inner - vis) : "";
  return `${faint(glyph.v)} ${content}${pad} ${faint(glyph.v)}`;
}
