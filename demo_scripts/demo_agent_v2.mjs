import { startMockLlmServer } from "./mock_server.mjs";

const server = await startMockLlmServer();
const url = `${server.url}/v1/chat/completions`;

console.log("[Agent Startup] Starting Financial Analysis Agent V2 (Optimized)...");

const res1 = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    model: "gpt-4o-mini", // Changed model to gpt-4o-mini
    messages: [
      { role: "system", content: "You are a concise financial agent." },
      { role: "user", content: "Tesla Q4 2024 revenue summary." },
    ],
  }),
});
await res1.json();

await new Promise((r) => setTimeout(r, 100));
await server.close();
console.log("[Agent V2 Complete] Agent V2 workflow completed.");
