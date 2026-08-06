/**
 * Trace persistence: atomic writes, collision safety, and hostile input.
 *
 * Trace files are shared between developers and copied out of CI artifacts, so
 * the loader treats every file as untrusted and the writer never leaves a
 * half-written document behind.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { saveTrace } from "../../../src/storage/save.js";
import { loadTrace, listTraces, loadAllTraces } from "../../../src/storage/load.js";
import { TRACES_DIR } from "../../../src/core/constants.js";
import type { Trace } from "../../../src/types/trace.js";

let root: string;

function makeTrace(overrides: Partial<Trace> = {}): Trace {
  return {
    runId: "2026-05-15T14-32-17",
    script: "agent.py",
    runtime: "python",
    durationMs: 1234,
    totalCostUsd: 0.01,
    steps: [],
    warnings: [],
    summary: { llmCalls: 0, toolCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, totalSteps: 0 },
    startedAt: "2026-05-15T14:32:17.000Z",
    command: "python agent.py",
    ...overrides,
  };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "costcatch-store-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("saveTrace", () => {
  it("writes a loadable trace and returns its path", () => {
    const saved = saveTrace(makeTrace(), root);
    expect(fs.existsSync(saved)).toBe(true);
    expect(loadTrace(saved).runId).toBe("2026-05-15T14-32-17");
  });

  it("leaves no temp file behind", () => {
    saveTrace(makeTrace(), root);
    const leftovers = fs.readdirSync(path.join(root, TRACES_DIR)).filter((f) => f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("does not clobber an earlier run with the same runId", () => {
    // runId only has second resolution, so two fast runs of the same script
    // collide — the second used to silently overwrite the first.
    const first = saveTrace(makeTrace({ command: "run one" }), root);
    const second = saveTrace(makeTrace({ command: "run two" }), root);

    expect(second).not.toBe(first);
    expect(loadTrace(first).command).toBe("run one");
    expect(loadTrace(second).command).toBe("run two");
  });

  it("treats an explicit --save-as as a deliberate overwrite", () => {
    const first = saveTrace(makeTrace({ command: "one" }), root, "baseline");
    const second = saveTrace(makeTrace({ command: "two" }), root, "baseline");
    expect(second).toBe(first);
    expect(loadTrace(second).command).toBe("two");
  });

  it("cannot be walked out of the traces directory by --save-as", () => {
    const saved = saveTrace(makeTrace(), root, "../../../../etc/passwd");
    expect(path.dirname(saved)).toBe(path.join(root, TRACES_DIR));
    expect(path.basename(saved)).not.toContain("..");
  });

  it("survives a name made entirely of separators", () => {
    const saved = saveTrace(makeTrace(), root, "///...///");
    expect(path.dirname(saved)).toBe(path.join(root, TRACES_DIR));
    expect(fs.existsSync(saved)).toBe(true);
  });
});

describe("loadTrace", () => {
  it("reports a missing file clearly", () => {
    expect(() => loadTrace(path.join(root, "nope.json"))).toThrow(/not found/i);
  });

  it("reports a directory clearly", () => {
    expect(() => loadTrace(root)).toThrow(/directory/i);
  });

  it("reports an empty file clearly", () => {
    const f = path.join(root, "empty.json");
    fs.writeFileSync(f, "");
    expect(() => loadTrace(f)).toThrow(/empty/i);
  });

  it("reports malformed JSON clearly", () => {
    const f = path.join(root, "bad.json");
    fs.writeFileSync(f, "{not json");
    expect(() => loadTrace(f)).toThrow(/Invalid JSON/i);
  });

  it("rejects well-formed JSON that isn't a trace", () => {
    const f = path.join(root, "other.json");
    fs.writeFileSync(f, JSON.stringify({ hello: "world" }));
    expect(() => loadTrace(f)).toThrow(/Not a costcatch trace/i);
  });

  it("rejects a JSON array", () => {
    const f = path.join(root, "arr.json");
    fs.writeFileSync(f, "[1,2,3]");
    expect(() => loadTrace(f)).toThrow(/Not a costcatch trace/i);
  });

  it("fills defaults for a trace from an older version", () => {
    const f = path.join(root, "old.json");
    fs.writeFileSync(f, JSON.stringify({ runId: "old-run", steps: [] }));

    const trace = loadTrace(f);
    expect(trace.runId).toBe("old-run");
    expect(trace.script).toBe("unknown");
    expect(trace.warnings).toEqual([]);
    expect(trace.summary.totalSteps).toBe(0);
  });

  it("drops step entries that are not objects", () => {
    const f = path.join(root, "mixed.json");
    fs.writeFileSync(
      f,
      JSON.stringify({ runId: "r", steps: [null, "nope", 42, { type: "llm", id: 1, durationMs: 5 }] }),
    );
    expect(loadTrace(f).steps).toHaveLength(1);
  });
});

describe("listTraces / loadAllTraces", () => {
  it("returns an empty list when the directory does not exist", () => {
    expect(listTraces(path.join(root, "elsewhere"))).toEqual([]);
  });

  it("skips corrupt files instead of failing the whole read", () => {
    saveTrace(makeTrace(), root);
    fs.writeFileSync(path.join(root, TRACES_DIR, "corrupt.json"), "{{{");

    expect(listTraces(root)).toHaveLength(2);
    expect(loadAllTraces(root)).toHaveLength(1);
  });

  it("honours the limit", () => {
    saveTrace(makeTrace({ runId: "a" }), root);
    saveTrace(makeTrace({ runId: "b" }), root);
    saveTrace(makeTrace({ runId: "c" }), root);
    expect(loadAllTraces(root, 2)).toHaveLength(2);
  });
});
