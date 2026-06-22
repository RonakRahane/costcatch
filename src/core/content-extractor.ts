// Pulls prompts, messages, output and errors out of provider bodies, redacted and cut to size.
import type { StepContent, StepMessage, StepError } from "../types/trace.js";
import { unwrapResponsesApi } from "../providers/base.js";
import { isAnthropicMessage } from "../providers/anthropic.js";
import { redactString } from "./redact.js";

// In characters.
const CAP_SYSTEM = 8_000;
const CAP_MESSAGE = 4_000;
const CAP_OUTPUT = 8_000;

function cap(s: string, max: number): { text: string; wasTruncated: boolean } {
  if (s.length <= max) return { text: s, wasTruncated: false };
  return {
    text: s.slice(0, max) + `\n…[truncated ${s.length - max} chars]`,
    wasTruncated: true,
  };
}

function stringifyContent(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (typeof block === "string") {
        parts.push(block);
      } else if (block && typeof block === "object") {
        const b = block as Record<string, unknown>;
        if (typeof b.text === "string") parts.push(b.text);
        else if (b.type === "image_url" || b.type === "image" || b.type === "input_image") parts.push("[image]");
        else if (b.type === "input_file") parts.push("[file]");
        else if (b.type === "input_audio") parts.push("[audio]");
        else if (b.type === "refusal" && typeof b.refusal === "string") parts.push(`[refusal] ${b.refusal}`);
        else if (b.type === "tool_result") parts.push(`[tool_result] ${stringifyContent(b.content)}`);
        else if (b.type === "tool_use") parts.push(`[tool_use ${String(b.name ?? "")}] ${JSON.stringify(b.input ?? {})}`);
        else parts.push(JSON.stringify(b));
      }
    }
    return parts.join("\n");
  }

  return JSON.stringify(content);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

// Embedding requests also have an input field, so the Responses API is recognized by its path or reply.
const RESPONSES_API_PATH = /\/responses(?:[/?#]|$)/;

// Hosted tool items are shown by type only, since some carry base64 images.
function responsesInputMessage(item: unknown): StepMessage | null {
  if (typeof item === "string") return { role: "user", content: item };
  const rec = asRecord(item);
  if (!rec) return null;
  const type = typeof rec.type === "string" ? rec.type : "message";

  switch (type) {
    case "message":
      return { role: String(rec.role ?? "user"), content: stringifyContent(rec.content) };
    case "function_call":
    case "custom_tool_call": {
      const args = type === "function_call" ? rec.arguments : rec.input;
      const text = typeof args === "string" ? args : JSON.stringify(args ?? {});
      return { role: "assistant", content: `[${type} ${String(rec.name ?? "")}] ${text}` };
    }
    case "function_call_output":
    case "custom_tool_call_output":
      return { role: "tool", content: stringifyContent(rec.output) };
    case "reasoning":
      return null;
    case "item_reference":
      return { role: "context", content: `[item_reference ${String(rec.id ?? "")}]` };
    default:
      return { role: type.endsWith("_output") ? "tool" : "assistant", content: `[${type}]` };
  }
}

function responsesSystem(req: Record<string, unknown>): string | null {
  const instructions = req.instructions;
  if (typeof instructions === "string") return instructions;
  if (Array.isArray(instructions)) {
    return instructions
      .map((item) => responsesInputMessage(item)?.content ?? "")
      .filter(Boolean)
      .join("\n");
  }
  if (Array.isArray(req.input)) {
    const sys = (req.input as unknown[]).find((m) => asRecord(m)?.role === "system");
    if (sys) return stringifyContent(asRecord(sys)?.content);
  }
  return null;
}

function responsesContinuation(req: Record<string, unknown>): string | null {
  if (typeof req.previous_response_id === "string" && req.previous_response_id) {
    return `continues stored response ${req.previous_response_id}`;
  }
  const conversation =
    typeof req.conversation === "string" ? req.conversation : asRecord(req.conversation)?.id;
  if (typeof conversation === "string" && conversation) return `continues conversation ${conversation}`;
  return null;
}

/** Use one per trace. History is resent every turn, so this saves redacting the same text again. */
export type RedactionCache = Map<string, string>;

const REDACTION_CACHE_MAX_ENTRIES = 4_096;

export function extractContent(
  requestBody: unknown,
  responseBody: unknown,
  provider: string,
  options: { pii?: boolean; cache?: RedactionCache; url?: string } = {},
): StepContent {
  // --no-redact only turns off PII redaction. Secrets and escapes are always removed.
  const pii = options.pii !== false;
  const cache = options.cache;
  const redact = (s: string) => {
    if (!cache) return redactString(s, pii);
    if (s.length < 64) return redactString(s, pii);
    const hit = cache.get(s);
    if (hit !== undefined) return hit;
    const out = redactString(s, pii);
    if (cache.size < REDACTION_CACHE_MAX_ENTRIES) cache.set(s, out);
    return out;
  };
  let truncated = false;

  const req = asRecord(requestBody);
  const res = asRecord(responseBody);
  const responsesBody = unwrapResponsesApi(responseBody);
  const isResponsesApi =
    responsesBody !== null || (options.url !== undefined && RESPONSES_API_PATH.test(options.url));

  let system: string | null = null;
  if (req) {
    if (req.system != null) {
      system = stringifyContent(req.system);
    } else if (req.systemInstruction != null) {
      const si = asRecord(req.systemInstruction);
      system = stringifyContent(si?.parts ?? req.systemInstruction);
    } else if (Array.isArray(req.messages)) {
      const sys = (req.messages as unknown[]).find((m) => asRecord(m)?.role === "system");
      if (sys) system = stringifyContent(asRecord(sys)?.content);
    } else if (isResponsesApi) {
      system = responsesSystem(req);
    }
  }
  if (system) {
    const capped = cap(redact(system), CAP_SYSTEM);
    system = capped.text;
    if (capped.wasTruncated) truncated = true;
  }

  const messages: StepMessage[] = [];
  if (req && Array.isArray(req.messages)) {
    for (const m of req.messages as unknown[]) {
      const rec = asRecord(m);
      if (!rec || rec.role === "system") continue;
      const capped = cap(redact(stringifyContent(rec.content)), CAP_MESSAGE);
      if (capped.wasTruncated) truncated = true;
      messages.push({
        role: String(rec.role ?? "user"),
        content: capped.text,
      });
    }
  } else if (req && Array.isArray(req.chat_history)) {
    // Cohere v1
    for (const entry of req.chat_history as unknown[]) {
      const rec = asRecord(entry);
      if (!rec) continue;
      const capped = cap(redact(stringifyContent(rec.message ?? rec.content)), CAP_MESSAGE);
      if (capped.wasTruncated) truncated = true;
      messages.push({ role: String(rec.role ?? "user").toLowerCase(), content: capped.text });
    }
    if (typeof req.message === "string") {
      const capped = cap(redact(req.message), CAP_MESSAGE);
      if (capped.wasTruncated) truncated = true;
      messages.push({ role: "user", content: capped.text });
    }
  } else if (req && Array.isArray(req.contents)) {
    for (const entry of req.contents as unknown[]) {
      const rec = asRecord(entry);
      if (!rec) continue;
      const capped = cap(redact(stringifyContent(rec.parts)), CAP_MESSAGE);
      if (capped.wasTruncated) truncated = true;
      messages.push({
        role: String(rec.role ?? "user"),
        content: capped.text,
      });
    }
  } else if (req && isResponsesApi) {
    const continuation = responsesContinuation(req);
    if (continuation) messages.push({ role: "context", content: cap(redact(continuation), CAP_MESSAGE).text });
    const items =
      typeof req.input === "string" ? [req.input] : Array.isArray(req.input) ? (req.input as unknown[]) : [];
    for (const item of items) {
      const message = responsesInputMessage(item);
      if (!message || message.role === "system") continue;
      const capped = cap(redact(message.content), CAP_MESSAGE);
      if (capped.wasTruncated) truncated = true;
      messages.push({ role: message.role, content: capped.text });
    }
  }

  let output: string | null = null;
  if (responsesBody) {
    const texts: string[] = [];
    for (const item of Array.isArray(responsesBody.output) ? (responsesBody.output as unknown[]) : []) {
      const rec = asRecord(item);
      if (rec?.type === "message") texts.push(stringifyContent(rec.content));
    }
    output = texts.filter(Boolean).join("\n") || null;
  } else if (res) {
    // Also check the shape, since gateways and Claude on Vertex return this format under other providers.
    if (Array.isArray(res.content) && (provider === "anthropic" || isAnthropicMessage(res))) {
      output = stringifyContent(res.content);
    } else if (Array.isArray(res.choices)) {
      const first = asRecord((res.choices as unknown[])[0]);
      if (first) {
        const inner = asRecord(first.message) ?? asRecord(first.delta);
        output = inner ? stringifyContent(inner.content) : null;
      }
    } else if (Array.isArray(res.candidates)) {
      const cand = asRecord((res.candidates as unknown[])[0]);
      const contentRec = cand ? asRecord(cand.content) : null;
      output = contentRec ? stringifyContent(contentRec.parts) : null;
    } else if (res.message != null) {
      // Ollama puts the assistant turn at the top level.
      output = stringifyContent(asRecord(res.message)?.content ?? res.message);
    } else if (typeof res.text === "string") {
      // Cohere Chat v2
      output = res.text;
    }
  }
  if (output) {
    const capped = cap(redact(output), CAP_OUTPUT);
    output = capped.text;
    if (capped.wasTruncated) truncated = true;
  }

  return { system, messages, output: output || null, truncated };
}

/** The content is not redacted yet. */
export interface ToolResultBlock {
  toolUseId: string;
  content: unknown;
  /** Only Anthropic sends is_error, so this is always false for other providers. */
  isError: boolean;
}

/** opaque is true when some results can't be matched to a call, so a missing result proves nothing. */
export function readToolResults(requestBody: unknown): { results: ToolResultBlock[]; opaque: boolean } {
  const req = asRecord(requestBody);
  if (!req) return { results: [], opaque: true };
  const results: ToolResultBlock[] = [];
  let opaque = false;
  if (Array.isArray(req.messages)) {
    for (const message of req.messages as unknown[]) {
      const m = asRecord(message);
      if (!m) continue;
      if (m.role === "tool") {
        if (typeof m.tool_call_id === "string") results.push({ toolUseId: m.tool_call_id, content: m.content, isError: false });
        else opaque = true;
        continue;
      }
      if (!Array.isArray(m.content)) continue;
      for (const block of m.content) {
        const b = asRecord(block);
        if (b?.type !== "tool_result") continue;
        if (typeof b.tool_use_id === "string") results.push({ toolUseId: b.tool_use_id, content: b.content, isError: b.is_error === true });
        else opaque = true;
      }
    }
  }
  if (Array.isArray(req.input)) {
    for (const item of req.input as unknown[]) {
      const i = asRecord(item);
      if (i?.type !== "function_call_output" && i?.type !== "custom_tool_call_output") continue;
      if (typeof i.call_id === "string") results.push({ toolUseId: i.call_id, content: i.output, isError: false });
      else opaque = true;
    }
  }
  if (Array.isArray(req.contents)) {
    for (const entry of req.contents as unknown[]) {
      const parts = asRecord(entry)?.parts;
      if (!Array.isArray(parts)) continue;
      for (const part of parts) {
        const fr = asRecord(asRecord(part)?.functionResponse);
        if (!fr) continue;
        if (typeof fr.id === "string") results.push({ toolUseId: fr.id, content: fr.response, isError: false });
        else opaque = true;
      }
    }
  }
  return { results, opaque };
}

export function toolResultsIn(requestBody: unknown): ToolResultBlock[] {
  return readToolResults(requestBody).results;
}

const BINARY_BLOCKS = new Set(["image", "document", "file", "audio", "image_url", "input_image", "input_file", "input_audio"]);

// Files, images and audio become placeholders, or their base64 would make a PDF look like 100k tokens.
export function toolResultBody(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return measurable(content);
  return content.map(measurable).join("\n");
}

function measurable(part: unknown): string {
  if (typeof part === "string") return part;
  const p = asRecord(part);
  if (!p) return part == null ? "" : String(part);
  if (typeof p.text === "string") return p.text;
  const type = typeof p.type === "string" ? p.type : "";
  const source = asRecord(p.source);
  const binary =
    BINARY_BLOCKS.has(type) ||
    source?.type === "base64" ||
    typeof p.inline_data === "object" ||
    typeof p.inlineData === "object";
  if (binary) return `[${type || "file"}]`;
  return JSON.stringify(part) ?? "";
}

export function toolResultText(content: unknown): string {
  return stringifyContent(content).replace(/\s+/g, " ").trim();
}

export function extractError(responseBody: unknown): StepError | null {
  const res = asRecord(responseBody);
  if (!res) {
    if (typeof responseBody === "string" && responseBody.trim()) {
      return { type: null, message: redactString(responseBody).slice(0, 500) };
    }
    return null;
  }

  const err = asRecord(res.error);
  if (err) {
    const message = typeof err.message === "string" ? err.message : JSON.stringify(err);
    const rawType = typeof err.type === "string" ? err.type : typeof err.code === "string" ? err.code : null;
    // The server controls the type too and it gets printed, so redact it like the message.
    const type = rawType === null ? null : redactString(rawType).slice(0, 120);
    return { type, message: redactString(message).slice(0, 500) };
  }

  if (typeof res.message === "string") {
    const topType = typeof res.type === "string" ? redactString(res.type).slice(0, 120) : null;
    return { type: topType, message: redactString(res.message).slice(0, 500) };
  }

  return { type: null, message: "non-2xx response (no error body)" };
}

// Finds a failure reported inside a 2xx body, such as a Responses API stream that ends in
// response.failed or error, or finish_reason "error" from OpenRouter or Cohere.
export function failureInBody(responseBody: unknown, finishReason: string): StepError | null {
  const res = asRecord(responseBody);
  if (!res) return null;
  const clean = (type: unknown, message: unknown, fallback: string): StepError => ({
    type: typeof type === "string" ? redactString(type).slice(0, 120) : null,
    message: redactString(typeof message === "string" ? message : fallback).slice(0, 500),
  });
  if (res.type === "error" && typeof res.message === "string" && !asRecord(res.error)) {
    return clean(res.code, res.message, "");
  }
  const response = unwrapResponsesApi(responseBody);
  if (response?.status === "failed") {
    const err = asRecord(response.error);
    return clean(err?.code, err?.message, "the response failed");
  }
  if (finishReason.toLowerCase() === "error") {
    const choice = Array.isArray(res.choices) ? asRecord(res.choices[0]) : null;
    const err = asRecord(choice?.error);
    return clean(null, err?.message, 'the response ended with finish_reason "error"');
  }
  return null;
}
