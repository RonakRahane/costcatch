/**
 * Incremental NDJSON tail.
 *
 * Reads new bytes from a growing NDJSON file since the last poll, parses each
 * COMPLETE line, and buffers any trailing partial line until it's finished.
 * This is the partial-line-safe logic that used to live (buggily) inside the
 * tracer's setInterval — extracted, hardened, and testable in isolation.
 */

import * as fs from "node:fs";
import type { RawRecord } from "../types/trace.js";

export interface NdjsonTail {
  /** Return records completed since the previous poll (possibly empty). */
  poll(): RawRecord[];
  /** Reset the read offset to the start of the file. */
  reset(): void;
}

/**
 * Create a tail reader for `filePath`.
 *
 * `poll()` reads from the last byte offset to EOF, advances the offset only up
 * to the last newline (so a half-written final line is retried next poll), and
 * JSON-parses each complete line. Malformed lines are skipped, never thrown.
 */
export function createNdjsonTail(filePath: string): NdjsonTail {
  let offset = 0;
  let carry = "";

  function poll(): RawRecord[] {
    let content: string;
    try {
      if (!fs.existsSync(filePath)) return [];
      const buf = fs.readFileSync(filePath);
      if (buf.length <= offset) return [];
      content = buf.toString("utf-8", offset);
      offset = buf.length;
    } catch {
      return [];
    }

    const text = carry + content;
    const lastNewline = text.lastIndexOf("\n");

    // Keep everything after the final newline as carry for the next poll.
    let complete: string;
    if (lastNewline === -1) {
      carry = text;
      return [];
    } else {
      complete = text.slice(0, lastNewline);
      carry = text.slice(lastNewline + 1);
    }

    const records: RawRecord[] = [];
    for (const line of complete.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed) as RawRecord);
      } catch {
        // partial/corrupt line — skip
      }
    }
    return records;
  }

  function reset(): void {
    offset = 0;
    carry = "";
  }

  return { poll, reset };
}
