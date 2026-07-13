/**
 * Core trace data types.
 *
 * A Trace represents a single agent run — all the LLM calls, tool calls,
 * timing, cost, and warnings captured during execution.
 */

// ---------------------------------------------------------------------------
// Tool Calls
// ---------------------------------------------------------------------------

/** A single tool/function call made by the LLM. */
export interface ToolCall {
  /** Tool/function name (e.g. "web_search", "get_weather") */
  name: string;
  /** Arguments passed to the tool */
  input: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Captured content (the actual conversation) — enables `show` / `--inspect`
// ---------------------------------------------------------------------------

/** One message sent to (or produced by) the model. */
export interface StepMessage {
  role: string;
  content: string;
}

/**
 * The actual content of an LLM call — the prompt that went in and the text
 * that came out. Secrets/PII are redacted and long fields truncated at capture.
 *
 * DELTA-STORED: chat APIs resend the whole growing history every turn, so we
 * only keep what's NEW in this call. `messages` holds the tail added since the
 * previous LLM call; `carried` counts the identical leading messages we omitted
 * (and `carriedFromStep` says which step they match). This keeps a long agent
 * run linear instead of quadratic, and makes `show` highlight what changed.
 */
export interface StepContent {
  /** System prompt (null if identical to the previous call — see systemUnchanged). */
  system: string | null;
  /** True when the system prompt was omitted because it matched the prior call. */
  systemUnchanged?: boolean;
  /** NEW input messages added since the previous LLM call. */
  messages: StepMessage[];
  /** Count of leading messages carried unchanged from the previous call. */
  carried?: number;
  /** Which earlier step the carried messages came from. */
  carriedFromStep?: number;
  /** The model's text output for this call. */
  output: string | null;
  /** True if any field was truncated to keep the trace file bounded. */
  truncated: boolean;
}

/** An error returned by the provider (non-2xx response). */
export interface StepError {
  /** Provider error type/code (e.g. "rate_limit_error", "invalid_request_error"). */
  type: string | null;
  /** Human-readable error message extracted from the response body. */
  message: string;
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/** Base fields shared by every step in a trace. */
interface StepBase {
  /** Sequential ID within the trace (1-indexed) */
  id: number;
  /** Wall-clock duration in milliseconds */
  durationMs: number;
}

/** An LLM API call step. */
export interface LLMStep extends StepBase {
  type: "llm";
  /** Provider name (e.g. "openai", "anthropic") */
  provider: string;
  /** Model identifier (e.g. "gpt-4o", "claude-sonnet-4-6") */
  model: string;
  /** Input/prompt tokens — null if unavailable (e.g. streaming without usage) */
  inputTokens: number | null;
  /** Output/completion tokens — null if unavailable */
  outputTokens: number | null;
  /** Cached input tokens (prompt caching), if reported */
  cachedTokens: number | null;
  /** Cost in USD for this step — null if model pricing unknown */
  costUsd: number | null;
  /** Tool calls the LLM decided to make */
  toolCalls: ToolCall[];
  /** Whether this was a streaming request */
  isStreaming: boolean;
  /** Why the LLM stopped: "end_turn", "tool_use", "stop", "length", etc. */
  finishReason: string;
  /** HTTP status code of the response (200 on success). */
  statusCode?: number;
  /** Error details when the response was non-2xx (null/absent on success). */
  error?: StepError | null;
  /** The captured conversation content (redacted + truncated), if enabled. */
  content?: StepContent | null;
  /** Set when this call looks like a retry of an earlier one (that step's id). */
  retryOf?: number | null;
}

/** A tool execution step (the result after an LLM requests a tool call). */
export interface ToolStep extends StepBase {
  type: "tool";
  /** Tool name */
  name: string;
  /** Size of the tool's output in characters */
  outputChars: number | null;
}

/** A step is either an LLM call or a tool execution. */
export type Step = LLMStep | ToolStep;

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

/** Warning severity levels. */
export type WarningSeverity = "info" | "warn" | "critical";

/** A warning detected by the warning engine. */
export interface TraceWarning {
  severity: WarningSeverity;
  /** Machine-readable code (e.g. "context_growth", "duplicate_tool_call") */
  code: string;
  /** Human-readable message */
  message: string;
  /** IDs of the steps this warning relates to */
  stepIds: number[];
}

// ---------------------------------------------------------------------------
// Trace Summary
// ---------------------------------------------------------------------------

/** Aggregated summary stats for a trace. */
export interface TraceSummary {
  llmCalls: number;
  toolCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalSteps: number;
}

// ---------------------------------------------------------------------------
// Trace (top-level)
// ---------------------------------------------------------------------------

/** A complete trace of one agent run. */
export interface Trace {
  /** Unique run identifier (ISO timestamp-based) */
  runId: string;
  /** The script that was traced (e.g. "my_agent.py") */
  script: string;
  /** Runtime detected: "python" or "node" */
  runtime: "python" | "node";
  /** Total wall-clock duration in milliseconds */
  durationMs: number;
  /** Total cost in USD — null if any step has unknown pricing */
  totalCostUsd: number | null;
  /** Ordered list of steps */
  steps: Step[];
  /** Warnings detected by the warning engine */
  warnings: TraceWarning[];
  /** Aggregated summary */
  summary: TraceSummary;
  /** ISO 8601 timestamp of when the trace started */
  startedAt: string;
  /** The full command that was traced */
  command: string;
}

// ---------------------------------------------------------------------------
// Raw Interceptor Data
// ---------------------------------------------------------------------------

/**
 * Raw HTTP call captured by an interceptor (Node.js or Python).
 * This is the completion record written to the temp NDJSON file. It may carry
 * an optional `phase: "end"` tag and correlation `id` (new two-phase protocol),
 * or arrive as a bare object (legacy). Either way the shape below is identical.
 */
export interface RawHttpCall {
  /** Discriminator for the two-phase protocol (absent on legacy records) */
  phase?: "end";
  /** Correlation id pairing this completion with its "start" record */
  id?: number;
  /** Full URL of the request */
  url: string;
  /** HTTP method */
  method: string;
  /** Request body (parsed JSON) */
  requestBody: unknown;
  /** Response body (parsed JSON) — may be reconstructed from SSE chunks */
  responseBody: unknown;
  /** HTTP status code */
  statusCode: number;
  /** Timestamp when the request started (ms since epoch) */
  startMs: number;
  /** Timestamp when the response completed (ms since epoch) */
  endMs: number;
  /** Whether the request used SSE streaming */
  isStreaming: boolean;
}

/**
 * Lightweight "request started" record — emitted by the interceptors the moment
 * a matched LLM request is dispatched, BEFORE the response arrives. This is what
 * lets the live UI show an in-flight call with a spinner + ticking timer. It is
 * skipped entirely when building the final trace.
 */
export interface StartRecord {
  phase: "start";
  /** Correlation id (pairs with the completion record's id) */
  id: number;
  url: string;
  /** Model name, read from the request body if present */
  model: string | null;
  /** Best-effort provider name (from URL host) */
  provider?: string;
  startMs: number;
}

/** Any line in the NDJSON stream: a start marker or a completed call. */
export type RawRecord = StartRecord | RawHttpCall;

/** Type guard: is this a "start" marker? */
export function isStartRecord(r: RawRecord): r is StartRecord {
  return (r as StartRecord).phase === "start";
}
