// Turns the raw HTTP calls from the interceptors into a trace with priced steps, totals and warnings.
import type { Trace, Step, LLMStep, RawHttpCall, TraceSummary, ToolCall } from "../types/trace.js";
import { createHash } from "node:crypto";
import type { Runtime } from "../types/config.js";
import { detectProvider } from "../providers/registry.js";
import { unwrapResponsesApi } from "../providers/base.js";
import { calculateStepCost, roundUsd } from "./cost-calculator.js";
import { detectWarnings } from "./warning-engine.js";
import {
  extractContent,
  extractError,
  failureInBody,
  readToolResults,
  toolResultBody,
  toolResultText,
  type RedactionCache,
  type ToolResultBlock,
} from "./content-extractor.js";
import { redactString } from "./redact.js";
import { estimateTokens } from "./token-estimator.js";
import { NO_RESPONSE_ERROR, NOT_RECORDED_ERROR, countUnpriced, totalCost } from "./step-checks.js";

export interface BuildOptions {
  captureContent?: boolean;
  latencyThresholdMs?: number;
  providerFilter?: string;
  /** Defaults to true. Secrets and terminal escapes are always redacted. */
  redactPii?: boolean;
  /** Only pass this once the run is over, since it turns on marking unanswered tool calls. */
  exitCode?: number;
  stoppedByBudget?: boolean;
}

export { NO_RESPONSE_ERROR, NOT_RECORDED_ERROR };

export function buildTrace(
  rawCalls: RawHttpCall[],
  script: string,
  runtime: Runtime,
  command: string,
  startedAt: string,
  options: BuildOptions = {},
): Trace {
  const captureContent = options.captureContent !== false;

  const realCalls = rawCalls.filter((c) => !isCaptureLimitRecord(c) && isModelCall(c));

  // Interceptors write each call when it finishes, so sort by start time to get the real order.
  const filteredCalls = options.providerFilter
    ? realCalls.filter((c) => matchesProvider(c, options.providerFilter!))
    : realCalls;
  const sortedCalls = [...filteredCalls].sort((a, b) => a.startMs - b.startMs);

  const steps: Step[] = [];
  let stepId = 1;
  let contentBudget = CONTENT_BUDGET_CHARS;
  const redactionCache: RedactionCache = new Map();
  const toolResults = createToolResultLinker(options.redactPii !== false);
  const requestOf = new Map<Step, SentRequest>();
  const argKeys = new WeakMap<ToolCall, string>();

  for (const call of sortedCalls) {
    const budgetLeft = contentBudget > 0;
    const step = buildStep(call, stepId, captureContent && budgetLeft, options.redactPii !== false, redactionCache, argKeys);
    if (!step) continue;
    // With --filter the gaps between the remaining calls mean nothing, so leave offsets out.
    if (!options.providerFilter) step.offsetMs = call.startMs - sortedCalls[0].startMs;
    const responseId = unwrapResponsesApi(call.responseBody)?.id;
    requestOf.set(step, { body: call.requestBody, url: call.url, ...(typeof responseId === "string" ? { responseId } : {}) });
    if (step.type === "llm") toolResults.link(step, call.requestBody);

    if (captureContent && !budgetLeft && step.type === "llm") {
      // Mark it truncated, or empty content would look like the call had no conversation.
      step.content = { system: null, messages: [], output: null, truncated: true };
    }

    contentBudget -= contentCost(step);
    steps.push(step);
    stepId++;
  }

  const turnDigests = createTurnDigests(requestOf);
  markRetries(steps, requestOf, turnDigests);
  markConversations(steps, requestOf, turnDigests);
  if (options.exitCode !== undefined && !options.providerFilter && !rawCalls.some(isCaptureLimitRecord)) {
    markUnanswered(steps, toolResults.unreadable);
  }

  const firstStart = sortedCalls.length > 0 ? sortedCalls[0].startMs : Date.now();
  const lastEnd = sortedCalls.length > 0
    ? Math.max(...sortedCalls.map((c) => c.endMs))
    : firstStart;
  const durationMs = lastEnd - firstStart;

  const totalCostUsd = calculateTotalCost(steps);

  const summary = buildSummary(steps);

  const warnings = detectWarnings(
    steps,
    options.latencyThresholdMs,
    { exitCode: options.exitCode, stoppedByBudget: options.stoppedByBudget === true },
    { argKey: (call) => argKeys.get(call) },
  );

  const trace: Trace = {
    runId: generateRunId(startedAt),
    script,
    runtime,
    durationMs,
    totalCostUsd,
    steps,
    warnings,
    summary,
    startedAt,
    command,
  };
  if (typeof options.exitCode === "number") trace.exitCode = options.exitCode;
  return trace;
}

// About 8 MB. History is resent every turn, so saved content grows with the square of run length.
const CONTENT_BUDGET_CHARS = 8_000_000;

function contentCost(step: Step): number {
  if (step.type !== "llm" || !step.content) return 0;
  const c = step.content;
  let total = (c.system?.length ?? 0) + (c.output?.length ?? 0);
  for (const m of c.messages) total += m.content.length + m.role.length;
  return total;
}

export function matchesProvider(call: RawHttpCall, filter: string): boolean {
  try {
    return detectProvider(call.url).name.toLowerCase() === filter.toLowerCase();
  } catch {
    return false;
  }
}

// argKeys gets a digest of the raw arguments, because redaction can make two different calls look the same.
function redactToolCalls(toolCalls: ToolCall[], pii: boolean, argKeys?: WeakMap<ToolCall, string>): ToolCall[] {
  return toolCalls.map((tc) => {
    const call: ToolCall = {
      name: redactString(tc.name, pii),
      input: redactValue(tc.input, pii) as Record<string, unknown>,
    };
    // Ids are only used for matching, so plain ones skip redaction and anything else is dropped.
    if (typeof tc.id === "string" && TOOL_CALL_ID.test(tc.id)) call.id = tc.id;
    if (tc.invalidArguments) call.invalidArguments = true;
    if (argKeys) {
      try {
        argKeys.set(call, createHash("sha256").update(`${tc.name}\u0000${canonicalJson(tc.input)}`).digest("hex"));
      } catch {
        // Can't be serialized.
      }
    }
    return call;
  });
}

function canonicalJson(value: unknown, depth = 0): string {
  if (value === null || typeof value !== "object" || depth > 32) return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v, depth + 1)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k], depth + 1)}`)
    .join(",")}}`;
}

const TOOL_CALL_ID = /^[A-Za-z0-9_.:-]{1,200}$/;

// In characters, the same cap content-extractor uses for HTTP errors.
const TOOL_ERROR_MAX_CHARS = 500;

export interface FailedToolCall {
  step: LLMStep;
  call: ToolCall;
}

// Feed it every step in start order. An id used by two calls is ignored, because some
// servers number every call "0".
export function createToolResultLinker(redactPii: boolean) {
  const byId = new Map<string, FailedToolCall>();
  const reused = new Set<string>();
  const carrierOf = new Map<ToolCall, LLMStep>();
  const linked: ToolCall[] = [];
  let partialFrom = 0;
  const unreadable = new Set<LLMStep>();

  function sendsNowPartial(): void {
    for (; partialFrom < linked.length; partialFrom++) linked[partialFrom].result!.sendsPartial = true;
  }

  function register(step: LLMStep): void {
    for (const call of step.toolCalls) {
      if (!call.id || reused.has(call.id)) continue;
      const earlier = byId.get(call.id);
      if (!earlier) {
        byId.set(call.id, { step, call });
        continue;
      }
      reused.add(call.id);
      byId.delete(call.id);
      if (earlier.call.result) earlier.call.result.sendsPartial = true;
    }
  }

  function linkOne(hit: FailedToolCall, result: ToolResultBlock, step: LLMStep): boolean {
    const { call } = hit;
    if (call.result) {
      call.result.sends++;
      // Measure against the first request that has an input token count. A 429 has none.
      if (carrierOf.get(call)?.inputTokens == null && step.inputTokens != null) {
        call.result.stepId = step.id;
        carrierOf.set(call, step);
      }
    } else {
      const body = toolResultBody(result.content);
      call.result = { chars: body.length, tokens: estimateTokens(body, step.model).tokens, stepId: step.id, sends: 1 };
      carrierOf.set(call, step);
      linked.push(call);
    }
    if (!result.isError || call.error) return false;
    // Redact before truncating, or the cut could split a secret so it's no longer recognized.
    const text = redactString(toolResultText(result.content), redactPii);
    call.error = {
      message: text.length > TOOL_ERROR_MAX_CHARS ? text.slice(0, TOOL_ERROR_MAX_CHARS - 1) + "…" : text,
    };
    return true;
  }

  return {
    unreadable,
    /** Returns earlier calls that this request reports as failed for the first time. */
    link(step: LLMStep, requestBody: unknown): FailedToolCall[] {
      register(step);
      const found: FailedToolCall[] = [];
      let read: { results: ToolResultBlock[]; opaque: boolean };
      try {
        read = readToolResults(requestBody);
      } catch {
        read = { results: [], opaque: true };
      }
      if (read.opaque) {
        unreadable.add(step);
        sendsNowPartial();
      }
      const seenHere = new Set<string>();
      for (const result of read.results) {
        if (seenHere.has(result.toolUseId)) continue;
        seenHere.add(result.toolUseId);
        const hit = byId.get(result.toolUseId);
        if (!hit || hit.step === step) continue;
        try {
          if (linkOne(hit, result, step)) found.push(hit);
        } catch {
          // Too deep to serialize.
        }
      }
      return found;
    },
  };
}

// These APIs reject a tool result that doesn't name its call, so a missing result really is missing.
const RESULT_NAMES_ITS_CALL = new Set(["anthropic", "openai", "openrouter", "groq", "mistral", "cohere", "generic"]);

// Calls before a request we couldn't fully read are skipped, since their results may be in it.
function markUnanswered(steps: Step[], unreadable: Set<LLMStep>): void {
  let lastUnreadable = -1;
  const idUses = new Map<string, number>();
  steps.forEach((s, i) => {
    if (s.type !== "llm") return;
    const kind = s.error?.type;
    if (kind === NO_RESPONSE_ERROR || kind === NOT_RECORDED_ERROR || unreadable.has(s)) lastUnreadable = i;
    for (const call of s.toolCalls) if (call.id) idUses.set(call.id, (idUses.get(call.id) ?? 0) + 1);
  });
  steps.forEach((s, i) => {
    if (s.type !== "llm" || i < lastUnreadable || !RESULT_NAMES_ITS_CALL.has(s.provider)) return;
    for (const call of s.toolCalls) {
      if (call.id && idUses.get(call.id) === 1 && !call.result) call.unanswered = true;
    }
  });
}

// Keys are redacted too because they get printed. Past the depth limit the rest is redacted
// as JSON text, so deep nesting can't hide a secret.
function redactValue(value: unknown, pii: boolean, depth = 0): unknown {
  if (typeof value === "string") return redactString(value, pii);
  if (value === null || typeof value !== "object") return value;
  if (depth > 12) {
    try {
      return redactString(JSON.stringify(value) ?? "", pii);
    } catch {
      return "[unserializable]";
    }
  }
  if (Array.isArray(value)) return value.map((v) => redactValue(v, pii, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    // A key named __proto__ would set the prototype with a normal assignment.
    Object.defineProperty(out, redactString(k, pii), { value: redactValue(v, pii, depth + 1), enumerable: true, writable: true, configurable: true });
  }
  return out;
}

const MAX_USAGE_CHARS = 4_096;

function providerUsageOf(usage: Record<string, unknown> | null | undefined, pii: boolean): Record<string, unknown> | null {
  if (!usage) return null;
  try {
    if ((JSON.stringify(usage) ?? "").length > MAX_USAGE_CHARS) return null;
  } catch {
    return null;
  }
  return redactValue(usage, pii) as Record<string, unknown>;
}

// OpenAI's Responses API sends "error": null on success, so only an object counts.
function carriesError(body: unknown): boolean {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return false;
  const err = (body as Record<string, unknown>).error;
  return err !== null && typeof err === "object" && !Array.isArray(err);
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// Must match the regex in preload.cjs and sitecustomize.py.
const NOT_A_MODEL_CALL =
  /(?:\/count_tokens|\/input_tokens|:countTokens)\/?$|\/(?:files|uploads|batches)(?:\/|$)|\/moderations\/?$/i;

export function isModelCall(call: Pick<RawHttpCall, "url" | "method">): boolean {
  if (typeof call.method === "string" && call.method.toUpperCase() !== "POST") return false;
  return !NOT_A_MODEL_CALL.test(urlPath(call.url));
}

// LiteLLM price prefixes for hosts that charge differently from the plain model name.
const NAMESPACE_BY_HOST: [RegExp, string][] = [
  [/(?:^|\.)api\.groq\.com$/, "groq"],
  [/(?:^|\.)api\.mistral\.ai$/, "mistral"],
  [/(?:^|\.)generativelanguage\.googleapis\.com$/, "gemini"],
  [/(?:^|\.)aiplatform\.googleapis\.com$/, "vertex_ai"],
  [/(?:^|\.)api\.deepseek\.com$/, "deepseek"],
  [/(?:^|\.)api\.x\.ai$/, "xai"],
  [/(?:^|\.)api\.together\.(?:xyz|ai)$/, "together_ai"],
  [/(?:^|\.)api\.fireworks\.ai$/, "fireworks_ai"],
  [/(?:^|\.)api\.cerebras\.ai$/, "cerebras"],
];

export function pricingNamespace(provider: string, url: string): string | undefined {
  // Claude on Vertex costs the same as Claude, and the price lookup handles its @ model names.
  if (provider === "anthropic" || provider === "openai" || provider === "openrouter") return undefined;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  return NAMESPACE_BY_HOST.find(([re]) => re.test(host))?.[1];
}

const EMBEDDING_PATH = /\/(?:embeddings|embed)\/?$|:(?:embedContent|batchEmbedContents)$/i;

function urlPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return String(url).split(/[?#]/)[0];
  }
}

// Finish reasons that mean the final event never came. The last two are from the Responses API.
const UNFINISHED = new Set(["unknown", "in_progress", "queued"]);

/** The record the interceptors write when they hit the capture limit. */
export function isCaptureLimitRecord(call: RawHttpCall): boolean {
  return typeof call.url === "string" && call.url.startsWith("costcatch://");
}

function buildStep(
  call: RawHttpCall,
  id: number,
  captureContent: boolean,
  redactPii: boolean,
  redactionCache?: RedactionCache,
  argKeys?: WeakMap<ToolCall, string>,
): Step | null {
  try {
    const provider = detectProvider(call.url);
    const request = provider.parseRequest(call.requestBody, call.url);
    const parsed = provider.parseResponse(call.responseBody, request);
    const embedding = EMBEDDING_PATH.test(urlPath(call.url));
    // Embeddings have no output tokens, and leaving it null would make the call unpriced.
    if (embedding && parsed.inputTokens !== null && parsed.outputTokens === null) parsed.outputTokens = 0;
    const durationMs = call.endMs - call.startMs;
    const costUsd =
      parsed.reportedCostUsd ??
      calculateStepCost(
        parsed.model,
        parsed.inputTokens,
        parsed.outputTokens,
        parsed.cachedTokens,
        parsed.cacheWriteTokens,
        pricingNamespace(parsed.provider, call.url),
        parsed.billing,
      );

    const statusCode = call.statusCode;
    // The interceptors put an error object in a 2xx body when a stream errors or breaks off.
    const isError =
      (typeof statusCode === "number" && (statusCode < 200 || statusCode >= 300)) || carriesError(call.responseBody);
    const error = isError ? extractError(call.responseBody) : failureInBody(call.responseBody, parsed.finishReason);

    const llmStep: LLMStep = {
      type: "llm",
      id,
      durationMs,
      provider: parsed.provider,
      // The server controls these strings and they get printed, so redact them.
      model: oneLine(redactString(parsed.model, redactPii)),
      inputTokens: parsed.inputTokens,
      outputTokens: parsed.outputTokens,
      reasoningTokens: parsed.reasoningTokens,
      cachedTokens: parsed.cachedTokens,
      costUsd,
      providerUsage: providerUsageOf(parsed.usage, redactPii),
      toolCalls: redactToolCalls(parsed.toolCalls, redactPii, argKeys),
      isStreaming: parsed.isStreaming,
      finishReason: oneLine(redactString(parsed.finishReason, redactPii)),
      statusCode,
      error,
      content: captureContent
        ? extractContent(call.requestBody, call.responseBody, parsed.provider, {
            pii: redactPii,
            cache: redactionCache,
            url: call.url,
          })
        : null,
      retryOf: null,
    };
    if (embedding) llmStep.kind = "embedding";
    // Some SDKs abort right after [DONE], so only count an abort when the final event is missing.
    if (call.aborted === true && !error && UNFINISHED.has(llmStep.finishReason.toLowerCase())) llmStep.cancelled = true;

    return llmStep;
  } catch {
    return {
      type: "llm",
      id,
      durationMs: call.endMs - call.startMs,
      provider: "unknown",
      model: "unknown",
      inputTokens: null,
      outputTokens: null,
      cachedTokens: null,
      reasoningTokens: null,
      costUsd: null,
      toolCalls: [],
      isStreaming: false,
      finishReason: "unknown",
      statusCode: call.statusCode,
      error: null,
      content: null,
      retryOf: null,
    };
  }
}

interface SentRequest {
  body: unknown;
  url: string;
  responseId?: string;
}

// Compare requests as sent, since redacted, truncated content can make different ones look alike.
function markRetries(steps: Step[], requestOf: Map<Step, SentRequest>, turnDigests: TurnDigests): void {
  const shapeOf = new Map<Step, string>();
  const shapes = new Map<string, number>();
  for (const step of steps) {
    if (step.type !== "llm") continue;
    const shape = conversationShape(requestOf.get(step), (i) => turnDigests.of(step, i));
    if (shape === null) continue;
    shapeOf.set(step, shape);
    shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
  }

  // Link to the most recent copy, not the first, because the warning reports that copy's outcome.
  const seen = new Map<string, number>();
  for (const step of steps) {
    if (step.type !== "llm") continue;
    const shape = shapeOf.get(step);
    if (shape === undefined || (shapes.get(shape) ?? 0) < 2) continue;
    const fp = requestFingerprint(requestOf.get(step));
    if (fp === null) continue;
    const prior = seen.get(fp);
    if (prior !== undefined) step.retryOf = prior;
    seen.set(fp, step.id);
  }
}

const RESPONSES_PATH = /\/responses(?:[/?#]|$)/;

interface Turns {
  kind: "messages" | "contents" | "input" | "prompt";
  system: unknown;
  list: unknown[];
  text?: string;
}

function requestTurns(request: SentRequest | undefined): Turns | null {
  const body = request?.body;
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const req = body as Record<string, unknown>;
  const responses = RESPONSES_PATH.test(request!.url);
  if (Array.isArray(req.messages)) return { kind: "messages", system: req.system, list: req.messages };
  if (Array.isArray(req.contents)) return { kind: "contents", system: req.systemInstruction ?? req.system_instruction, list: req.contents };
  if (responses && Array.isArray(req.input)) return { kind: "input", system: req.instructions, list: req.input };
  if (responses && typeof req.input === "string") return { kind: "input", system: req.instructions, list: [req.input], text: req.input };
  // Ollama /api/generate and legacy completions send a single prompt string.
  if (typeof req.prompt === "string") return { kind: "prompt", system: req.system, list: [req.prompt], text: req.prompt };
  return null;
}

function conversationShape(request: SentRequest | undefined, turnDigest: (i: number) => string): string | null {
  const turns = requestTurns(request);
  if (turns === null) return null;
  const where = urlPath(request!.url);
  if (turns.text !== undefined) return `${where}::${turns.kind}:${turns.text.length}`;
  try {
    return `${where}::${turns.kind}:${turns.list.length}:${turnDigest(turns.list.length - 1)}`;
  } catch {
    return null;
  }
}

function createDigester(): (text: string) => string {
  const seen = new Map<string, string>();
  let held = 0;
  return (text) => {
    let d = seen.get(text);
    if (d === undefined) {
      d = createHash("sha256").update(text).digest("hex");
      if (held + text.length > 8_000_000) {
        seen.clear();
        held = 0;
      }
      seen.set(text, d);
      held += text.length;
    }
    return d;
  };
}

// SDKs move cache_control to the newest turn on every call, so drop it before comparing.
// String content is treated the same as a single text block.
function turnJson(turn: unknown): string {
  return (
    JSON.stringify(turn ?? null, function (this: unknown, key, value) {
      if (key === "cache_control") return undefined;
      if (key === "content" && typeof value === "string" && this !== null && typeof this === "object" && "role" in this) return [{ type: "text", text: value }];
      return value;
    }) ?? "null"
  );
}

function turnText(turn: unknown): string | null {
  if (typeof turn === "string") return turn;
  if (turn === null || typeof turn !== "object") return null;
  const t = turn as Record<string, unknown>;
  const pieces = Array.isArray(t.content) ? t.content : Array.isArray(t.parts) ? t.parts : typeof t.content === "string" ? [t.content] : null;
  if (!pieces) return null;
  return pieces.map((p) => (typeof p === "string" ? p : p !== null && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : "")).join("");
}

function firstExchangeTurn(list: unknown[]): number {
  const i = list.findIndex((t) => !(t !== null && typeof t === "object" && ["system", "developer"].includes(String((t as { role?: unknown }).role))));
  return i < 0 ? 0 : i;
}

interface TurnDigests {
  turns(step: Step): Turns | null;
  of(step: Step, i: number): string;
  text(value: string): string;
}

function createTurnDigests(requestOf: Map<Step, SentRequest>): TurnDigests {
  const text = createDigester();
  const turnsOf = new WeakMap<Step, Turns | null>();
  const done = new WeakMap<Step, Map<number, string>>();
  const turns = (step: Step) => {
    if (!turnsOf.has(step)) turnsOf.set(step, requestTurns(requestOf.get(step)));
    return turnsOf.get(step)!;
  };
  return {
    turns,
    text,
    of(step, i) {
      let byIndex = done.get(step);
      if (!byIndex) done.set(step, (byIndex = new Map()));
      let d = byIndex.get(i);
      if (d === undefined) byIndex.set(i, (d = text(turnJson(turns(step)!.list[i]))));
      return d;
    },
  };
}

interface ConversationTail {
  conversation: number;
  turns: number;
  lastDigest: string;
  prompt?: { length: number; digest: string };
}

// Delete before set so the entry moves to the end and the map stays in order of last use.
function remember(index: Map<string, Map<number, ConversationTail>>, key: string, tail: ConversationTail): void {
  const group = index.get(key) ?? new Map<number, ConversationTail>();
  group.delete(tail.conversation);
  group.set(tail.conversation, tail);
  index.set(key, group);
}

const latestFirst = (group: Map<number, ConversationTail> | undefined) => [...(group?.values() ?? [])].reverse();

// Splits calls into conversations so a router and its agent aren't measured as one growing context.
function markConversations(steps: Step[], requestOf: Map<Step, SentRequest>, turnDigests: TurnDigests): void {
  const digest = turnDigests.text;
  const byRoot = new Map<string, Map<number, ConversationTail>>();
  const byExchange = new Map<string, Map<number, ConversationTail>>();
  const byHead = new Map<string, Map<number, ConversationTail>>();
  const byResponse = new Map<string, number>();
  let next = 1;

  for (const step of steps) {
    if (step.type !== "llm" || step.kind === "embedding") continue;
    const request = requestOf.get(step);
    const turns = turnDigests.turns(step);
    if (turns === null || turns.list.length === 0) continue;
    const n = turns.list.length;
    const at = (i: number) => turnDigests.of(step, i);
    let system: string;
    let root: string;
    let exchange: string;
    try {
      system = digest(turnJson(turns.system ?? null));
      root = `${system}:${at(0)}`;
      exchange = at(firstExchangeTurn(turns.list));
    } catch {
      continue;
    }
    const lastText = n <= 2 ? turnText(turns.list[n - 1]) : null;
    const head = n <= 2 ? `${system}:${n === 2 ? at(0) : ""}` : null;
    const continues = (tail: ConversationTail) => n >= tail.turns && at(tail.turns - 1) === tail.lastDigest;

    let conversation: number | undefined;
    const previous = (request!.body as Record<string, unknown>).previous_response_id;
    if (typeof previous === "string") conversation = byResponse.get(previous);
    conversation ??= latestFirst(byRoot.get(root)).find(continues)?.conversation;
    // A changed system prompt only counts after the first answer, so a router's question doesn't match.
    conversation ??= latestFirst(byExchange.get(exchange)).find((tail) => tail.turns >= 2 && n > tail.turns && continues(tail))?.conversation;
    if (conversation === undefined && head !== null && lastText !== null) {
      conversation = latestFirst(byHead.get(head)).find(
        (tail) => tail.prompt !== undefined && lastText.length >= tail.prompt.length && digest(lastText.slice(0, tail.prompt.length)) === tail.prompt.digest,
      )?.conversation;
    }
    conversation ??= next++;
    step.conversation = conversation;

    const tail: ConversationTail = { conversation, turns: n, lastDigest: at(n - 1), ...(lastText !== null ? { prompt: { length: lastText.length, digest: digest(lastText) } } : {}) };
    remember(byRoot, root, tail);
    remember(byExchange, exchange, tail);
    if (head !== null) remember(byHead, head, tail);
    if (request!.responseId) byResponse.set(request!.responseId, conversation);
  }
}

// Include the path, since Gemini puts the model name there.
function requestFingerprint(request: SentRequest | undefined): string | null {
  const body = request?.body;
  if (body === null || body === undefined) return null;
  try {
    const sent =
      typeof body === "object" && !Array.isArray(body)
        ? Object.fromEntries(Object.entries(body as Record<string, unknown>).filter(([k]) => k !== "stream" && k !== "stream_options"))
        : body;
    return createHash("sha256").update(`${urlPath(request!.url)}\u0000${JSON.stringify(sent)}`).digest("hex");
  } catch {
    return null;
  }
}

// Round it, or three $0.10 calls add up to 0.30000000000000004 and fail --max-cost 0.30.
function calculateTotalCost(steps: Step[]): number | null {
  const total = totalCost(steps);
  return total === null ? null : roundUsd(total);
}

function buildSummary(steps: Step[]): TraceSummary {
  let llmCalls = 0;
  let toolCalls = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalReasoningTokens = 0;

  for (const step of steps) {
    if (step.type === "llm") {
      llmCalls++;
      totalInputTokens += step.inputTokens ?? 0;
      totalOutputTokens += step.outputTokens ?? 0;
      // Reasoning tokens are already part of outputTokens, so don't add them to a total.
      totalReasoningTokens += step.reasoningTokens ?? 0;
      toolCalls += step.toolCalls.length;
    } else if (step.type === "tool") {
      toolCalls++;
    }
  }

  const retry = computeRetryWaste(steps.filter((s): s is LLMStep => s.type === "llm"));

  return {
    llmCalls,
    toolCalls,
    totalInputTokens,
    totalOutputTokens,
    totalReasoningTokens,
    totalSteps: steps.length,
    retries: retry.retries,
    wastedCostUsd: retry.wastedCostUsd,
    unpricedCalls: countUnpriced(steps),
  };
}

// Every call in a retry chain except the last counts as wasted. Older traces point every
// retry at the original, which gives the same sum.
export function computeRetryWaste(llmSteps: LLMStep[]): { retries: number; wastedCostUsd: number } {
  const retrySteps = llmSteps.filter((st) => st.retryOf != null);
  if (retrySteps.length === 0) return { retries: 0, wastedCostUsd: 0 };

  const byTarget = new Map<number, LLMStep[]>();
  for (const st of retrySteps) {
    const chain = byTarget.get(st.retryOf as number) ?? [];
    chain.push(st);
    byTarget.set(st.retryOf as number, chain);
  }

  let wasted = 0;
  for (const [targetId, chain] of byTarget) {
    const target = llmSteps.find((st) => st.id === targetId);
    if (target) wasted += target.costUsd ?? 0;
    chain.sort((a, b) => a.id - b.id);
    for (const st of chain.slice(0, -1)) wasted += st.costUsd ?? 0;
  }

  return { retries: retrySteps.length, wastedCostUsd: wasted };
}

function generateRunId(isoTimestamp: string): string {
  return isoTimestamp
    .replace(/\.\d{3}Z$/, "")
    .replace(/:/g, "-");
}
