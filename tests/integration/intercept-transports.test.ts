/**
 * Node interceptor coverage across transports.
 *
 * Each case here corresponds to a path that previously captured nothing or
 * captured garbage:
 *   · `http.get` closes over the module-local `request`, so patching
 *     `mod.request` alone left every `.get()` call invisible.
 *   · fetch chunks arrive as Uint8Array; the body buffer stringified them into
 *     "123,34,105,…", so streamed responses parsed as neither JSON nor SSE.
 *   · a request that never gets a response was dropped entirely, hiding exactly
 *     the failures a tracer is reached for.
 */

import { describe, it, expect } from "vitest";
import * as http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnTraced, readCapturedCalls } from "../../src/core/tracer.js";
import type { RawHttpCall } from "../../src/types/trace.js";

interface MockServer {
  url: string;
  close: () => Promise<void>;
}

/** Mock server that answers with JSON, or with an SSE stream on /stream. */
function startMockServer(): Promise<MockServer> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (req.url?.includes("stream=true")) {
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.write(`data: ${JSON.stringify({ model: "gpt-4o", choices: [{ delta: { content: "he" } }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ model: "gpt-4o", choices: [{ delta: { content: "llo" } }] })}\n\n`);
          res.write(
            `data: ${JSON.stringify({
              model: "gpt-4o",
              choices: [{ delta: {}, finish_reason: "stop" }],
              usage: { prompt_tokens: 42, completion_tokens: 7 },
            })}\n\n`,
          );
          res.end("data: [DONE]\n\n");
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "chatcmpl-mock",
            model: "gpt-4o",
            choices: [{ message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
          }),
        );
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

/** Write `source` to a temp .mjs file, trace it, and return the captured calls. */
async function traceScript(source: string): Promise<{ code: number; calls: RawHttpCall[] }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "costcatch-tx-"));
  const script = path.join(dir, "agent.mjs");
  fs.writeFileSync(script, source);

  const handle = spawnTraced(["node", script], "node", { pipeChildOutput: true });
  handle.child.stdout?.resume();
  handle.child.stderr?.resume();

  const code = await handle.done;
  const calls = readCapturedCalls(handle.outputFile);
  handle.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
  return { code, calls };
}

describe("Node interceptor — transports", () => {
  it("captures a streamed SSE response including its usage frame", async () => {
    const server = await startMockServer();
    const { code, calls } = await traceScript(
      `const r = await fetch(${JSON.stringify(server.url)} + "/v1/chat/completions?stream=true", {
         method: "POST",
         headers: { "content-type": "application/json" },
         body: JSON.stringify({ model: "gpt-4o", stream: true, messages: [] }),
       });
       await r.text();
       await new Promise((r) => setTimeout(r, 150));`,
    );
    await server.close();

    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    // Uint8Array chunks must be decoded, not stringified.
    const body = calls[0].responseBody as { usage?: { prompt_tokens?: number }; choices?: unknown[] };
    expect(body.usage?.prompt_tokens).toBe(42);
    expect(calls[0].isStreaming).toBe(true);
  }, 25_000);

  it("captures calls made with http.get", async () => {
    const server = await startMockServer();
    const { code, calls } = await traceScript(
      `import http from "node:http";
       await new Promise((resolve, reject) => {
         const req = http.get(${JSON.stringify(server.url)} + "/v1/chat/completions", (res) => {
           res.resume();
           res.on("end", resolve);
         });
         req.on("error", reject);
       });
       await new Promise((r) => setTimeout(r, 150));`,
    );
    await server.close();

    expect(code).toBe(0);
    // The regression: http.get does not route through the patched http.request.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/v1/chat/completions");
  }, 25_000);

  it("captures calls made with http.request", async () => {
    const server = await startMockServer();
    const { code, calls } = await traceScript(
      `import http from "node:http";
       await new Promise((resolve, reject) => {
         const req = http.request(${JSON.stringify(server.url)} + "/v1/chat/completions",
           { method: "POST", headers: { "content-type": "application/json" } },
           (res) => { res.resume(); res.on("end", resolve); });
         req.on("error", reject);
         req.end(JSON.stringify({ model: "gpt-4o", messages: [] }));
       });
       await new Promise((r) => setTimeout(r, 150));`,
    );
    await server.close();

    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    const body = calls[0].responseBody as { usage?: { prompt_tokens?: number } };
    expect(body.usage?.prompt_tokens).toBe(100);
    expect(calls[0].requestBody).toMatchObject({ model: "gpt-4o" });
  }, 25_000);

  it("records a failed connection instead of dropping the call", async () => {
    // Port 1 is reserved and refuses instantly on every platform.
    const { calls } = await traceScript(
      `try {
         await fetch("http://127.0.0.1:1/v1/chat/completions", {
           method: "POST", body: JSON.stringify({ model: "gpt-4o" }),
         });
       } catch {}
       await new Promise((r) => setTimeout(r, 150));`,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].statusCode).toBe(0);
    expect(calls[0].responseBody).toMatchObject({ error: { type: "transport_error" } });
  }, 25_000);

  it("leaves non-LLM traffic untouched", async () => {
    const server = await startMockServer();
    const { code, calls } = await traceScript(
      `const r = await fetch(${JSON.stringify(server.url)} + "/health");
       await r.text();
       await new Promise((r) => setTimeout(r, 100));`,
    );
    await server.close();

    expect(code).toBe(0);
    expect(calls).toEqual([]);
  }, 25_000);

  it("does not swallow a fetch rejection the user never handles", async () => {
    // Installing costcatch must not turn a crash into a silent success.
    const { code } = await traceScript(
      `await fetch("http://127.0.0.1:1/v1/chat/completions", { method: "POST", body: "{}" });`,
    );
    expect(code).not.toBe(0);
  }, 25_000);
});
