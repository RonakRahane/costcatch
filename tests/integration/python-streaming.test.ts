/**
 * Python interceptor — streaming safety.
 *
 * The patch used to read `response.text` unconditionally. On a streamed
 * response httpx raises `ResponseNotRead`, and the exception escaped the patch
 * and killed the traced program: installing costcatch broke every agent that
 * streamed, which is most of them.
 *
 * The first test here is the important one — it asserts the user's script still
 * completes and still sees its own bytes. Capture is the secondary concern.
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import * as http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnTraced, readCapturedCalls } from "../../src/core/tracer.js";

function pythonAvailable(): { python: string; hasHttpx: boolean } | null {
  for (const python of ["python3", "python"]) {
    try {
      execFileSync(python, ["--version"], { stdio: "ignore" });
      let hasHttpx = false;
      try {
        execFileSync(python, ["-c", "import httpx"], { stdio: "ignore" });
        hasHttpx = true;
      } catch {
        hasHttpx = false;
      }
      return { python, hasHttpx };
    } catch {
      // try the next interpreter name
    }
  }
  return null;
}

/** Mock server that always answers with an OpenAI-style SSE stream. */
function startSseServer(): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ model: "gpt-4o", choices: [{ delta: { content: "he" } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ model: "gpt-4o", choices: [{ delta: { content: "llo" } }] })}\n\n`);
        res.write(
          `data: ${JSON.stringify({
            model: "gpt-4o",
            choices: [{ delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 55, completion_tokens: 9 },
          })}\n\n`,
        );
        res.end("data: [DONE]\n\n");
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

const py = pythonAvailable();

describe.skipIf(!py?.hasHttpx)("interceptor end-to-end (Python streaming)", () => {
  it("does not break a streamed httpx call, and captures its usage", async () => {
    const server = await startSseServer();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "at-pystream-"));
    const script = path.join(dir, "agent.py");

    // The script asserts on the bytes IT received. If our tee corrupted or
    // consumed the stream, or `.text` raised, the exit code will be non-zero.
    fs.writeFileSync(
      script,
      [
        "import httpx, sys",
        `url = "${server.url}/v1/chat/completions"`,
        "chunks = []",
        "with httpx.Client() as client:",
        '    with client.stream("POST", url, json={"model": "gpt-4o", "stream": True, "messages": []}) as r:',
        "        for line in r.iter_lines():",
        "            chunks.append(line)",
        'text = "\\n".join(chunks)',
        'assert "he" in text, "stream body was lost"',
        'assert "[DONE]" in text, "stream was truncated"',
        "sys.exit(0)",
      ].join("\n"),
    );

    const handle = spawnTraced([py!.python, script], "python", { pipeChildOutput: false });
    const code = await handle.done;
    const calls = readCapturedCalls(handle.outputFile);
    handle.dispose();
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });

    // THE assertion: the traced program still works.
    expect(code).toBe(0);

    expect(calls).toHaveLength(1);
    expect(calls[0].isStreaming).toBe(true);
    const body = calls[0].responseBody as { usage?: { prompt_tokens?: number } };
    expect(body.usage?.prompt_tokens).toBe(55);
  }, 30_000);

  it("still emits a record when a streamed response is closed unread", async () => {
    const server = await startSseServer();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "at-pyclose-"));
    const script = path.join(dir, "agent.py");

    fs.writeFileSync(
      script,
      [
        "import httpx, sys",
        `url = "${server.url}/v1/chat/completions"`,
        "with httpx.Client() as client:",
        '    with client.stream("POST", url, json={"model": "gpt-4o", "stream": True, "messages": []}) as r:',
        "        pass  # never iterate the body",
        "sys.exit(0)",
      ].join("\n"),
    );

    const handle = spawnTraced([py!.python, script], "python", { pipeChildOutput: false });
    const code = await handle.done;
    const calls = readCapturedCalls(handle.outputFile);
    handle.dispose();
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });

    expect(code).toBe(0);
    // The call happened, so it must appear — even with an empty body.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/v1/chat/completions");
  }, 30_000);
});

describe.skipIf(!py)("Python interceptor — inertness", () => {
  it("leaves a script alone when costcatch is not driving it", () => {
    // sitecustomize sits on PYTHONPATH for the whole process tree; a child that
    // inherits the path but not COSTCATCH_OUTPUT must be entirely unaffected.
    const interceptorDir = path.resolve("src/interceptors/python");
    const out = execFileSync(py!.python, ["-c", "print('untouched')"], {
      env: { ...process.env, PYTHONPATH: interceptorDir, COSTCATCH_OUTPUT: "" },
      encoding: "utf-8",
    });
    expect(out.trim()).toBe("untouched");
  }, 20_000);
});
