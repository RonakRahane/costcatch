/**
 * Content extractor.
 *
 * Pulls the *actual conversation* out of the captured request/response bodies:
 * the system prompt, the input messages, and the model's text output. This is
 * the data that turns costcatch from "counts" into "here's why it did that".
 *
 * Provider normalization strategy (per review feedback):
 *   - Native parsers for OpenAI and Anthropic (the two we own and test)
 *   - Google Gemini as a third since it uses a genuinely different schema
 *   - Everything else falls through the OpenAI-compatible path (choices[])
 *     with a generic fallback that dumps raw JSON if it doesn't parse cleanly
 *
 * All extracted text is secret-redacted and length-capped so saved traces stay
 * bounded and safe to share.
 */

import type { StepContent, StepMessage, StepError } from "../types/trace.js";
import { redactString } from "./redact.js";

/** Per-field truncation caps (characters). */
const CAP_SYSTEM = 8_000;
const CAP_MESSAGE = 4_000;
const CAP_OUTPUT = 8_000;

/**
 * Cap a string and report whether truncation happened.
 * Pure function — no module-level state.
 */
function cap(s: string, max: number): { text: string; wasTruncated: boolean } {
  if (s.length <= max) return { text: s, wasTruncated: false };
  return {
    text: s.slice(0, max) + `\n…[truncated ${s.length - max} chars]`,
    wasTruncated: true,
  };
}

/**
 * Coerce any message-content shape (string | content-block array | object)
 * into readable text. Handles OpenAI multimodal parts and Anthropic blocks.
 */
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
        else if (b.type === "image_url" || b.type === "image") parts.push("[image]");
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

/**
 * Extract the conversation from a request/response pair.
 *
 * `provider` selects the response-output shape; request shapes are near-universal
 * (messages[] for OpenAI-like, contents[] for Gemini, top-level system for Anthropic).
 *
 * Returns a StepContent with all fields redacted and truncated.
 */
export function extractContent(
  requestBody: unknown,
  responseBody: unknown,
  provider: string,
  options: { pii?: boolean } = {},
): StepContent {
  // Secrets and terminal escapes are ALWAYS scrubbed; only PII redaction is
  // opt-out (`--no-redact`), for users reading their own traces locally.
  const pii = options.pii !== false;
  const redact = (s: string) => redactString(s, pii);
  let truncated = false;

  const req = asRecord(requestBody);
  const res = asRecord(responseBody);

  // ── system ──
  let system: string | null = null;
  if (req) {
    if (req.system != null) {
      system = stringifyContent(req.system); // Anthropic top-level system
    } else if (Array.isArray(req.messages)) {
      const sys = (req.messages as unknown[]).find((m) => asRecord(m)?.role === "system");
      if (sys) system = stringifyContent(asRecord(sys)?.content);
    }
  }
  if (system) {
    const capped = cap(redact(system), CAP_SYSTEM);
    system = capped.text;
    if (capped.wasTruncated) truncated = true;
  }

  // ── input messages (excluding the system message) ──
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
  } else if (req && Array.isArray(req.contents)) {
    // Google Gemini: contents[].parts[].text
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
  }

  // ── model output text ──
  let output: string | null = null;
  if (res) {
    if (provider === "anthropic" && Array.isArray(res.content)) {
      output = stringifyContent(res.content);
    } else if (Array.isArray(res.choices)) {
      // OpenAI and OpenAI-compatible providers (Groq, Mistral, OpenRouter, etc.)
      const first = asRecord((res.choices as unknown[])[0]);
      if (first) {
        const inner = asRecord(first.message) ?? asRecord(first.delta);
        output = inner ? stringifyContent(inner.content) : null;
      }
    } else if (Array.isArray(res.candidates)) {
      // Google Gemini
      const cand = asRecord((res.candidates as unknown[])[0]);
      const contentRec = cand ? asRecord(cand.content) : null;
      output = contentRec ? stringifyContent(contentRec.parts) : null;
    }
  }
  if (output) {
    const capped = cap(redact(output), CAP_OUTPUT);
    output = capped.text;
    if (capped.wasTruncated) truncated = true;
  }

  return { system, messages, output: output || null, truncated };
}

/**
 * Extract a structured error from a non-2xx response body.
 * Handles OpenAI (`{error:{message,type,code}}`) and Anthropic
 * (`{type:"error",error:{type,message}}`) shapes, with a generic fallback.
 */
export function extractError(responseBody: unknown): StepError | null {
  const res = asRecord(responseBody);
  if (!res) {
    // Sometimes the body is a raw string (HTML error page etc.)
    if (typeof responseBody === "string" && responseBody.trim()) {
      return { type: null, message: redactString(responseBody.slice(0, 500)) };
    }
    return null;
  }

  const err = asRecord(res.error);
  if (err) {
    const message = typeof err.message === "string" ? err.message : JSON.stringify(err);
    const type = typeof err.type === "string" ? err.type : typeof err.code === "string" ? err.code : null;
    return { type, message: redactString(message.slice(0, 500)) };
  }

  // Some providers put the message at the top level.
  if (typeof res.message === "string") {
    return { type: typeof res.type === "string" ? res.type : null, message: redactString(res.message.slice(0, 500)) };
  }

  return { type: null, message: "non-2xx response (no error body)" };
}
