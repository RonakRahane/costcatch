// Redraws the live box in place below the program's output. All the cursor escapes live here.

import { visibleLength } from "./theme.js";

export interface LiveRegion {
  update(frame: string): void;
  writePassthrough(chunk: string | Buffer, stream: NodeJS.WriteStream): void;
  clear(): void;
  restart(text: string): void;
  stop(): void;
}

const ESC = "[";
const HIDE_CURSOR = `${ESC}?25l`;
const SHOW_CURSOR = `${ESC}?25h`;
const ERASE_LINE = `${ESC}2K`;
const ERASE_BELOW = `${ESC}J`;
const DOWN_ONE = `${ESC}1B`;
// Move to column 0. Don't use \r, because a runner that labels lines prints its label again after one.
const COL0 = `${ESC}1G`;
// Turn autowrap off and on. While it's off, a row that's too wide is clipped instead of wrapped.
const WRAP_OFF = `${ESC}?7l`;
const WRAP_ON = `${ESC}?7h`;
const HOME = `${ESC}H`;
// Move to the last row. Cursor-down stops at the bottom of the screen, so any big number works.
const BOTTOM = `${ESC}999B`;
// Save and restore the cursor position (DECSC and DECRC).
const SAVE = "\u001b7";
const RESTORE = "\u001b8";

const up = (n: number): string => (n > 0 ? `${ESC}${n}A` : "");
const down = (n: number): string => (n > 0 ? `${ESC}${n}B` : "");

export interface LiveRegionOptions {
  gutter?: number;
  // Read on every erase, so rows the terminal rewrapped after a resize are counted right.
  columns?: () => number;
  rows?: () => number;
  // For turborepo's TUI pane, which can't turn autowrap off and replays all output on resize.
  // The box is found by a saved cursor position instead of by counting lines.
  anchored?: boolean;
}

export function createLiveRegion(
  stdout: NodeJS.WriteStream = process.stdout,
  options: LiveRegionOptions = {},
): LiveRegion {
  const pad = " ".repeat(Math.max(0, options.gutter ?? 0));
  const columns = options.columns ?? (() => stdout.columns || 80);
  const rows = options.rows ?? (() => stdout.rows || 24);

  let lastFrame = "";
  // Width of each drawn row. We keep widths, not line counts, because line counts change on resize.
  let drawn: number[] = [];
  let atLineStart = true;
  let cursorHidden = false;
  let stopped = false;

  function hideCursor(): void {
    if (!cursorHidden) {
      stdout.write(HIDE_CURSOR);
      cursorHidden = true;
    }
  }

  function showCursor(): void {
    if (cursorHidden) {
      stdout.write(SHOW_CURSOR);
      cursorHidden = false;
    }
  }

  const restore = () => showCursor();
  process.once("exit", restore);
  process.once("SIGINT", restore);
  process.once("SIGTERM", restore);

  function linesFor(width: number, cols: number): number {
    return Math.max(1, Math.ceil(width / Math.max(1, cols)));
  }

  function lines(): number {
    const cols = columns();
    let n = 0;
    for (const w of drawn) n += linesFor(w, cols);
    return n;
  }

  // Erases the box from the line below it and leaves the cursor at its top. If the box was taller
  // than the screen, blank lines are scrolled in so its old rows don't reappear if the window grows.
  function eraseRegion(): string {
    const n = lines();
    if (n === 0) return "";
    const reach = Math.max(1, rows() - 1);
    if (n <= reach) return `${up(n)}${COL0}${ERASE_BELOW}`;
    const blank = `\n${COL0}${ERASE_LINE}`.repeat(rows());
    return `${up(n)}${COL0}${ERASE_BELOW}${BOTTOM}${blank}${HOME}${ERASE_BELOW}`;
  }

  // The up(1) and newline are there so a runner puts its label on the box's top line.
  function vacate(): string {
    if (drawn.length === 0) return "";
    if (options.anchored) return `${RESTORE}${COL0}${ERASE_BELOW}`;
    return `${WRAP_OFF}${eraseRegion()}${up(1)}\n${WRAP_ON}`;
  }

  // Every row is placed from the saved top of the box, so a row that wraps gets covered by the next one.
  function drawAnchored(rows: string[]): string {
    const n = rows.length;
    let s = WRAP_OFF;
    // Only add lines for a new or taller box. turbo replays this frame into a shorter pane after
    // a resize, and extra newlines there would scroll it and leave blank lines.
    if (drawn.length === 0 || n > drawn.length) {
      s += vacate() + "\n".repeat(n + 1 + (atLineStart ? 0 : 1)) + up(n + 1) + COL0 + SAVE;
    }
    s += rows.map((row, i) => `${RESTORE}${down(i)}${COL0}${ERASE_LINE}${pad}${row}`).join("");
    return s + `${RESTORE}${down(n)}${COL0}${ERASE_BELOW}${WRAP_ON}`;
  }

  function draw(frame: string): string {
    const rows = frame.split("\n");
    const cols = columns();
    const n = rows.length;
    const widths = rows.map((row) => Math.min(pad.length + visibleLength(row), cols));
    if (options.anchored) {
      const s = drawAnchored(rows);
      drawn = widths;
      atLineStart = true;
      return s;
    }

    let s = WRAP_OFF + eraseRegion();
    // Room for the rows, the line below and a spare line, plus one if the cursor is on an unfinished line.
    s += "\n".repeat(n + 1 + (atLineStart ? 0 : 1));
    // Clearing to the end also removes any labels a runner put on the new lines.
    s += up(n + 1) + COL0 + ERASE_BELOW;
    // Move between rows with cursor-down rather than a newline, so a runner doesn't label them.
    s += rows.map((row) => `${COL0}${ERASE_LINE}${pad}${row}`).join(DOWN_ONE);
    // The only newline, down to the line below the box.
    s += "\n" + WRAP_ON;

    drawn = widths;
    atLineStart = true;
    return s;
  }

  function update(frame: string): void {
    if (stopped) return;
    if (frame === lastFrame) return;
    lastFrame = frame;
    hideCursor();
    stdout.write(draw(frame));
  }

  function writePassthrough(chunk: string | Buffer, target: NodeJS.WriteStream): void {
    if (stopped) {
      target.write(chunk);
      return;
    }
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const lead = vacate();
    if (target === stdout) {
      stdout.write(lead + text);
    } else {
      stdout.write(lead);
      target.write(text);
    }
    drawn = [];
    atLineStart = text.length === 0 || text.endsWith("\n");
    if (lastFrame) {
      hideCursor();
      stdout.write(draw(lastFrame));
    }
  }

  function clear(): void {
    if (drawn.length > 0) stdout.write(vacate());
    drawn = [];
    atLineStart = true;
    lastFrame = "";
  }

  function restart(text: string): void {
    if (stopped) return;
    // Scroll the screen into history before wiping it, because output written during the resize is only on screen.
    let s = WRAP_ON + BOTTOM + `\n${COL0}${ERASE_LINE}`.repeat(rows());
    // The wipe also removes a runner's pending label, so with a gutter we add a newline to get the first line labelled.
    s += HOME + ERASE_BELOW;
    if (pad.length > 0) s += "\n";
    stdout.write(s + text);
    drawn = [];
    lastFrame = ""; // so the next update draws even if the frame hasn't changed
    atLineStart = text.length === 0 || text.endsWith("\n");
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    clear();
    showCursor();
    process.removeListener("exit", restore);
    process.removeListener("SIGINT", restore);
    process.removeListener("SIGTERM", restore);
  }

  return { update, writePassthrough, clear, restart, stop };
}
