// The saved trace format, which --json prints, plus the interceptors' raw records.
export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  id?: string;
  result?: ToolResult;
  // No later request carried the result. Absent when we can't tell, such as with no call id.
  unanswered?: true;
  // Set when the result went back to the model marked as an error.
  error?: ToolCallError;
  // The model's arguments weren't a JSON object. The raw text is kept in input._raw.
  invalidArguments?: true;
}

export interface ToolResult {
  // Length of the result as sent. An image or file counts as a short placeholder.
  chars: number;
  // An estimate, not a count from the provider.
  tokens: number;
  // The first step that carried it and reported its prompt size, or else the first that carried it.
  stepId: number;
  // How many requests carried it, since chat APIs resend the history on every call.
  sends: number;
  // Some later requests couldn't be read, so sends is a minimum.
  sendsPartial?: true;
}

export interface ToolCallError {
  // The tool's own output, redacted and capped. It can be empty.
  message: string;
}

export interface StepMessage {
  role: string;
  content: string;
}

// Once the trace's content cap is reached, later steps get truncated: true and no content.
export interface StepContent {
  system: string | null;
  // Doesn't include the system message.
  messages: StepMessage[];
  output: string | null;
  truncated: boolean;
}

export interface StepError {
  // The provider's error code, like rate_limit_error.
  type: string | null;
  message: string;
}

interface StepBase {
  // Numbered from 1 within the trace.
  id: number;
  durationMs: number;
  // Milliseconds from the first call's start to this step's start. Missing in older traces.
  offsetMs?: number;
}

export interface LLMStep extends StepBase {
  type: "llm";
  provider: string;
  model: string;
  // Includes cached tokens. Null when the provider didn't report usage.
  inputTokens: number | null;
  outputTokens: number | null;
  // Prompt-cache reads, already counted in inputTokens.
  cachedTokens: number | null;
  // Already counted in outputTokens. Null when the model doesn't reason or doesn't report it.
  reasoningTokens: number | null;
  // Null when the model's price is unknown.
  costUsd: number | null;
  // The provider's usage object, redacted. Null when the response had none.
  providerUsage?: Record<string, unknown> | null;
  toolCalls: ToolCall[];
  isStreaming: boolean;
  finishReason: string;
  statusCode?: number;
  error?: StepError | null;
  content?: StepContent | null;
  retryOf?: number | null;
  kind?: "embedding";
  // The program stopped reading early. It's neither a failure nor a finished answer.
  cancelled?: true;
  // Numbered from 1. Calls whose requests continue one another share a number.
  conversation?: number;
}

export interface ToolStep extends StepBase {
  type: "tool";
  name: string;
  outputChars: number | null;
}

export type Step = LLMStep | ToolStep;

export type WarningSeverity = "info" | "warn" | "critical";

export interface TraceWarning {
  severity: WarningSeverity;
  code: string;
  message: string;
  stepIds: number[];
}

export interface TraceSummary {
  llmCalls: number;
  toolCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  // Already counted in totalOutputTokens. Zero when not reported.
  totalReasoningTokens: number;
  totalSteps: number;
  retries: number;
  // Cost of superseded answers, meaning each retry chain's first call and every retry except the last.
  wastedCostUsd: number;
  // Calls that may have been billed but couldn't be priced. Above zero, totalCostUsd is only a lower bound.
  unpricedCalls?: number;
}

export interface Trace {
  runId: string;
  script: string;
  runtime: "python" | "node";
  durationMs: number;
  // A lower bound when summary.unpricedCalls > 0. Null if nothing was priced, or 0 if all were rejected.
  totalCostUsd: number | null;
  steps: Step[];
  warnings: TraceWarning[];
  summary: TraceSummary;
  // An ISO 8601 timestamp.
  startedAt: string;
  command: string;
  exitCode?: number;
}

// One finished call from the interceptor's NDJSON file. Older interceptors leave out phase and id.
export interface RawHttpCall {
  phase?: "end";
  id?: number;
  url: string;
  method: string;
  requestBody: unknown;
  // Rebuilt from the SSE chunks for streamed calls.
  responseBody: unknown;
  statusCode: number;
  // startMs and endMs are epoch milliseconds.
  startMs: number;
  endMs: number;
  isStreaming: boolean;
  // The program stopped reading before the response finished.
  aborted?: boolean;
}

// Written when a matched request goes out, so the live view can show calls in flight.
export interface StartRecord {
  phase: "start";
  id: number;
  url: string;
  // Null when the request body names no model.
  model: string | null;
  // A guess based on the URL host.
  provider?: string;
  startMs: number;
  // The process that made the call. Older interceptors don't write it.
  pid?: number;
}

export type RawRecord = StartRecord | RawHttpCall;

export function isStartRecord(r: RawRecord): r is StartRecord {
  return (r as StartRecord).phase === "start";
}
