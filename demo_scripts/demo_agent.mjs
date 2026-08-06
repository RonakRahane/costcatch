import { startMockLlmServer } from "./mock_server.mjs";

const server = await startMockLlmServer();
const url = `${server.url}/v1/chat/completions`;

console.log("[Agent Startup] Starting Financial Analysis Agent...");

// Call 1
console.log("[Agent Log] Step 1: Querying LLM with initial prompt...");
const res1 = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "You are a financial research AI agent." },
      { role: "user", content: "What was Tesla's Q4 2024 revenue?" },
    ],
  }),
});
const data1 = await res1.json();
console.log("[Agent Log] Tool call received:", data1.choices[0].message.tool_calls[0].function.name);

// Call 2
console.log("[Agent Log] Step 2: Executing tool and providing context back to LLM...");
const res2 = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "You are a financial research AI agent." },
      { role: "user", content: "What was Tesla's Q4 2024 revenue?" },
      {
        role: "assistant",
        tool_calls: data1.choices[0].message.tool_calls,
      },
      {
        role: "tool",
        tool_call_id: "call_web_search_01",
        content: JSON.stringify({ results: "Tesla Q4 revenue hit $25.17B, up 3% YoY." }),
      },
    ],
  }),
});
const data2 = await res2.json();
console.log("[Agent Log] Step 2 Result:", data2.choices[0].message.content);

// Call 3
console.log("[Agent Log] Step 3: Final report generation...");
const res3 = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    model: "gpt-4o",
    messages: [
      { role: "user", content: "Summarize financial report." },
    ],
  }),
});
const data3 = await res3.json();
console.log("[Agent Log] Final Output:", data3.choices[0].message.content);

await new Promise((r) => setTimeout(r, 100));
await server.close();
console.log("[Agent Complete] Agent workflow completed successfully.");
