/**
 * Node.js HTTP interceptor — preload script.
 *
 * Loaded via `node --require <this-file>` BEFORE any user code. It patches
 * `http`/`https` request+get and `globalThis.fetch` to observe LLM API calls and
 * append them, one JSON object per line, to the NDJSON file named by
 * `COSTCATCH_OUTPUT`.
 *
 * ── The one rule ───────────────────────────────────────────────────────────
 * This file is PURELY OBSERVATIONAL. If anything here fails, the user's program
 * must still run, still see byte-identical responses, and still exit with its
 * own status code. Every patched path is wrapped so an internal error degrades
 * to "we captured nothing" rather than "we broke your agent".
 *
 * ── Contract ───────────────────────────────────────────────────────────────
 * The env var names below are duplicated from src/core/constants.ts (this file
 * is CommonJS shipped as a runtime asset and cannot import TypeScript).
 * tests/unit/core/constants.test.ts asserts they stay in sync.
 *
 * CRITICAL: CommonJS (.cjs) — `--require` does not accept ESM.
 */

"use strict";

// ── Contract with src/core/constants.ts ────────────────────────────────────
const ENV_OUTPUT = "COSTCATCH_OUTPUT";
const ENV_ACTIVE = "COSTCATCH_ACTIVE";
const ENV_MAX_BODY_BYTES = "COSTCATCH_MAX_BODY_BYTES";
const ENV_MAX_TRACE_BYTES = "COSTCATCH_MAX_TRACE_BYTES";
const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_TRACE_BYTES = 64 * 1024 * 1024;

const TRACE_OUTPUT = process.env[ENV_OUTPUT];

// No output path means we were not launched by costcatch. Do nothing at all —
// `--require` may legitimately be inherited by unrelated child processes.
if (!TRACE_OUTPUT) return;

// Guard against double-installation. `--require` is inherited through
// NODE_OPTIONS by grandchild processes, and re-patching an already-patched
// `request` would double-count every call and nest the wrappers.
if (globalThis.__costcatchInstalled) return;
globalThis.__costcatchInstalled = true;

const https = require("https");
const http = require("http");
const fs = require("fs");

/** Positive integer from the environment, or the supplied default. */
function envInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const MAX_BODY_BYTES = envInt(ENV_MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES);
const MAX_TRACE_BYTES = envInt(ENV_MAX_TRACE_BYTES, DEFAULT_MAX_TRACE_BYTES);

// Marks the traced process for any tooling that wants to know it is observed.
process.env[ENV_ACTIVE] = "1";

// ---------------------------------------------------------------------------
// URL matching
// ---------------------------------------------------------------------------

/** URL patterns that indicate an LLM API call. Mirrors src/providers/*. */
const LLM_PATTERNS = [
  /api\.openai\.com/,
  /\.openai\.azure\.com/,
  /api\.anthropic\.com/,
  /openrouter\.ai/,
  /api\.groq\.com/,
  /api\.mistral\.ai/,
  /generativelanguage\.googleapis\.com/,
  /aiplatform\.googleapis\.com/,
  /api\.cohere\.com/,
  /api\.cohere\.ai/,
  /:11434(?:\/|$)/,
  /\/chat\/completions/,
  /\/v1\/messages/,
  /\/v1\/complete\b/,
  /\/v1\/responses\b/,
  /:generateContent/,
  /:streamGenerateContent/,
  /\/api\/(?:chat|generate)\b/,
];

function isLLMCall(urlStr) {
  for (let i = 0; i < LLM_PATTERNS.length; i++) {
    if (LLM_PATTERNS[i].test(urlStr)) return true;
  }
  return false;
}

/** Best-effort provider name from a URL host. */
function guessProvider(urlStr) {
  const u = String(urlStr);
  if (u.includes("openai.azure.com")) return "azure";
  if (u.includes("api.openai.com")) return "openai";
  if (u.includes("anthropic.com")) return "anthropic";
  if (u.includes("openrouter.ai")) return "openrouter";
  if (u.includes("groq.com")) return "groq";
  if (u.includes("mistral.ai")) return "mistral";
  if (u.includes("googleapis.com")) return "google";
  if (u.includes(":11434")) return "ollama";
  if (u.includes("cohere.com") || u.includes("cohere.ai")) return "cohere";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

// Monotonic id correlating a "start" marker with its completion record.
//
// Seeded from the pid because COSTCATCH_OUTPUT is inherited by grandchild
// processes (a Python agent that shells out to another traced process appends
// to the same NDJSON file). A plain 1,2,3… counter would collide across
// processes and pair one process's "start" with another's completion.
let seqId = (process.pid % 100000) * 1000000;
function nextId() {
  return ++seqId;
}

/** Bytes appended so far — the whole-trace ceiling is enforced against this. */
let bytesWritten = 0;
let limitNotified = false;

/**
 * Append one record to the NDJSON output file.
 *
 * Synchronous by design: the traced process can exit at any moment (including
 * via `process.exit()`, which skips pending async I/O), and a record that never
 * reached disk is a call the user never sees. Payloads are already capped, so
 * each write is small and bounded.
 */
function writeCall(callData) {
  try {
    if (bytesWritten >= MAX_TRACE_BYTES) {
      if (limitNotified) return;
      limitNotified = true;
      callData = {
        phase: "end",
        id: nextId(),
        url: "costcatch://capture-limit",
        method: "GET",
        requestBody: null,
        responseBody: {
          error: {
            message:
              "costcatch: capture limit reached (" +
              MAX_TRACE_BYTES +
              " bytes); later calls in this run were not recorded",
          },
        },
        statusCode: 0,
        startMs: Date.now(),
        endMs: Date.now(),
        isStreaming: false,
      };
    }
    const line = JSON.stringify(callData) + "\n";
    bytesWritten += Buffer.byteLength(line, "utf-8");
    fs.appendFileSync(TRACE_OUTPUT, line, "utf-8");
  } catch {
    // Non-critical: a trace we cannot write must never fail the user's program.
  }
}

/** Best-effort model name from a (possibly unparsed) request body. */
function extractModel(reqBody) {
  try {
    const parsed = typeof reqBody === "string" ? JSON.parse(reqBody) : reqBody;
    if (parsed && typeof parsed === "object" && typeof parsed.model === "string") {
      return parsed.model;
    }
  } catch {
    // not JSON, or no model field — the live UI falls back to the provider name
  }
  return null;
}

/** Emit a lightweight "start" marker so the live UI can show an in-flight call. */
function writeStart(id, url, reqBody, startMs) {
  writeCall({
    phase: "start",
    id,
    url,
    model: extractModel(reqBody),
    provider: guessProvider(url),
    startMs,
  });
}

/** Emit a completion record for a request that never produced a response. */
function writeTransportError(id, url, method, requestBody, startMs, err) {
  writeCall({
    phase: "end",
    id,
    url,
    method,
    requestBody: safeJsonParse(requestBody),
    responseBody: { error: { type: "transport_error", message: String((err && err.message) || err) } },
    statusCode: 0,
    startMs,
    endMs: Date.now(),
    isStreaming: false,
  });
}

// ---------------------------------------------------------------------------
// Bounded body accumulator
// ---------------------------------------------------------------------------

/**
 * Collects response bytes up to MAX_BODY_BYTES and then stops.
 *
 * Without a ceiling, a single misclassified endpoint streaming hundreds of
 * megabytes would grow the traced process's heap until it OOMs — a tracer
 * killing the program it observes is the worst possible failure mode.
 */
function createBodyBuffer() {
  const chunks = [];
  let size = 0;
  let truncated = false;

  return {
    push(chunk) {
      if (truncated) return;
      try {
        // `fetch` hands us Uint8Array chunks and `http` hands us Buffers.
        // `Buffer.from(String(uint8))` would produce the literal text
        // "123,34,105,..." — a silently corrupted body that parses as neither
        // JSON nor SSE, so every streamed fetch captured zero usage data.
        const buf = Buffer.isBuffer(chunk)
          ? chunk
          : ArrayBuffer.isView(chunk)
            ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
            : chunk instanceof ArrayBuffer
              ? Buffer.from(chunk)
              : Buffer.from(String(chunk), "utf-8");
        const room = MAX_BODY_BYTES - size;
        if (buf.length >= room) {
          chunks.push(buf.subarray(0, Math.max(0, room)));
          size = MAX_BODY_BYTES;
          truncated = true;
        } else {
          chunks.push(buf);
          size += buf.length;
        }
      } catch {
        truncated = true;
      }
    },
    text() {
      try {
        return Buffer.concat(chunks).toString("utf-8");
      } catch {
        return "";
      }
    },
    get truncated() {
      return truncated;
    },
  };
}

// ---------------------------------------------------------------------------
// http / https patching
// ---------------------------------------------------------------------------

/**
 * Normalize Node's overloaded request signatures into one shape.
 *
 * Supported forms (per the Node docs):
 *   request(options[, callback])
 *   request(url[, options][, callback])
 */
function normalizeArgs(a, b, c) {
  let urlArg = null;
  let options = {};
  let callback;

  if (typeof a === "string" || a instanceof URL) {
    urlArg = a;
    if (typeof b === "function") {
      callback = b;
    } else {
      if (b && typeof b === "object") options = b;
      if (typeof c === "function") callback = c;
    }
  } else {
    if (a && typeof a === "object") options = a;
    if (typeof b === "function") callback = b;
    else if (typeof c === "function") callback = c;
  }

  return { urlArg, options, callback };
}

/** Build an absolute URL string from normalized request arguments. */
function buildUrl(urlArg, options, defaultProtocol) {
  if (urlArg) {
    const base = typeof urlArg === "string" ? urlArg : urlArg.toString();
    // `request(url, options)` lets options.path override the URL's path.
    if (options && typeof options.path === "string") {
      try {
        const parsed = new URL(base);
        return parsed.origin + options.path;
      } catch {
        return base;
      }
    }
    return base;
  }

  const protocol = (options && options.protocol) || defaultProtocol || "https:";
  const host = (options && (options.hostname || options.host)) || "localhost";
  const port = options && options.port ? ":" + options.port : "";
  const p = (options && options.path) || "/";
  return protocol + "//" + host + port + p;
}

function patchModule(mod, defaultProtocol) {
  const originalRequest = mod.request;
  const originalGet = mod.get;

  function patchedRequest(a, b, c) {
    let url;
    let norm;
    try {
      norm = normalizeArgs(a, b, c);
      url = buildUrl(norm.urlArg, norm.options, defaultProtocol);
    } catch {
      return originalRequest.call(this, a, b, c);
    }

    if (!isLLMCall(url)) {
      return originalRequest.call(this, a, b, c);
    }

    const startMs = Date.now();
    const id = nextId();
    const method = String((norm.options && norm.options.method) || "POST").toUpperCase();
    let requestBody = "";
    let startEmitted = false;
    let completed = false;

    let req;
    try {
      req = originalRequest.call(this, a, b, c);
    } catch (err) {
      // The original threw synchronously (bad options) — record nothing extra
      // and let the user's error surface unchanged.
      throw err;
    }

    // Capture the outgoing body by wrapping write/end.
    try {
      const originalWrite = req.write;
      req.write = function (data, encoding, cb) {
        try {
          if (data && requestBody.length < MAX_BODY_BYTES) requestBody += data.toString();
        } catch {
          // unreadable chunk — capture what we have
        }
        return originalWrite.call(this, data, encoding, cb);
      };

      const originalEnd = req.end;
      req.end = function (data, encoding, cb) {
        try {
          if (data && typeof data !== "function" && requestBody.length < MAX_BODY_BYTES) {
            requestBody += data.toString();
          }
        } catch {
          // ignore
        }
        if (!startEmitted) {
          startEmitted = true;
          writeStart(id, url, requestBody, startMs);
        }
        return originalEnd.call(this, data, encoding, cb);
      };
    } catch {
      // If we cannot wrap the writers we still observe the response below.
    }

    // A request that never gets a response still belongs in the trace: a DNS
    // failure or connection reset is exactly the kind of thing users are
    // debugging when they reach for a tracer.
    //
    // Attaching a listener suppresses Node's "unhandled 'error' event throws"
    // behaviour, so we restore it when we are the ONLY listener — otherwise
    // installing costcatch would silently turn a crash into a hang.
    req.on("error", (err) => {
      if (!completed) {
        completed = true;
        writeTransportError(id, url, method, requestBody, startMs, err);
      }
      if (req.listenerCount("error") <= 1) {
        process.nextTick(() => {
          throw err;
        });
      }
    });

    req.on("response", (res) => {
      const body = createBodyBuffer();

      res.on("data", (chunk) => body.push(chunk));
      res.on("error", (err) => {
        if (!completed) {
          completed = true;
          writeTransportError(id, url, method, requestBody, startMs, err);
        }
        if (res.listenerCount("error") <= 1) {
          process.nextTick(() => {
            throw err;
          });
        }
      });
      res.on("end", () => {
        if (completed) return;
        completed = true;
        try {
          const text = body.text();
          const contentType = res.headers["content-type"] || "";
          const isSSE = contentType.includes("text/event-stream") || text.startsWith("data:") || text.includes("\ndata: ");

          writeCall({
            phase: "end",
            id,
            url,
            method,
            requestBody: safeJsonParse(requestBody),
            responseBody: isSSE ? parseSSEResponse(text) : safeJsonParse(text),
            statusCode: res.statusCode,
            startMs,
            endMs: Date.now(),
            isStreaming: isSSE,
            bodyTruncated: body.truncated || undefined,
          });
        } catch {
          // Never let a capture error escape into the user's stream handlers.
        }
      });
    });

    return req;
  }

  mod.request = patchedRequest;

  // `http.get`/`https.get` close over the module-local `request`, so patching
  // `mod.request` alone does NOT cover them. Re-implement get on top of our
  // patched request (this is exactly what Node's own implementation does).
  if (typeof originalGet === "function") {
    mod.get = function patchedGet(a, b, c) {
      const req = patchedRequest.call(this, a, b, c);
      req.end();
      return req;
    };
  }
}

try {
  patchModule(https, "https:");
  patchModule(http, "http:");
} catch {
  // If patching fails the user's script runs completely unmodified.
}

// ---------------------------------------------------------------------------
// globalThis.fetch (Node 18+)
// ---------------------------------------------------------------------------

if (typeof globalThis.fetch === "function") {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async function patchedFetch(input, init) {
    let url;
    try {
      url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input && typeof input.url === "string"
              ? input.url
              : "";
    } catch {
      return originalFetch.call(this, input, init);
    }

    if (!url || !isLLMCall(url)) {
      return originalFetch.call(this, input, init);
    }

    const startMs = Date.now();
    const id = nextId();
    const method = String((init && init.method) || (input && input.method) || "POST").toUpperCase();

    // Read the outgoing body without consuming it for the real fetch. A string
    // body is free to read; a Request body is a one-shot stream, so we clone
    // first and read the clone.
    let requestBody = null;
    let requestClone = input;
    try {
      if (init && typeof init.body === "string") {
        requestBody = init.body;
      } else if (init && init.body && typeof init.body.toString === "function" && !(init.body instanceof ReadableStream)) {
        requestBody = init.body.toString();
      } else if (!init?.body && input && typeof input.clone === "function" && typeof input.text === "function") {
        // A Request object: clone so the original body stays unread.
        requestClone = input;
        const bodyClone = input.clone();
        requestBody = await bodyClone.text().catch(() => null);
      }
    } catch {
      // Body unreadable — continue without it rather than failing the call.
    }

    writeStart(id, url, requestBody, startMs);

    let response;
    try {
      response = await originalFetch.call(this, requestClone, init);
    } catch (err) {
      writeTransportError(id, url, method, requestBody, startMs, err);
      throw err;
    }

    // Clone so the user's code still owns an unread body. `clone()` throws if
    // the body was already consumed — in that case we record what we know
    // without the payload rather than interfering.
    let clonedResponse = null;
    try {
      clonedResponse = response.clone();
    } catch {
      clonedResponse = null;
    }

    if (!clonedResponse) {
      writeCall({
        phase: "end",
        id,
        url,
        method,
        requestBody: safeJsonParse(requestBody),
        responseBody: null,
        statusCode: response.status,
        startMs,
        endMs: Date.now(),
        isStreaming: false,
      });
      return response;
    }

    // Drain the clone in the background so we never delay the user's code.
    void (async () => {
      try {
        const text = await readBounded(clonedResponse);
        const contentType = response.headers.get("content-type") || "";
        const isSSE =
          contentType.includes("text/event-stream") || text.text.startsWith("data:") || text.text.includes("\ndata: ");

        writeCall({
          phase: "end",
          id,
          url,
          method,
          requestBody: safeJsonParse(requestBody),
          responseBody: isSSE ? parseSSEResponse(text.text) : safeJsonParse(text.text),
          statusCode: response.status,
          startMs,
          endMs: Date.now(),
          isStreaming: isSSE,
          bodyTruncated: text.truncated || undefined,
        });
      } catch {
        // Swallow — a capture failure is never the user's problem.
      }
    })();

    return response;
  };
}

/** Read a Response body with the same ceiling the stream path enforces. */
async function readBounded(res) {
  const buffer = createBodyBuffer();
  try {
    if (res.body && typeof res.body.getReader === "function") {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer.push(value);
        if (buffer.truncated) {
          try {
            await reader.cancel();
          } catch {
            // already closed
          }
          break;
        }
      }
    } else {
      buffer.push(await res.text());
    }
  } catch {
    // partial body is still worth reporting
  }
  return { text: buffer.text(), truncated: buffer.truncated };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fold an SSE stream back into a single response object our providers can parse.
 *
 * Handles both wire formats: OpenAI-style `choices[].delta` chunks with usage in
 * the final frame, and Anthropic-style typed events (`message_start`,
 * `content_block_delta`, `message_delta`).
 */
function parseSSEResponse(body) {
  const lines = body.split("\n");
  let lastData = null;
  let accumulatedContent = "";
  let usage = null;
  let model = null;
  let finishReason = null;
  const toolCalls = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;

    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      continue; // partial or non-JSON frame
    }
    lastData = parsed;

    if (parsed.model) model = parsed.model;

    // ── OpenAI-compatible ──
    if (parsed.choices && parsed.choices[0]) {
      const choice = parsed.choices[0];
      const delta = choice.delta;
      if (delta) {
        if (delta.content) accumulatedContent += delta.content;
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = typeof tc.index === "number" ? tc.index : toolCalls.length;
            if (!toolCalls[idx]) toolCalls[idx] = { function: { name: "", arguments: "" } };
            if (tc.function && tc.function.name) toolCalls[idx].function.name += tc.function.name;
            if (tc.function && tc.function.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
          }
        }
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }
    if (parsed.usage) usage = parsed.usage;

    // ── Anthropic ──
    if (parsed.type === "message_start" && parsed.message) {
      if (parsed.message.model) model = parsed.message.model;
      if (parsed.message.usage) {
        usage = usage || {};
        usage.input_tokens = parsed.message.usage.input_tokens;
        if (parsed.message.usage.cache_read_input_tokens != null) {
          usage.cache_read_input_tokens = parsed.message.usage.cache_read_input_tokens;
        }
      }
    }
    if (parsed.type === "content_block_delta" && parsed.delta && parsed.delta.text) {
      accumulatedContent += parsed.delta.text;
    }
    if (parsed.type === "message_delta") {
      if (parsed.usage) {
        usage = usage || {};
        if (parsed.usage.output_tokens != null) usage.output_tokens = parsed.usage.output_tokens;
      }
      if (parsed.delta && parsed.delta.stop_reason) finishReason = parsed.delta.stop_reason;
    }
  }

  if (usage) {
    const message = { content: accumulatedContent, role: "assistant" };
    const compacted = toolCalls.filter(Boolean);
    if (compacted.length > 0) message.tool_calls = compacted;

    return {
      model,
      usage,
      choices: [{ message, finish_reason: finishReason || "stop" }],
      // Anthropic-shaped mirror so either provider parser finds what it needs.
      content: [{ type: "text", text: accumulatedContent }],
      stop_reason: finishReason,
    };
  }

  // No usage frame (e.g. OpenAI streaming without stream_options.include_usage).
  if (lastData) return lastData;
  return { _raw: "streaming_response", _warning: "usage_unavailable" };
}

/** Parse JSON, falling back to a length-capped raw string. */
function safeJsonParse(str) {
  if (str === null || str === undefined) return null;
  if (typeof str !== "string") return str;
  try {
    return JSON.parse(str);
  } catch {
    return str.length > 4096 ? str.slice(0, 4096) + "…[truncated]" : str;
  }
}
