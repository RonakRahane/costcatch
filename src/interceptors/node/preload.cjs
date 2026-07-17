/**
 * Node.js HTTP interceptor — preload script.
 *
 * This file is loaded via `node --require <this-file>` BEFORE the user's code.
 * It patches https.request and globalThis.fetch to capture LLM API calls.
 *
 * CRITICAL: This is CommonJS (.cjs) because --require only works with CJS.
 * CRITICAL: All code is wrapped in try/catch — if we crash, the user's script MUST still work.
 */

"use strict";

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

// Output file path — set by the tracer before spawning the child process
const TRACE_OUTPUT = process.env.AGENT_TRACE_OUTPUT;
if (!TRACE_OUTPUT) {
  // No output path means agent-trace didn't set up properly.
  // Silently exit — don't break the user's script.
  return;
}

// URL patterns that indicate an LLM API call
const LLM_PATTERNS = [
  /api\.openai\.com/,
  /\.openai\.azure\.com/,
  /api\.anthropic\.com/,
  /openrouter\.ai/,
  /api\.groq\.com/,
  /api\.mistral\.ai/,
  /generativelanguage\.googleapis\.com/,
  /aiplatform\.googleapis\.com/,
  /localhost:11434/,
  /127\.0\.0\.1:11434/,
  /api\.cohere\.com/,
  /\/chat\/completions/,
  /\/v1\/messages/,
];

/**
 * Check if a URL looks like an LLM API call.
 */
function isLLMCall(urlStr) {
  return LLM_PATTERNS.some((p) => p.test(urlStr));
}

// Monotonic id so we can correlate a "start" marker with its completion.
let seqId = 0;
function nextId() {
  return ++seqId;
}

/**
 * Write a captured call to the NDJSON output file.
 * Appends one JSON object per line for streaming-safe writes.
 */
function writeCall(callData) {
  try {
    const line = JSON.stringify(callData) + "\n";
    fs.appendFileSync(TRACE_OUTPUT, line, "utf-8");
  } catch {
    // Non-critical: if we can't write, don't crash the user's script
  }
}

/** Best-effort model name from a (possibly-unparsed) request body. */
function extractModel(reqBody) {
  try {
    const parsed = typeof reqBody === "string" ? JSON.parse(reqBody) : reqBody;
    if (parsed && typeof parsed === "object" && typeof parsed.model === "string") {
      return parsed.model;
    }
  } catch {
    // ignore
  }
  return null;
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
  if (u.includes("11434")) return "ollama";
  if (u.includes("cohere.com")) return "cohere";
  return "unknown";
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

/**
 * Build a URL string from http/https request options.
 */
function buildUrl(options) {
  if (typeof options === "string") return options;
  if (options instanceof URL) return options.toString();

  const protocol = options.protocol || "https:";
  const host = options.hostname || options.host || "localhost";
  const port = options.port ? `:${options.port}` : "";
  const path = options.path || "/";
  return `${protocol}//${host}${port}${path}`;
}

// ---------------------------------------------------------------------------
// Patch https.request and http.request
// ---------------------------------------------------------------------------

function patchModule(mod, moduleName) {
  const originalRequest = mod.request;

  mod.request = function patchedRequest(options, callback) {
    let url;
    try {
      url = buildUrl(options);
    } catch {
      return originalRequest.call(this, options, callback);
    }

    if (!isLLMCall(url)) {
      return originalRequest.call(this, options, callback);
    }

    const startMs = Date.now();
    const id = nextId();
    let requestBody = "";
    let startEmitted = false;

    const req = originalRequest.call(this, options, function interceptedCallback(res) {
      let responseBody = "";

      res.on("data", (chunk) => {
        responseBody += chunk.toString();
      });

      res.on("end", () => {
        try {
          // Parse SSE streaming responses
          let parsedResponse;
          const contentType = res.headers["content-type"] || "";
          const isSSE = contentType.includes("text/event-stream") || responseBody.includes("data: {");

          if (isSSE) {
            parsedResponse = parseSSEResponse(responseBody);
          } else {
            parsedResponse = safeJsonParse(responseBody);
          }

          writeCall({
            phase: "end",
            id,
            url,
            method: (options.method || "GET").toUpperCase(),
            requestBody: safeJsonParse(requestBody),
            responseBody: parsedResponse,
            statusCode: res.statusCode,
            startMs,
            endMs: Date.now(),
            isStreaming: isSSE,
          });
        } catch {
          // Swallow parse errors — don't break the user's script
        }
      });

      // Call the original callback so the user's code gets the response
      if (callback) callback(res);
    });

    // Emit the "start" marker once the full request body has been written
    // (that's when the model is known and the request is actually in flight).
    const emitStart = () => {
      if (startEmitted) return;
      startEmitted = true;
      writeStart(id, url, requestBody, startMs);
    };

    // Capture request body
    const originalWrite = req.write;
    req.write = function (data, encoding, cb) {
      if (data) requestBody += data.toString();
      return originalWrite.call(this, data, encoding, cb);
    };

    const originalEnd = req.end;
    req.end = function (data, encoding, cb) {
      if (data) requestBody += data.toString();
      emitStart();
      return originalEnd.call(this, data, encoding, cb);
    };

    return req;
  };
}

try {
  patchModule(https, "https");
  patchModule(http, "http");
} catch {
  // If patching fails, the user's script runs unmodified
}

// ---------------------------------------------------------------------------
// Patch globalThis.fetch (Node 18+)
// ---------------------------------------------------------------------------

if (typeof globalThis.fetch === "function") {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async function patchedFetch(input, init) {
    let url;
    try {
      url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    } catch {
      return originalFetch(input, init);
    }

    if (!isLLMCall(url)) {
      return originalFetch(input, init);
    }

    const startMs = Date.now();
    const id = nextId();
    let requestBody = null;

    try {
      if (init && init.body) {
        requestBody = typeof init.body === "string" ? init.body : init.body.toString();
      }
    } catch {
      // Can't read body — continue without it
    }

    // Body is known up-front for fetch — emit the "start" marker immediately.
    writeStart(id, url, requestBody, startMs);

    try {
      const response = await originalFetch(input, init);

      // Clone the response so the user's code can still read it
      const clonedResponse = response.clone();

      // Read the response body in the background (don't block the user)
      clonedResponse.text().then((responseText) => {
        try {
          const contentType = response.headers.get("content-type") || "";
          const isSSE = contentType.includes("text/event-stream") || responseText.includes("data: {");

          let parsedResponse;
          if (isSSE) {
            parsedResponse = parseSSEResponse(responseText);
          } else {
            parsedResponse = safeJsonParse(responseText);
          }

          writeCall({
            phase: "end",
            id,
            url,
            method: (init && init.method) || "GET",
            requestBody: safeJsonParse(requestBody),
            responseBody: parsedResponse,
            statusCode: response.status,
            startMs,
            endMs: Date.now(),
            isStreaming: isSSE,
          });
        } catch {
          // Swallow errors
        }
      }).catch(() => {});

      return response;
    } catch (err) {
      // If the fetch itself fails, let the error propagate to the user
      throw err;
    }
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse an SSE response body into a single reconstructed JSON object.
 *
 * SSE format: multiple "data: {...}" lines. We extract the last message
 * that contains usage data, or reconstruct from all chunks.
 */
function parseSSEResponse(body) {
  const lines = body.split("\n");
  let lastData = null;
  let accumulatedContent = "";
  let usage = null;
  let model = null;
  let finishReason = null;

  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    if (data === "[DONE]") continue;

    try {
      const parsed = JSON.parse(data);
      lastData = parsed;

      // Extract model (usually in every chunk)
      if (parsed.model) model = parsed.model;

      // OpenAI streaming: choices[0].delta.content
      if (parsed.choices && parsed.choices[0]) {
        const choice = parsed.choices[0];
        if (choice.delta && choice.delta.content) {
          accumulatedContent += choice.delta.content;
        }
        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
        }
      }

      // OpenAI: usage in final chunk (when stream_options.include_usage is true)
      if (parsed.usage) {
        usage = parsed.usage;
      }

      // Anthropic streaming: type-based events
      if (parsed.type === "message_start" && parsed.message) {
        model = parsed.message.model;
        if (parsed.message.usage) {
          usage = usage || {};
          usage.input_tokens = parsed.message.usage.input_tokens;
        }
      }
      if (parsed.type === "content_block_delta" && parsed.delta) {
        if (parsed.delta.text) accumulatedContent += parsed.delta.text;
      }
      if (parsed.type === "message_delta") {
        if (parsed.usage) {
          usage = usage || {};
          usage.output_tokens = parsed.usage.output_tokens;
        }
        if (parsed.delta && parsed.delta.stop_reason) {
          finishReason = parsed.delta.stop_reason;
        }
      }
    } catch {
      // Skip unparseable lines
    }
  }

  // Reconstruct a response object that our providers can parse
  if (usage) {
    // We got usage data — construct a proper response
    return {
      model: model,
      usage: usage,
      choices: [{
        message: { content: accumulatedContent, role: "assistant" },
        finish_reason: finishReason || "stop",
      }],
      // Anthropic-style fields
      content: [{ type: "text", text: accumulatedContent }],
      stop_reason: finishReason,
    };
  }

  // No usage data available — return what we have
  if (lastData) return lastData;

  return { _raw: "streaming_response", _warning: "usage_unavailable" };
}

/**
 * Safely parse a JSON string. Returns the raw string if parsing fails.
 */
function safeJsonParse(str) {
  if (str === null || str === undefined) return null;
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}
