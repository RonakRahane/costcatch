"use strict";

// Loaded with --require before the user's code. Patches http, https and fetch and appends each
// LLM call as a JSON line to the file in COSTCATCH_OUTPUT, without changing what the program sees.

// Must match src/core/constants.ts, which constants.test.ts checks.
const ENV_OUTPUT = "COSTCATCH_OUTPUT";
const ENV_ACTIVE = "COSTCATCH_ACTIVE";
const ENV_MAX_BODY_BYTES = "COSTCATCH_MAX_BODY_BYTES";
const ENV_MAX_TRACE_BYTES = "COSTCATCH_MAX_TRACE_BYTES";
const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_TRACE_BYTES = 64 * 1024 * 1024;

const TRACE_OUTPUT = process.env[ENV_OUTPUT];

if (!TRACE_OUTPUT) return;

// NODE_OPTIONS and --require can both load this file, and patching twice counts every call twice.
if (globalThis.__costcatchInstalled) return;
globalThis.__costcatchInstalled = true;

const https = require("https");
const http = require("http");
const fs = require("fs");

// Accept digits only, as the Python side does, because parseInt("10MB") would give 10 bytes.
function envInt(name, fallback) {
  const raw = String(process.env[name] || "").trim();
  if (!/^\d+$/.test(raw)) return fallback;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

const MAX_BODY_BYTES = envInt(ENV_MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES);
const MAX_TRACE_BYTES = envInt(ENV_MAX_TRACE_BYTES, DEFAULT_MAX_TRACE_BYTES);

process.env[ENV_ACTIVE] = "1";

// Keep in sync with the URL patterns in src/providers.
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
];

function isLLMCall(urlStr) {
  for (let i = 0; i < LLM_PATTERNS.length; i++) {
    if (LLM_PATTERNS[i].test(urlStr)) return true;
  }
  return false;
}

// Must match NOT_A_MODEL_CALL in src/core/trace-builder.ts, so live counts agree with the final trace.
const NOT_A_MODEL_CALL =
  /(?:\/count_tokens|\/input_tokens|:countTokens)\/?$|\/(?:files|uploads|batches)(?:\/|$)|\/moderations\/?$/i;

// Every model endpoint is a POST. A GET lists models, fetches a stored result or opens a WebSocket.
function isModelRequest(urlStr, method) {
  if (method !== "POST" || !isLLMCall(urlStr)) return false;
  let pathname;
  try {
    pathname = new URL(urlStr).pathname;
  } catch {
    pathname = String(urlStr).split(/[?#]/)[0];
  }
  return !NOT_A_MODEL_CALL.test(pathname);
}

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

// Seed ids by pid and thread, because child processes and worker threads share the output file.
let seqId = (process.pid % 100000) * 1e9 + (threadIdOf() % 1000) * 1e6;
function threadIdOf() {
  try {
    return require("worker_threads").threadId || 0;
  } catch {
    return 0;
  }
}
function nextId() {
  return ++seqId;
}

let bytesWritten = 0;
let limitNotified = false;

// Write synchronously, because process.exit() drops pending async writes.
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
  }
}

function extractModel(reqBody) {
  try {
    const parsed = typeof reqBody === "string" ? JSON.parse(reqBody) : reqBody;
    if (parsed && typeof parsed === "object" && typeof parsed.model === "string") {
      return parsed.model;
    }
  } catch {
  }
  return null;
}

function writeStart(id, url, reqBody, startMs) {
  writeCall({
    phase: "start",
    id,
    url,
    model: extractModel(reqBody),
    provider: guessProvider(url),
    startMs,
    // Lets costcatch close a call whose process died instead of showing it in flight forever.
    pid: process.pid,
  });
}

function writeTransportError(id, url, method, requestBody, startMs, err) {
  writeCall({
    phase: "end",
    id,
    url,
    method,
    requestBody: safeJsonParse(requestBody),
    responseBody: { error: { type: "transport_error", message: describeError(err) } },
    statusCode: 0,
    startMs,
    endMs: Date.now(),
    isStreaming: false,
  });
}

function describeError(err) {
  const message = String((err && err.message) || err);
  const cause = err && err.cause;
  const why = cause && (cause.code || cause.message);
  return why && !message.includes(String(why)) ? message + ": " + (cause.message || cause.code) : message;
}

// fetch gives Uint8Array chunks, and String() on one gives "123,34,..." instead of text.
function toBuffer(chunk) {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (ArrayBuffer.isView(chunk)) return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  if (chunk instanceof ArrayBuffer) return Buffer.from(chunk);
  return Buffer.from(String(chunk), "utf-8");
}

function bufferToText(chunk) {
  return toBuffer(chunk).toString("utf-8");
}

// http gives raw wire bytes. Check magic bytes, not the header, so a decoded body is not decoded twice.
function decodeBody(buf, encoding) {
  if (!buf || buf.length < 2) return buf;
  try {
    const zlib = require("node:zlib");
    if (buf[0] === 0x1f && buf[1] === 0x8b) return zlib.gunzipSync(buf);
    // A zlib deflate header has low nibble 8, and its first two bytes divide evenly by 31.
    if ((buf[0] & 0x0f) === 0x08 && ((buf[0] << 8) + buf[1]) % 31 === 0) {
      return zlib.inflateSync(buf);
    }
    if (buf[0] === 0x28 && buf[1] === 0xb5 && typeof zlib.zstdDecompressSync === "function") {
      return zlib.zstdDecompressSync(buf);
    }
    // Brotli has no magic number, so try it only when the response declared it.
    if (encoding === "br" && typeof zlib.brotliDecompressSync === "function") {
      return zlib.brotliDecompressSync(buf);
    }
  } catch {
  }
  return buf;
}

// Read only up to the cap, because clone().text() would wait for and buffer the whole upload.
async function readBoundedRequestBody(cloned) {
  if (!cloned || !cloned.body || typeof cloned.body.getReader !== "function") {
    return typeof cloned.text === "function" ? (await cloned.text()).slice(0, MAX_BODY_BYTES) : null;
  }
  const reader = cloned.body.getReader();
  const parts = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const buf = toBuffer(value);
      const room = MAX_BODY_BYTES - size;
      if (buf.length >= room) {
        parts.push(buf.subarray(0, Math.max(0, room)));
        break;
      }
      parts.push(buf);
      size += buf.length;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
    }
  }
  return Buffer.concat(parts).toString("utf-8");
}

function createBodyBuffer(encoding) {
  const chunks = [];
  let size = 0;
  let truncated = false;

  return {
    push(chunk) {
      if (truncated) return;
      try {
        const buf = toBuffer(chunk);
        const room = MAX_BODY_BYTES - size;
        if (buf.length > room) {
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
        return decodeBody(Buffer.concat(chunks), encoding).toString("utf-8");
      } catch {
        return "";
      }
    },
    get truncated() {
      return truncated;
    },
  };
}

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

function buildUrl(urlArg, options, defaultProtocol) {
  if (urlArg) {
    const base = typeof urlArg === "string" ? urlArg : urlArg.toString();
    // With request(url, options), options.path replaces the URL's path.
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

    const method = String((norm.options && norm.options.method) || "GET").toUpperCase();
    if (!isModelRequest(url, method)) {
      return originalRequest.call(this, a, b, c);
    }

    const startMs = Date.now();
    const id = nextId();
    let requestBody = "";
    let startEmitted = false;
    let completed = false;

    let req;
    try {
      req = originalRequest.call(this, a, b, c);
    } catch (err) {
      throw err;
    }

    try {
      const appendRequestChunk = (data) => {
        if (!data || typeof data === "function") return;
        const room = MAX_BODY_BYTES - requestBody.length;
        if (room <= 0) return;
        const text = Buffer.isBuffer(data) || ArrayBuffer.isView(data) ? bufferToText(data) : String(data);
        requestBody += text.length > room ? text.slice(0, room) : text;
      };

      const originalWrite = req.write;
      req.write = function (data, encoding, cb) {
        try {
          appendRequestChunk(data);
        } catch {
        }
        return originalWrite.call(this, data, encoding, cb);
      };

      const originalEnd = req.end;
      req.end = function (data, encoding, cb) {
        try {
          appendRequestChunk(data);
        } catch {
        }
        if (!startEmitted) {
          startEmitted = true;
          writeStart(id, url, requestBody, startMs);
        }
        return originalEnd.call(this, data, encoding, cb);
      };
    } catch {
    }

    // Adding an 'error' listener stops Node from throwing on an unhandled error, so rethrow
    // when ours is the only one, or a crash turns into a hang.
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

    // Prepend so this runs before a program's once-listener removes itself and skews the count below.
    req.prependListener("response", (res) => {
      // Node drains a response nobody listens to, but our listener counts as one. Resume it
      // ourselves, or the socket stays busy and the program cannot exit.
      if (req.listenerCount("response") <= 1) {
        try {
          res.resume();
        } catch {
        }
      }
      const body = createBodyBuffer(String(res.headers["content-encoding"] || "").toLowerCase().trim());

      // Unlike req, an unhandled error on res just ends the stream, so there is no rethrow.
      res.on("error", (err) => {
        if (!completed) {
          completed = true;
          writeTransportError(id, url, method, requestBody, startMs, err);
        }
      });
      const finish = (aborted) => {
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
            aborted: aborted || undefined,
          });
        } catch {
        }
      };
      // Watch push() instead of adding a 'data' listener, which would start flowing mode and lose
      // data for a late reader. push(null) also comes before an 'end' handler can call process.exit().
      try {
        const originalPush = res.push;
        res.push = function (chunk, encoding) {
          try {
            if (chunk === null) finish(false);
            else body.push(chunk);
          } catch {
          }
          return originalPush.call(this, chunk, encoding);
        };
      } catch {
        // The 'end' listener still records it.
      }

      // A program that stops reading destroys the response, so push(null) never comes.
      res.on("close", () => finish(true));
      res.on("end", () => finish(false));
    });

    return req;
  }

  mod.request = patchedRequest;

  // http.get calls the module's own request, not mod.request, so rebuild it the way Node does.
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
}

// Fetch bodies still being read, which the exit hook records if the program exits mid-stream.
const pendingFetches = new Set();
let exitHookInstalled = false;
function trackPending(finish) {
  pendingFetches.add(finish);
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    try {
      process.on("exit", () => {
        for (const f of Array.from(pendingFetches)) f("exit");
      });
    } catch {
    }
  }
}

if (typeof globalThis.fetch === "function") {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async function patchedFetch(input, init) {
    let url;
    let method;
    try {
      url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input && typeof input.url === "string"
              ? input.url
              : "";
      method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
    } catch {
      return originalFetch.call(this, input, init);
    }

    if (!url || !isModelRequest(url, method)) {
      return originalFetch.call(this, input, init);
    }

    const startMs = Date.now();
    const id = nextId();

    // A Request body can only be read once, so read a clone and leave the original for the program.
    let requestBody = null;
    let requestClone = input;
    try {
      const body = init && init.body;
      if (typeof body === "string") {
        requestBody = body.slice(0, MAX_BODY_BYTES);
      } else if (body && (ArrayBuffer.isView(body) || body instanceof ArrayBuffer)) {
        requestBody = bufferToText(body).slice(0, MAX_BODY_BYTES);
      } else if (body && typeof Blob === "function" && body instanceof Blob) {
        requestBody = body.size <= MAX_BODY_BYTES ? await body.text() : null;
      } else if (body && typeof body.toString === "function" && !(body instanceof ReadableStream)) {
        requestBody = String(body).slice(0, MAX_BODY_BYTES);
      } else if (!body && input && typeof input.clone === "function" && typeof input.body !== "undefined") {
        requestClone = input;
        requestBody = await readBoundedRequestBody(input.clone()).catch(() => null);
      }
    } catch {
    }

    writeStart(id, url, requestBody, startMs);

    let response;
    try {
      response = await originalFetch.call(this, requestClone, init);
    } catch (err) {
      writeTransportError(id, url, method, requestBody, startMs, err);
      throw err;
    }

    const base = () => ({ phase: "end", id, url, method, requestBody: safeJsonParse(requestBody), statusCode: response.status, startMs });

    let tapped;
    try {
      tapped = tapResponse(response, base, (init && init.signal) || (input && input.signal) || null);
    } catch {
      tapped = null;
    }
    if (!tapped) {
      writeCall(Object.assign(base(), { responseBody: null, endMs: Date.now(), isStreaming: false }));
      return response;
    }
    return tapped;
  };
}

// Gives the program a new Response whose body passes through us. We read the source as it
// arrives, so the call is recorded even if the program never reads it, and before it sees the end.
function tapResponse(response, base, signal) {
  if (!response.body || typeof response.body.getReader !== "function") return null;
  // fetch allows statuses the Response constructor rejects, like 600+, so test that before
  // taking the body's reader, which cannot be given back.
  try {
    new Response(null, { status: response.status, statusText: response.statusText });
  } catch {
    return null;
  }

  const contentType = (response.headers && response.headers.get("content-type")) || "";
  const capture = createBodyBuffer();
  let finished = false;
  let cancelled = false;
  let wrapped = null;

  const finish = (how, err) => {
    if (finished) return;
    finished = true;
    pendingFetches.delete(finish);
    try {
      const text = capture.text();
      const isSSE = contentType.includes("text/event-stream") || text.startsWith("data:") || text.includes("\ndata: ");
      const record = Object.assign(base(), { endMs: Date.now(), isStreaming: isSSE, bodyTruncated: capture.truncated || undefined });
      const programWasReading = Boolean(wrapped && wrapped.bodyUsed);
      if (how === "error" || (how === "exit" && programWasReading)) {
        // The provider started sending, so the call may be billed even though it failed.
        const why = how === "exit" ? "the program exited before the response finished" : "the connection broke before the response finished: " + describeError(err);
        record.responseBody = { error: { type: "response_interrupted", message: why } };
      } else {
        // A cancel, or an exit before the program read anything, is not a failure, so keep what arrived.
        record.responseBody = isSSE ? parseSSEResponse(text) : safeJsonParse(text);
        if (how !== "done") record.aborted = true;
      }
      writeCall(record);
    } catch {
    }
  };
  trackPending(finish);

  const source = response.body.getReader();
  const queue = [];
  let sourceDone = false;
  let sourceError = null;
  let wake = null;
  const notify = () => {
    if (wake) {
      const w = wake;
      wake = null;
      w();
    }
  };

  void (async () => {
    try {
      for (;;) {
        const chunk = await source.read();
        if (chunk.done) break;
        capture.push(chunk.value);
        queue.push(chunk.value);
        notify();
      }
      sourceDone = true;
      finish(cancelled ? "cancel" : "done");
    } catch (err) {
      sourceError = err;
      finish(cancelled || (signal && signal.aborted) ? "cancel" : "error", err);
    }
    notify();
  })();

  // Use a byte stream like the original body, so a BYOB reader still works.
  const body = new ReadableStream({
    type: "bytes",
    async pull(controller) {
      for (;;) {
        if (queue.length > 0) {
          const chunk = queue.shift();
          if (!chunk || chunk.byteLength === 0) continue;
          // Enqueue a copy, because a byte stream detaches the chunk's buffer and the capture still reads it.
          controller.enqueue(new Uint8Array(chunk));
          return;
        }
        if (sourceError) throw sourceError;
        if (sourceDone) {
          controller.close();
          // A pending BYOB read settles only once its request is answered.
          if (controller.byobRequest) controller.byobRequest.respond(0);
          return;
        }
        await new Promise((resolve) => {
          wake = resolve;
        });
      }
    },
    cancel(reason) {
      cancelled = true;
      finish("cancel");
      return source.cancel(reason);
    },
  });

  wrapped = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  return withResponseMeta(wrapped, response);
}

// The Response constructor cannot set url, redirected or type, so copy them over, on clones too.
function withResponseMeta(target, original) {
  try {
    Object.defineProperties(target, {
      url: { value: original.url, enumerable: true },
      redirected: { value: original.redirected, enumerable: true },
      type: { value: original.type, enumerable: true },
      clone: {
        value: function clone() {
          return withResponseMeta(Response.prototype.clone.call(this), original);
        },
        writable: true,
        configurable: true,
      },
    });
  } catch {
  }
  return target;
}

// A later frame with "input_tokens": null must not erase a count from an earlier frame.
function mergeUsage(into, from) {
  const out = Object.assign({}, into);
  for (const key of Object.keys(from)) {
    if (from[key] !== null && from[key] !== undefined) out[key] = from[key];
  }
  return out;
}

function parseSSEResponse(body) {
  const lines = body.split("\n");
  let lastData = null;
  let accumulatedContent = "";
  let usage = null;
  let model = null;
  let finishReason = null;
  let streamError = null;
  const toolCalls = [];
  const anthropicToolBlocks = {};
  let geminiText = "";
  const geminiCalls = [];
  let geminiLast = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;

    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      continue;
    }
    // `data: null` keepalives parse fine but would throw below and drop the record.
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    lastData = parsed;

    if (parsed.model) model = parsed.model;

    // A stream can still fail after a 200 with an error frame, and without this the call looks successful.
    if (parsed.error && typeof parsed.error === "object" && (parsed.type === "error" || !parsed.choices)) {
      streamError = parsed.error;
    }

    if (parsed.choices && parsed.choices[0]) {
      const choice = parsed.choices[0];
      const delta = choice.delta;
      if (delta) {
        if (delta.content) accumulatedContent += delta.content;
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            if (!tc || typeof tc !== "object") continue;
            const idx = typeof tc.index === "number" ? tc.index : toolCalls.length;
            if (!toolCalls[idx]) toolCalls[idx] = { function: { name: "", arguments: "" } };
            if (typeof tc.id === "string" && tc.id) toolCalls[idx].id = tc.id;
            if (tc.function && tc.function.name) toolCalls[idx].function.name += tc.function.name;
            if (tc.function && tc.function.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
          }
        }
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }
    if (parsed.usage && typeof parsed.usage === "object") {
      // Merge, or Anthropic's message_delta usage would wipe out the counts from message_start.
      usage = mergeUsage(usage, parsed.usage);
    }
    if (parsed.x_groq && parsed.x_groq.usage && typeof parsed.x_groq.usage === "object") {
      usage = mergeUsage(usage, parsed.x_groq.usage);
    }
    // Cohere v2 sends text in content-delta, and usage and the finish reason in message-end.
    if (parsed.type === "content-delta" && parsed.delta && parsed.delta.message && parsed.delta.message.content) {
      const text = parsed.delta.message.content.text;
      if (typeof text === "string") accumulatedContent += text;
    }
    if (parsed.type === "message-end" && parsed.delta) {
      if (parsed.delta.usage && typeof parsed.delta.usage === "object") usage = mergeUsage(usage, parsed.delta.usage);
      if (parsed.delta.finish_reason) finishReason = parsed.delta.finish_reason;
    }

    if (parsed.type === "message_start" && parsed.message) {
      if (parsed.message.model) model = parsed.message.model;
      if (parsed.message.usage) {
        usage = usage || {};
        usage.input_tokens = parsed.message.usage.input_tokens;
        if (parsed.message.usage.cache_read_input_tokens != null) {
          usage.cache_read_input_tokens = parsed.message.usage.cache_read_input_tokens;
        }
        if (parsed.message.usage.cache_creation_input_tokens != null) {
          usage.cache_creation_input_tokens = parsed.message.usage.cache_creation_input_tokens;
        }
      }
    }
    if (parsed.type === "content_block_start" && parsed.content_block && parsed.content_block.type === "tool_use") {
      anthropicToolBlocks[parsed.index] = {
        id: typeof parsed.content_block.id === "string" ? parsed.content_block.id : "",
        name: parsed.content_block.name || "",
        json: "",
      };
    }
    if (parsed.type === "content_block_delta" && parsed.delta) {
      if (parsed.delta.text) accumulatedContent += parsed.delta.text;
      if (parsed.delta.type === "input_json_delta" && typeof parsed.delta.partial_json === "string") {
        const block = anthropicToolBlocks[parsed.index];
        if (block) block.json += parsed.delta.partial_json;
      }
    }
    if (parsed.type === "message_delta") {
      if (parsed.usage) {
        usage = usage || {};
        if (parsed.usage.output_tokens != null) usage.output_tokens = parsed.usage.output_tokens;
      }
      if (parsed.delta && parsed.delta.stop_reason) finishReason = parsed.delta.stop_reason;
    }

    if (Array.isArray(parsed.candidates)) {
      geminiLast = parsed;
      const candidate = parsed.candidates[0];
      const parts = candidate && candidate.content && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
      for (const part of parts) {
        if (!part || typeof part !== "object") continue;
        if (typeof part.text === "string" && !part.thought) geminiText += part.text;
        if (part.functionCall) geminiCalls.push({ functionCall: part.functionCall });
      }
    }
  }

  // Gemini's last chunk has the total usage, but text and calls are spread over all chunks.
  if (geminiLast) {
    const last = geminiLast.candidates[0] || {};
    const parts = (geminiText ? [{ text: geminiText }] : []).concat(geminiCalls);
    const merged = Object.assign({}, geminiLast, {
      candidates: [Object.assign({}, last, { content: { role: "model", parts } })],
    });
    if (streamError) merged.error = streamError;
    return merged;
  }

  if (usage || accumulatedContent || toolCalls.length > 0 || Object.keys(anthropicToolBlocks).length > 0 || streamError) {
    const message = { content: accumulatedContent, role: "assistant" };

    // Output tool calls in both OpenAI and Anthropic shapes so each provider parser finds its own.
    const anthropicTools = [];
    for (const key of Object.keys(anthropicToolBlocks)) {
      const block = anthropicToolBlocks[key];
      if (!block || !block.name) continue;
      let input = {};
      try {
        input = block.json ? JSON.parse(block.json) : {};
      } catch {
        input = { _raw: block.json };
      }
      const id = block.id ? { id: block.id } : {};
      anthropicTools.push(Object.assign({ type: "tool_use" }, id, { name: block.name, input }));
      toolCalls.push(Object.assign({}, id, { function: { name: block.name, arguments: block.json || "{}" } }));
    }

    const compacted = toolCalls.filter(Boolean);
    if (compacted.length > 0) message.tool_calls = compacted;

    const folded = {
      model,
      // Stays null when the stream was cut short.
      choices: [{ message, finish_reason: finishReason }],
      content: [{ type: "text", text: accumulatedContent }, ...anthropicTools],
      stop_reason: finishReason,
    };
    if (usage) folded.usage = usage;
    if (streamError) folded.error = streamError;
    return folded;
  }

  if (lastData) return lastData;
  return { _raw: "streaming_response", _warning: "usage_unavailable" };
}

function safeJsonParse(str) {
  if (str === null || str === undefined) return null;
  if (typeof str !== "string") return str;
  try {
    return JSON.parse(str);
  } catch {
    return str.length > 4096 ? str.slice(0, 4096) + "…[truncated]" : str;
  }
}
