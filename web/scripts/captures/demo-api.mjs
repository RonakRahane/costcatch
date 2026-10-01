// A local fake of the Anthropic Messages and OpenAI Chat Completions APIs, used only to make the site's captures.
// Token usage is counted from the request the agent sent, so costcatch prices real request sizes.
//
//   node demo-api.mjs [port]      prints "demo API on http://127.0.0.1:<port>" when ready
//
// Agents POST to /<scenario>/<run>/v1/messages or /<scenario>/<run>/v1/chat/completions.
// Each agent process sends a fresh <run> id, so every run replays its scenario from the start.

import * as http from "node:http";

const PORT = Number(process.argv[2] ?? 0);
const counts = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Roughly 3.5 characters per token, plus the 346 tokens Anthropic adds to the system prompt
// when tools are offered (claude-sonnet-4, tool_choice auto).
const tokens = (value) => (value == null ? 0 : Math.ceil(JSON.stringify(value).length / 3.5));
const promptTokens = (body) =>
  tokens(body.system) + tokens(body.messages) + tokens(body.tools) + (body.tools?.length ? 346 : 0);

function send(res, status, payload, headers = {}) {
  const text = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text), ...headers });
  res.end(text);
}

function message(body, content, stopReason, output) {
  return {
    id: `msg_${Math.random().toString(36).slice(2, 14)}`,
    type: "message",
    role: "assistant",
    model: body.model,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: promptTokens(body), output_tokens: output, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  };
}

const tool = (id, name, input) => ({ type: "tool_use", id, name, input });
const text = (t) => ({ type: "text", text: t });

const SUMMARY = "Payment worker ran out of DB connections at 23:12; checkout timed out until 23:41.";

const CUT_OFF =
  "Checkout failed because the payment worker ran out of database connections. At 23:12 the pool " +
  "hit its limit of 20, new requests queued behind it, and each one timed out after 30 seconds. " +
  "The retries from the web tier made it worse: every timed-out request was sent again, which kept " +
  "the queue full until the worker restarted at 23:41. The ticket lookup failed three times, so I " +
  "could not confirm who was paged or whether the incident was already resolved. The likely fix is";

async function incident(n, body, res) {
  switch (n) {
    case 1:
      await sleep(2100);
      return send(res, 200, message(body, [
        text("I'll read the checkout log and look up the incident ticket."),
        tool("toolu_01", "read_file", { path: "logs/checkout.log" }),
        tool("toolu_02", "get_ticket", { id: "INC-2041" }),
      ], "tool_use", 96));
    case 2:
      await sleep(3300);
      return send(res, 200, message(body, [tool("toolu_03", "get_ticket", { id: "INC-2041" })], "tool_use", 38));
    case 3:
      await sleep(280);
      return send(
        res,
        429,
        { type: "error", error: { type: "rate_limit_error", message: "Number of request tokens has exceeded your per-minute rate limit" } },
        { "retry-after": "1" },
      );
    case 4:
      await sleep(3000);
      return send(res, 200, message(body, [tool("toolu_04", "get_ticket", { id: "INC-2041" })], "tool_use", 41));
    case 5:
      await sleep(4700);
      return send(res, 200, message(body, [text(CUT_OFF)], "max_tokens", body.max_tokens ?? 300));
    default:
      await sleep(2300);
      return send(res, 200, message(body, [tool("toolu_06", "submit", { summary: SUMMARY })], "tool_use", 74));
  }
}

async function incidentFixed(n, body, res) {
  switch (n) {
    case 1:
      await sleep(1900);
      return send(res, 200, message(body, [
        text("I'll read the errors in the checkout log and look up the incident ticket."),
        tool("toolu_11", "read_file", { path: "logs/checkout.log", grep: "ERROR" }),
        tool("toolu_12", "get_ticket", { id: "INC-2041" }),
      ], "tool_use", 104));
    case 2:
      await sleep(2600);
      return send(res, 200, message(body, [tool("toolu_13", "submit", { summary: SUMMARY })], "tool_use", 81));
    default:
      await sleep(3400);
      return send(res, 200, message(body, [
        text(
          "Filed. Checkout failed because the payment worker ran out of database connections at 23:12; " +
            "requests timed out until it restarted at 23:41. Raise the pool size and stop the web tier " +
            "from retrying timed-out payments.",
        ),
      ], "end_turn", 212));
  }
}

// A one-call summarizer in OpenAI format, so `stats` has a second script and model to show.
async function summarize(n, body, res) {
  await sleep(1700);
  const prompt = tokens(body.messages);
  return send(res, 200, {
    id: `chatcmpl-${Math.random().toString(36).slice(2, 12)}`,
    object: "chat.completion",
    model: body.model,
    choices: [{
      index: 0,
      message: { role: "assistant", content: "Checkout was down from 23:12 to 23:41: the payment worker ran out of database connections." },
      finish_reason: "stop",
    }],
    usage: { prompt_tokens: prompt, completion_tokens: 164, total_tokens: prompt + 164 },
  });
}

const SCENARIOS = { incident, "incident-fixed": incidentFixed, summarize };

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    let body = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}");
    } catch {
      return send(res, 400, { error: { type: "invalid_request_error", message: "request body is not JSON" } });
    }
    const match = /^\/([^/]+)\/([^/]+)\/v1\/(messages|chat\/completions)$/.exec(req.url.split("?")[0]);
    const scenario = match && SCENARIOS[match[1]];
    if (!scenario) return send(res, 404, { error: { type: "not_found_error", message: `no route for ${req.url}` } });
    const key = `${match[1]}/${match[2]}`;
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    scenario(n, body, res).catch((err) => send(res, 500, { error: { type: "api_error", message: String(err) } }));
  });
});

server.listen(PORT, "127.0.0.1", () => process.stdout.write(`demo API on http://127.0.0.1:${server.address().port}\n`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
