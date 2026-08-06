import { describe, it, expect } from "vitest";
import * as http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnTraced, readCapturedCalls, cleanupOutputFile } from "../../src/core/tracer.js";

/** Start a mock OpenAI-compatible server on a random port. */
function startMockServer(): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
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

describe("interceptor end-to-end (Node)", () => {
  it("captures LLM calls even when the script path contains $ and spaces", async () => {
    const server = await startMockServer();

    // A directory whose name contains shell metacharacters — this is the exact
    // condition that broke the old `shell: true` spawn (`$2` expansion).
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "costcatch-it-"));
    const weird = path.join(base, "we$t 2000 dir");
    fs.mkdirSync(weird, { recursive: true });

    const agent = path.join(weird, "agent.mjs");
    fs.writeFileSync(
      agent,
      `const url = ${JSON.stringify(server.url)} + "/v1/chat/completions";
for (let i = 0; i < 2; i++) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
  });
  await r.json();
}
// give the interceptor's background body-read a moment to flush
await new Promise((r) => setTimeout(r, 80));
`,
    );

    const handle = spawnTraced(["node", agent], "node", { pipeChildOutput: false });
    const code = await handle.done;
    const calls = readCapturedCalls(handle.outputFile);
    cleanupOutputFile(handle.outputFile);
    await server.close();

    expect(code).toBe(0);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[0].url).toContain("/v1/chat/completions");
    // completion records carry the two-phase tag + usage
    expect(calls[0].phase).toBe("end");
    const rb = calls[0].responseBody as { usage?: { prompt_tokens?: number } };
    expect(rb.usage?.prompt_tokens).toBe(100);
  }, 20_000);

  it("emits a two-phase start marker before each completion", async () => {
    const server = await startMockServer();
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "costcatch-it2-"));
    const agent = path.join(base, "agent.mjs");
    fs.writeFileSync(
      agent,
      `const url = ${JSON.stringify(server.url)} + "/v1/chat/completions";
const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "gpt-4o", messages: [] }) });
await r.json();
await new Promise((r) => setTimeout(r, 80));
`,
    );

    const handle = spawnTraced(["node", agent], "node", { pipeChildOutput: false });
    await handle.done;

    // Read the RAW file (before start-records are filtered out).
    const raw = fs.readFileSync(handle.outputFile, "utf-8").trim().split("\n").map((l) => JSON.parse(l));
    cleanupOutputFile(handle.outputFile);
    await server.close();

    const starts = raw.filter((r) => r.phase === "start");
    const ends = raw.filter((r) => r.phase === "end");
    expect(starts.length).toBe(1);
    expect(ends.length).toBe(1);
    expect(starts[0].model).toBe("gpt-4o");
    expect(starts[0].id).toBe(ends[0].id); // correlation
  }, 20_000);
});
