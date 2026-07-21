// Loads saved traces. They can come from anyone, so every field is checked before use.
import * as fs from "node:fs";
import * as path from "node:path";
import type { Trace, Step, LLMStep } from "../types/trace.js";
import { TRACES_DIR } from "./index.js";
import { stripControl } from "../core/redact.js";
import { computeRetryWaste } from "../core/trace-builder.js";
import { countUnpriced } from "../core/step-checks.js";

// Renderers print trace strings straight to the terminal, so strip control characters.
// Don't redact secrets again here, because that would mangle key-shaped text.
function safeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? stripControl(value) : fallback;
}

// JSON.parse on a huge file blocks the event loop and can hit V8's string length limit.
const MAX_TRACE_FILE_BYTES = 256 * 1024 * 1024;

export function loadTrace(filepath: string): Trace {
  const absPath = path.resolve(filepath);

  let stat: fs.Stats;
  try {
    stat = fs.statSync(absPath);
  } catch {
    throw new Error(`Trace file not found: ${absPath}`);
  }

  if (stat.isDirectory()) {
    throw new Error(`Expected a trace file, got a directory: ${absPath}`);
  }
  if (stat.size === 0) {
    throw new Error(`Trace file is empty: ${absPath}`);
  }
  if (stat.size > MAX_TRACE_FILE_BYTES) {
    throw new Error(
      `Trace file is too large to load (${(stat.size / 1024 / 1024).toFixed(0)} MB, max ${MAX_TRACE_FILE_BYTES / 1024 / 1024} MB): ${absPath}`,
    );
  }

  const content = fs.readFileSync(absPath, "utf-8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Invalid JSON in trace file: ${absPath}`);
  }

  const trace = coerceTrace(parsed);
  if (!trace) {
    throw new Error(
      `Not a costcatch trace file (missing runId/steps): ${absPath}`,
    );
  }
  return trace;
}

// Missing fields get defaults instead of a rejection, so traces from older versions still open.
function coerceTrace(value: unknown): Trace | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const t = value as Record<string, unknown>;

  if (typeof t.runId !== "string" || !Array.isArray(t.steps)) return null;

  const steps = (t.steps as unknown[]).map(coerceStep).filter((s): s is Step => s !== null);

  const rawSummary = (t.summary !== null && typeof t.summary === "object" ? t.summary : {}) as Record<string, unknown>;
  const count = (key: string, fallback: number): number => {
    const v = rawSummary[key];
    return typeof v === "number" && Number.isFinite(v) ? v : fallback;
  };
  const llmStepCount = steps.filter((s) => s.type === "llm").length;
  // Older traces have no retry totals, and zero would wrongly claim there were none.
  const retryFallback = computeRetryWaste(steps.filter((s): s is LLMStep => s.type === "llm"));
  const summary: Trace["summary"] = {
    llmCalls: count("llmCalls", llmStepCount),
    toolCalls: count("toolCalls", steps.length - llmStepCount),
    totalInputTokens: count("totalInputTokens", 0),
    totalOutputTokens: count("totalOutputTokens", 0),
    totalReasoningTokens: count(
      "totalReasoningTokens",
      steps.reduce((n, s) => n + (s.type === "llm" ? (s.reasoningTokens ?? 0) : 0), 0),
    ),
    totalSteps: count("totalSteps", steps.length),
    retries: count("retries", retryFallback.retries),
    wastedCostUsd: count("wastedCostUsd", retryFallback.wastedCostUsd),
    // Derive this for older traces too, or a partial total would look exact.
    unpricedCalls: count("unpricedCalls", countUnpriced(steps)),
  };

  const trace: Trace = {
    runId: safeString(t.runId, "unknown"),
    script: safeString(t.script, "unknown"),
    runtime: t.runtime === "node" || t.runtime === "python" ? t.runtime : "node",
    durationMs: typeof t.durationMs === "number" && Number.isFinite(t.durationMs) ? t.durationMs : 0,
    totalCostUsd: typeof t.totalCostUsd === "number" && Number.isFinite(t.totalCostUsd) ? t.totalCostUsd : null,
    steps,
    warnings: coerceWarnings(t.warnings),
    summary,
    startedAt: safeString(t.startedAt, new Date(0).toISOString()),
    command: safeString(t.command),
  };
  if (typeof t.exitCode === "number" && Number.isInteger(t.exitCode)) trace.exitCode = t.exitCode;
  return trace;
}

function coerceWarnings(value: unknown): Trace["warnings"] {
  if (!Array.isArray(value)) return [];
  const severities = new Set(["info", "warn", "critical"]);
  return value.flatMap((w) => {
    const rec = w !== null && typeof w === "object" && !Array.isArray(w) ? (w as Record<string, unknown>) : null;
    if (!rec) return [];
    return [
      {
        severity: (typeof rec.severity === "string" && severities.has(rec.severity)
          ? rec.severity
          : "info") as Trace["warnings"][number]["severity"],
        code: safeString(rec.code, "unknown"),
        message: safeString(rec.message),
        stepIds: Array.isArray(rec.stepIds) ? rec.stepIds.filter((n): n is number => typeof n === "number") : [],
      },
    ];
  });
}

function coerceToolCalls(value: unknown): LLMStep["toolCalls"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((tc) => {
    const rec = tc !== null && typeof tc === "object" ? (tc as Record<string, unknown>) : null;
    if (!rec) return [];
    const input = rec.input;
    const call: LLMStep["toolCalls"][number] = {
      name: safeString(rec.name, "unknown"),
      // formatArgs calls Object.entries on this, which throws on null.
      input: input !== null && typeof input === "object" && !Array.isArray(input)
        ? (stripControlDeep(input) as Record<string, unknown>)
        : {},
    };
    if (typeof rec.id === "string") call.id = safeString(rec.id);
    const result = coerceToolResult(rec.result);
    if (result) call.result = result;
    if (rec.unanswered === true) call.unanswered = true;
    if (rec.invalidArguments === true) call.invalidArguments = true;
    const error = rec.error;
    if (error !== null && typeof error === "object" && !Array.isArray(error)) {
      call.error = { message: safeString((error as Record<string, unknown>).message) };
    }
    return [call];
  });
}

function coerceProviderUsage(value: unknown): Pick<LLMStep, "providerUsage"> {
  if (value === null) return { providerUsage: null };
  if (typeof value !== "object" || Array.isArray(value)) return {};
  return { providerUsage: stripControlDeep(value) as Record<string, unknown> };
}

function stripControlDeep(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return stripControl(value);
  if (value === null || typeof value !== "object") return value;
  if (depth > 12) return "[nested too deep]";
  if (Array.isArray(value)) return value.map((v) => stripControlDeep(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    // Use defineProperty because assigning a key named __proto__ would set the prototype instead.
    Object.defineProperty(out, stripControl(k), { value: stripControlDeep(v, depth + 1), enumerable: true, writable: true, configurable: true });
  }
  return out;
}

function coerceToolResult(value: unknown): LLMStep["toolCalls"][number]["result"] | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  const count = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
  const chars = count(r.chars);
  const tokens = count(r.tokens);
  const stepId = count(r.stepId);
  const sends = count(r.sends);
  if (chars === null || tokens === null || stepId === null || sends === null || sends < 1) return null;
  return r.sendsPartial === true ? { chars, tokens, stepId, sends, sendsPartial: true } : { chars, tokens, stepId, sends };
}

function coerceContent(value: unknown): LLMStep["content"] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const c = value as Record<string, unknown>;
  return {
    system: typeof c.system === "string" ? stripControl(c.system) : null,
    messages: Array.isArray(c.messages)
      ? c.messages.flatMap((m) => {
          const rec = m !== null && typeof m === "object" ? (m as Record<string, unknown>) : null;
          if (!rec) return [];
          return [{ role: safeString(rec.role, "user"), content: safeString(rec.content) }];
        })
      : [],
    output: typeof c.output === "string" ? stripControl(c.output) : null,
    truncated: c.truncated === true,
  };
}

function coerceError(value: unknown): LLMStep["error"] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const e = value as Record<string, unknown>;
  return {
    type: typeof e.type === "string" ? stripControl(e.type) : null,
    message: safeString(e.message),
  };
}

function coerceStep(value: unknown): Step | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const s = value as Record<string, unknown>;
  const num = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  const nullableNum = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  if (s.type === "tool") {
    return {
      type: "tool",
      id: num(s.id, 0),
      durationMs: num(s.durationMs, 0),
      name: safeString(s.name, "unknown"),
      outputChars: nullableNum(s.outputChars),
    };
  }
  if (s.type !== "llm") return null;

  return {
    type: "llm",
    id: num(s.id, 0),
    durationMs: num(s.durationMs, 0),
    ...(typeof s.offsetMs === "number" && Number.isFinite(s.offsetMs) && s.offsetMs >= 0 ? { offsetMs: s.offsetMs } : {}),
    provider: safeString(s.provider, "unknown"),
    // The model is shown in one-line rows, so collapse any line breaks.
    model: safeString(s.model, "unknown").replace(/\s+/g, " ").trim(),
    inputTokens: nullableNum(s.inputTokens),
    outputTokens: nullableNum(s.outputTokens),
    cachedTokens: nullableNum(s.cachedTokens),
    reasoningTokens: nullableNum(s.reasoningTokens),
    costUsd: nullableNum(s.costUsd),
    ...coerceProviderUsage(s.providerUsage),
    toolCalls: coerceToolCalls(s.toolCalls),
    isStreaming: s.isStreaming === true,
    finishReason: safeString(s.finishReason, "unknown"),
    statusCode: typeof s.statusCode === "number" ? s.statusCode : undefined,
    error: coerceError(s.error),
    content: coerceContent(s.content),
    retryOf: nullableNum(s.retryOf),
    ...(s.kind === "embedding" ? { kind: "embedding" as const } : {}),
    ...(s.cancelled === true ? { cancelled: true as const } : {}),
    ...(typeof s.conversation === "number" && Number.isInteger(s.conversation) && s.conversation > 0 ? { conversation: s.conversation } : {}),
  };
}

// Newest first, by file mtime.
export function listTraces(projectRoot: string): string[] {
  const tracesDir = path.join(projectRoot, TRACES_DIR);

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(tracesDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: Array<{ file: string; mtimeMs: number }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const file = path.join(tracesDir, entry.name);
    // Skip pricing.json and other JSON files, or clean --keep would delete real traces instead.
    if (!looksLikeTrace(file)) continue;
    try {
      files.push({ file, mtimeMs: fs.statSync(file).mtimeMs });
    } catch {}
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files.map((f) => f.file);
}

// Saved traces start with runId, which the price cache and other JSON files don't have.
function looksLikeTrace(file: string): boolean {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, "r");
    const head = Buffer.alloc(4096);
    const bytes = fs.readSync(fd, head, 0, head.length, 0);
    return head.subarray(0, bytes).toString("utf-8").includes('"runId"');
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
  }
}

export function loadAllTraces(projectRoot: string, limit = Number.POSITIVE_INFINITY): Trace[] {
  const files = listTraces(projectRoot);
  const traces: Trace[] = [];

  for (const file of files) {
    if (traces.length >= limit) break;
    try {
      traces.push(loadTrace(file));
    } catch {}
  }

  return traces;
}
