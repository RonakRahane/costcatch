// Reads the records added to the interceptors' NDJSON file since the last poll.

import * as fs from "node:fs";
import type { RawRecord } from "../types/trace.js";

export interface NdjsonTail {
  poll(): RawRecord[];
  reset(): void;
}

export function createNdjsonTail(filePath: string): NdjsonTail {
  let offset = 0;
  let carryBytes: Buffer = Buffer.alloc(0);

  function poll(): RawRecord[] {
    let content: string;
    try {
      // Read only the new bytes, because the file can grow to tens of megabytes.
      const stat = fs.statSync(filePath);
      if (stat.size <= offset) return [];
      const fd = fs.openSync(filePath, "r");
      try {
        const len = stat.size - offset;
        const buf = Buffer.allocUnsafe(len);
        const read = fs.readSync(fd, buf, 0, len, offset);
        // Split on bytes before decoding, since a read can end in the middle of a character.
        const combined = carryBytes.length > 0 ? Buffer.concat([carryBytes, buf.subarray(0, read)]) : buf.subarray(0, read);
        const lastNl = combined.lastIndexOf(0x0a);
        if (lastNl === -1) {
          carryBytes = combined;
          offset += read;
          return [];
        }
        content = combined.toString("utf-8", 0, lastNl);
        carryBytes = Buffer.from(combined.subarray(lastNl + 1));
        offset += read;
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return [];
    }

    const text = content;
    const records: RawRecord[] = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed) as RawRecord);
      } catch {}
    }
    return records;
  }

  function reset(): void {
    offset = 0;
    carryBytes = Buffer.alloc(0);
  }

  return { poll, reset };
}
