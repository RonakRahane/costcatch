// Shared helpers for colors, glyphs, terminal size, text width and the box frame every renderer uses.

import chalk, { Chalk, type ChalkInstance } from "chalk";
import stringWidth from "string-width";

export const palette = {

  text: "#D6D8D5",
  dim: "#858985",
  faint: "#3A3D3A",

  accent: "#B69ADE",
  accent2: "#9480BA",

  ok: "#9BCB72",
  warn: "#D8B86A",
  err: "#E47A7A",

  cost: "#D9BB70",
  token: "#A88FCF",

} as const;

export type ColorRole = keyof typeof palette;

// --no-color has to turn this off too, not just the useColor flag, or a real terminal still gets color.
let colorOn = !process.env.NO_COLOR && chalk.level > 0;

export function setColorEnabled(enabled: boolean): void {
  colorOn = enabled && chalk.level > 0;
}

export function c(role: ColorRole, s: string): string {
  return colorOn ? chalk.hex(palette[role])(s) : s;
}

export function cb(role: ColorRole, s: string): string {
  return colorOn ? chalk.hex(palette[role]).bold(s) : s;
}

export function dim(s: string): string {
  return colorOn ? chalk.hex(palette.dim)(s) : s;
}

export function faint(s: string): string {
  return colorOn ? chalk.hex(palette.faint)(s) : s;
}

export const glyph = {
  tl: "┌",
  tr: "┐",
  bl: "└",
  br: "┘",
  h: "─",
  v: "│",
  tj: "┬",
  bj: "┴",
  mj: "┼",
  ml: "├",
  mr: "┤",
  branch: "├─",
  leaf: "└─",
  pipe: "│ ",
  ok: "✓",
  warn: "∆",
  err: "✗",
  dot: "·",
  bullet: "●",
  arrow: "→",
  flow: "⇢",
  bolt: "▸",
  above: "▴",
  spark: "◦",
} as const;

// Only glyphs that Menlo and SF Mono both draw one cell wide, so no braille. A glyph from a
// fallback font can have a different width and push the row's right border out of line.
export const SPINNER = ["▘", "▝", "▗", "▖"];

export function spinnerFrame(tick: number): string {
  return SPINNER[tick % SPINNER.length];
}

export function stepNumber(id: number): string {
  return `Step ${id}`;
}

// Kept here rather than in matrix-banner.ts, so renderers never load cfonts.
export function wordmark(): string {
  if (!colorOn) return "costcatch";
  return chalk.white.bold("costcatch");
}

const MATRIX_GLYPHS = "▁▂▃▄▅▆▇█░▒▓╌╍┄┅";

// Not Math.random, so a frame redrawn at the same tick looks the same.
function rand(a: number, b: number): number {
  const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export const REVEAL_TICKS = 14;

export function matrixReveal(target: string, tick: number, revealTicks: number = REVEAL_TICKS): string {
  if (!colorOn) return target;
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

const gradientCache = new Map<string, string>();

export function gradient(text: string, hex1: string = "#7cacf8", hex2: string = "#a78bfa"): string {
  if (!colorOn) return text;
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

// Columns the live box is indented by. Frames are sized to fit in what's left.
let reservedColumns = 0;

export function reserveColumns(n: number): void {
  reservedColumns = Math.max(0, n);
}

export function reservedColumnCount(): number {
  return reservedColumns;
}

export interface TerminalSize {
  columns: number;
  rows: number;
}

interface TtyHandle {
  // Fills [columns, rows] and returns 0 on success, or a negative errno on failure.
  getWindowSize(out: number[]): number;
}

// Asks the kernel every time, because Node's cached columns and rows lag behind SIGWINCH.
export function kernelWindowSize(stream: NodeJS.WriteStream): (() => Partial<TerminalSize>) | null {
  const handle = (stream as unknown as { _handle?: TtyHandle })._handle;
  if (typeof handle?.getWindowSize !== "function") return null;
  return () => {
    const size: number[] = [0, 0];
    try {
      if (handle.getWindowSize(size) !== 0) return {};
    } catch {
      return {};
    }
    return { columns: size[0], rows: size[1] };
  };
}

let sizeSource: () => Partial<TerminalSize> =
  kernelWindowSize(process.stdout) ??
  (() => ({ columns: process.stdout.columns, rows: process.stdout.rows }));

export function setTerminalSizeSource(source: () => Partial<TerminalSize>): void {
  sizeSource = source;
}

function envNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

// COLUMNS and LINES win so a size can be pinned. The 80 column fallback is the POSIX default.
export function terminalSize(): TerminalSize {
  const size = sizeSource();
  return {
    columns: envNumber(process.env.COLUMNS) ?? size.columns ?? 80,
    rows: envNumber(process.env.LINES) ?? size.rows ?? 24,
  };
}

export function terminalSizePinned(): boolean {
  return envNumber(process.env.COLUMNS) !== undefined && envNumber(process.env.LINES) !== undefined;
}

// Below 40 columns the live box is clipped at the right edge instead, since autowrap is off while it draws.
export function termWidth(max: number = 120): number {
  const cols = terminalSize().columns;
  return Math.max(40, Math.min(cols - reservedColumns, max));
}

export function insideTurboTui(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TURBO_IS_TUI === "true";
}

// Width of the "<package>:<task>: " label turborepo puts before each line, guessed from npm env vars.
// A wrong guess only shifts the box sideways.
export function prefixGutter(env: NodeJS.ProcessEnv = process.env): number {
  if (env.TURBO_HASH === undefined || insideTurboTui(env)) return 0;
  const pkg = env.npm_package_name;
  const task = env.npm_lifecycle_event;
  if (!pkg || !task) return 0;
  return `${pkg}:${task}: `.length;
}

export type OutputMode = "redraw" | "plain";

export function outputMode(env: NodeJS.ProcessEnv = process.env): OutputMode {
  if (process.stdout.isTTY !== true) return "plain";
  if (env.TERM === "dumb" || env.CI) return "plain";
  return "redraw";
}

export function visibleLength(s: string): number {
  return stringWidth(s);
}

const ANSI_RESET = "\u001b[0m";

export function truncateAnsi(s: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (visibleLength(s) <= maxWidth) return s;

  let out = "";
  let used = 0;
  let styled = false;
  let i = 0;

  while (i < s.length) {
    if (s[i] === "\u001b") {
      const end = s.indexOf("m", i);
      if (end === -1) break;
      out += s.slice(i, end + 1);
      styled = true;
      i = end + 1;
      continue;
    }
    // Step by code point, because an emoji takes two UTF-16 units.
    const ch = String.fromCodePoint(s.codePointAt(i) as number);
    const w = visibleLength(ch);
    if (used + w > maxWidth) break;
    out += ch;
    used += w;
    i += ch.length;
  }

  return styled ? out + ANSI_RESET : out;
}

// Only for plain text. Use truncateAnsi for styled text.
export function truncate(s: string, maxLen: number): string {
  return s.length <= maxLen ? s : s.slice(0, maxLen - 1) + "…";
}

export function labelRule(rule: string, label: string): string {
  const tag = ` ${label} `;
  const MIN_RULE = 2;
  if (tag.length + MIN_RULE * 2 > rule.length) return faint(rule);

  const fits = (start: number): boolean =>
    start >= MIN_RULE &&
    start + tag.length + MIN_RULE <= rule.length &&
    // Don't write over a panel junction, or the divider below it is left hanging.
    !rule.slice(start, start + tag.length).includes(glyph.tj);

  const centred = Math.floor((rule.length - tag.length) / 2);
  let start = centred;

  if (!fits(start)) {
    let best = { start: -1, len: 0 };
    for (const m of rule.matchAll(new RegExp(`${glyph.h}+`, "g"))) {
      if (m[0].length > best.len) best = { start: m.index ?? 0, len: m[0].length };
    }
    if (best.start < 0 || tag.length + MIN_RULE * 2 > best.len) return faint(rule);
    start = best.start + Math.floor((best.len - tag.length) / 2);
    if (!fits(start)) return faint(rule);
  }

  return faint(rule.slice(0, start)) + dim(tag) + faint(rule.slice(start + tag.length));
}

export function frameTopSolid(width: number, label?: string): string {
  const rule = glyph.tl + glyph.h.repeat(Math.max(0, width - 2)) + glyph.tr;
  return label === undefined ? faint(rule) : labelRule(rule, label);
}

export function frameBottomSolid(width: number): string {
  return faint(glyph.bl + glyph.h.repeat(Math.max(0, width - 2)) + glyph.br);
}

export function frameHeader(left: string, right: string, width: number): string {
  const inner = width - 4; // "│ " ... " │"
  let l = left;
  let r = right;
  let visLeft = visibleLength(l);
  let visRight = visibleLength(r);

  const GAP = 2;
  if (visLeft + visRight + GAP > inner) {
    r = truncateAnsi(r, Math.max(0, inner - GAP));
    visRight = visibleLength(r);
    l = truncateAnsi(l, Math.max(0, inner - visRight - GAP));
    visLeft = visibleLength(l);
  }

  const pad = Math.max(0, inner - visLeft - visRight);
  return `${faint(glyph.v)} ${l}${" ".repeat(pad)}${r} ${faint(glyph.v)}`;
}

// No version label here on purpose. The version only shows on the init splash.
export function frameTop(left: string, right: string, width: number): string {
  return `${frameTopSolid(width)}\n${frameHeader(left, right, width)}`;
}

export function frameBottom(text: string, width: number): string {
  return `${frameLine(text, width)}\n${frameBottomSolid(width)}`;
}

export function frameLine(content: string, width: number): string {
  const inner = width - 4; // "│ " ... " │"
  const vis = visibleLength(content);
  if (vis <= inner) {
    return `${faint(glyph.v)} ${content}${" ".repeat(inner - vis)} ${faint(glyph.v)}`;
  }
  // Clip long content, because a border past width would wrap and push every later row out of line.
  const clipped = truncateAnsi(content, Math.max(0, inner - 1)) + "…";
  const clippedVis = visibleLength(clipped);
  const pad = clippedVis < inner ? " ".repeat(inner - clippedVis) : "";
  return `${faint(glyph.v)} ${clipped}${pad} ${faint(glyph.v)}`;
}

export function boxed(opts: {
  rows: string[];
  headerLeft?: string;
  headerRight?: string;
  footer?: string;
  width?: number;
}): string {
  const width = opts.width ?? termWidth();
  const lines: string[] = [""];

  if (opts.headerLeft !== undefined || opts.headerRight !== undefined) {
    lines.push(frameTop(opts.headerLeft ?? wordmark(), opts.headerRight ?? "", width));
  } else {
    lines.push(frameTopSolid(width));
  }

  lines.push(frameLine("", width));
  for (const row of opts.rows) {
    for (const physical of row.split("\n")) lines.push(frameLine(physical, width));
  }

  if (opts.footer !== undefined) {
    lines.push(frameLine("", width));
    lines.push(frameBottom(opts.footer, width));
  } else {
    lines.push(frameLine("", width));
    lines.push(frameBottomSolid(width));
  }

  lines.push("");
  return lines.join("\n");
}

export function notice(role: "ok" | "warn" | "err", headline: string, details: string[] = []): string {
  const width = termWidth();
  const inner = width - 4;
  const mark = role === "ok" ? glyph.ok : role === "warn" ? glyph.warn : glyph.err;

  const rows = [
    ...wrapText(headline, inner - 2).map((line, i) =>
      i === 0 ? `${c(role, mark)} ${c(role, line)}` : `  ${c(role, line)}`,
    ),
    ...details.flatMap((d) => wrapText(d, inner - 4).map((line, i) => `  ${dim(i === 0 ? line : `  ${line}`)}`)),
  ];
  return ["", frameTopSolid(width), ...rows.map((r) => frameLine(r, width)), frameBottomSolid(width), ""].join("\n");
}

// Plain text only, since styled text would need escape tracking across line breaks.
export function wrapText(s: string, width: number): string[] {
  if (width <= 0) return [s];
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line.length === 0) {
      line = word;
    } else if (line.length + 1 + word.length <= width) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
    while (line.length > width) {
      lines.push(line.slice(0, width));
      line = line.slice(width);
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

export function plural(n: number, noun: string, suffix = "s"): string {
  return `${n.toLocaleString()} ${noun}${n === 1 ? "" : suffix}`;
}

export function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export const BAR_CH = { full: "█", three: "▓", half: "▒", light: "░" } as const;

export function renderBar(fraction: number, width: number, fillColor: string = palette.accent): string {
  const f = Math.max(0, Math.min(1, fraction));
  const units = width * 4;
  const filled = Math.round(f * units);
  const fullBlocks = Math.floor(filled / 4);
  const rem = filled % 4;

  const cFill = chalk.hex(fillColor);
  const cEmpty = chalk.hex(palette.faint);

  let bar = cFill(BAR_CH.full.repeat(fullBlocks));
  if (rem > 0 && fullBlocks < width) {
    bar += cFill(rem === 3 ? BAR_CH.three : rem === 2 ? BAR_CH.half : BAR_CH.light);
  }
  const used = fullBlocks + (rem > 0 ? 1 : 0);
  bar += cEmpty(BAR_CH.light.repeat(Math.max(0, width - used)));
  return bar;
}

// A real Chalk at level 0 rather than a passthrough, because callers chain calls like hex(color)(text).
export function noColorChalk(): ChalkInstance {
  return new Chalk({ level: 0 });
}
