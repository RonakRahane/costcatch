/**
 * Live region — a sticky, in-place render area pinned to the bottom of the TTY.
 *
 * Wraps `log-update`. The trace box lives in the region and is redrawn in place
 * (no stacking). The child process's own stdout/stderr is written *above* the
 * region via `writePassthrough`, so the user's logs scroll naturally in
 * scrollback while our animated box stays put.
 *
 * All cursor/TTY handling lives here; callers never touch escape codes.
 */

import logUpdate from "log-update";

export interface LiveRegion {
  /** Redraw the pinned frame (skips the write if it's unchanged). */
  update(frame: string): void;
  /** Write raw child output above the region, then re-pin the frame. */
  writePassthrough(chunk: string | Buffer, stream: NodeJS.WriteStream): void;
  /** Erase the region (leaves scrollback above intact). */
  clear(): void;
  /** Erase the region and restore the cursor. Call exactly once at the end. */
  stop(): void;
}

const HIDE_CURSOR = "[?25l";
const SHOW_CURSOR = "[?25h";

/**
 * Create a live region bound to `stdout` (defaults to process.stdout).
 * Hides the cursor while active and guarantees it is restored on exit/signals.
 */
export function createLiveRegion(stdout: NodeJS.WriteStream = process.stdout): LiveRegion {
  let lastFrame = "";
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

  // Safety net: never leave the terminal with a hidden cursor.
  const restore = () => showCursor();
  process.once("exit", restore);
  process.once("SIGINT", restore);
  process.once("SIGTERM", restore);

  function update(frame: string): void {
    if (stopped) return;
    if (frame === lastFrame) return;
    lastFrame = frame;
    hideCursor();
    logUpdate(frame);
  }

  function writePassthrough(chunk: string | Buffer, target: NodeJS.WriteStream): void {
    if (stopped) {
      target.write(chunk);
      return;
    }
    // Erase our region, emit the child's raw output above it, then re-pin.
    logUpdate.clear();
    target.write(chunk);
    if (lastFrame) {
      hideCursor();
      logUpdate(lastFrame);
    }
  }

  function clear(): void {
    logUpdate.clear();
    lastFrame = "";
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    logUpdate.clear();
    logUpdate.done();
    showCursor();
    process.removeListener("exit", restore);
    process.removeListener("SIGINT", restore);
    process.removeListener("SIGTERM", restore);
  }

  return { update, writePassthrough, clear, stop };
}
