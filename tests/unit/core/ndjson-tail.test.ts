import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createNdjsonTail } from "../../../src/core/ndjson-tail.js";
import { isStartRecord } from "../../../src/types/trace.js";

/** Make a fresh temp NDJSON file. */
function tmpFile(): string {
  return path.join(os.tmpdir(), `ndjson-test-${Date.now()}-${Math.random().toString(36).slice(2)}.ndjson`);
}

describe("createNdjsonTail", () => {
  const files: string[] = [];
  afterEach(() => {
    for (const f of files) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
    files.length = 0;
  });

  it("returns nothing for a missing or empty file", () => {
    const f = tmpFile();
    files.push(f);
    const tail = createNdjsonTail(f);
    expect(tail.poll()).toEqual([]); // missing
    fs.writeFileSync(f, "");
    expect(tail.poll()).toEqual([]); // empty
  });

  it("reads only complete lines, buffering a trailing partial line", () => {
    const f = tmpFile();
    files.push(f);
    const tail = createNdjsonTail(f);

    // Write one full line plus a partial (no trailing newline yet)
    fs.writeFileSync(f, `{"phase":"start","id":1,"url":"u","model":"gpt-4o","startMs":1}\n{"phase":"end","id":1`);
    let recs = tail.poll();
    expect(recs).toHaveLength(1);
    expect(isStartRecord(recs[0])).toBe(true);

    // Complete the partial line — it should now parse on the next poll
    fs.appendFileSync(f, `,"url":"u","method":"POST","requestBody":null,"responseBody":null,"statusCode":200,"startMs":1,"endMs":2,"isStreaming":false}\n`);
    recs = tail.poll();
    expect(recs).toHaveLength(1);
    expect(isStartRecord(recs[0])).toBe(false);
  });

  it("skips malformed lines without throwing", () => {
    const f = tmpFile();
    files.push(f);
    const tail = createNdjsonTail(f);
    fs.writeFileSync(f, `not json\n{"phase":"start","id":2,"url":"u","model":null,"startMs":1}\n`);
    const recs = tail.poll();
    expect(recs).toHaveLength(1);
    expect((recs[0] as { id: number }).id).toBe(2);
  });

  it("advances the offset so each record is returned exactly once", () => {
    const f = tmpFile();
    files.push(f);
    const tail = createNdjsonTail(f);
    fs.writeFileSync(f, `{"phase":"start","id":1,"url":"u","model":null,"startMs":1}\n`);
    expect(tail.poll()).toHaveLength(1);
    expect(tail.poll()).toHaveLength(0); // nothing new
    fs.appendFileSync(f, `{"phase":"start","id":2,"url":"u","model":null,"startMs":2}\n`);
    expect(tail.poll()).toHaveLength(1);
  });
});
