import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import * as http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnTraced, readCapturedCalls, cleanupOutputFile } from "../../src/core/tracer.js";

/** Is a python3 with httpx/requests available? Skip the suite if not. */
function pythonAvailable(): { python: string; hasHttpx: boolean; hasRequests: boolean } | null {
  for (const python of ["python3", "python"]) {
    try {
      execFileSync(python, ["--version"], { stdio: "ignore" });
      const check = (mod: string) => {
        try {
          execFileSync(python, ["-c", `import ${mod}`], { stdio: "ignore" });
          return true;
        } catch {
          return false;
        }
      };
      return { python, hasHttpx: check("httpx"), hasRequests: check("requests") };
    } catch {
      // try next
    }
  }
  return null;
}

function startMockServer(): Promise<{ url: string; port: number; close: () => Promise<void> }> {
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
            choices: [{ message: { role: "assistant", content: "hello-from-mock" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
          }),
        );
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, port, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

const py = pythonAvailable();

describe.skipIf(!py)("interceptor end-to-end (Python)", () => {
  it.skipIf(!py?.hasHttpx)("captures httpx calls (guards the mark-then-fail race)", async () => {
    const server = await startMockServer();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "at-py-"));
    const script = path.join(dir, "agent.py");
    fs.writeFileSync(
      script,
      `import httpx\n` +
        `url = "${server.url}/v1/chat/completions"\n` +
        `for i in range(3):\n` +
        `    httpx.post(url, json={"model": "gpt-4o", "messages": []})\n`,
    );

    const handle = spawnTraced([py!.python, script], "python", { pipeChildOutput: false });
    const code = await handle.done;
    const calls = readCapturedCalls(handle.outputFile);
    cleanupOutputFile(handle.outputFile);
    await server.close();

    expect(code).toBe(0);
    expect(calls.length).toBe(3);
    expect(calls[0].url).toContain("/v1/chat/completions");
  }, 25_000);

  it.skipIf(!py?.hasRequests)("captures requests calls WITHOUT breaking the user's response body", async () => {
    const server = await startMockServer();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "at-req-"));
    const script = path.join(dir, "agent.py");
    // The script asserts it can still read the JSON body. If our urllib3 patch
    // drained the stream, `.json()` would raise and the exit code would be != 0.
    fs.writeFileSync(
      script,
      `import requests, sys\n` +
        `url = "${server.url}/v1/chat/completions"\n` +
        `r = requests.post(url, json={"model": "gpt-4o", "messages": []})\n` +
        `assert r.json()["choices"][0]["message"]["content"] == "hello-from-mock", "body was drained!"\n` +
        `sys.exit(0)\n`,
    );

    const handle = spawnTraced([py!.python, script], "python", { pipeChildOutput: false });
    const code = await handle.done;
    const calls = readCapturedCalls(handle.outputFile);
    cleanupOutputFile(handle.outputFile);
    await server.close();

    expect(code).toBe(0); // the assert passed → user's body was intact
    expect(calls.length).toBe(1);
    const rb = calls[0].responseBody as { usage?: { prompt_tokens?: number } };
    expect(rb.usage?.prompt_tokens).toBe(100);
  }, 25_000);
});
