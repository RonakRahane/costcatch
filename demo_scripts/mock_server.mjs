import * as http from "node:http";

export function startMockLlmServer() {
  let callCount = 0;

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));

    req.on("end", () => {
      callCount++;
      const reqJson = JSON.parse(body || "{}");
      res.writeHead(200, { "content-type": "application/json" });

      if (callCount === 1) {
        // Step 1: Tool call request
        res.end(
          JSON.stringify({
            id: "chatcmpl-step1",
            model: "gpt-4o",
            choices: [
              {
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call_web_search_01",
                      type: "function",
                      function: {
                        name: "web_search",
                        arguments: JSON.stringify({ query: "Tesla Q4 2024 financial revenue" }),
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
            usage: { prompt_tokens: 1203, completion_tokens: 87, total_tokens: 1290 },
          })
        );
      } else if (callCount === 2) {
        // Step 2: Context growth with second call
        res.end(
          JSON.stringify({
            id: "chatcmpl-step2",
            model: "gpt-4o",
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "According to recent reports, Tesla Q4 2024 revenue reached $25.17 billion.",
                },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 5891, completion_tokens: 92, total_tokens: 5983 },
          })
        );
      } else {
        // Step 3: Final synthesis call
        res.end(
          JSON.stringify({
            id: "chatcmpl-step3",
            model: "gpt-4o",
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "Summary complete. Total revenue analyzed.",
                },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 6100, completion_tokens: 45, total_tokens: 6145 },
          })
        );
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = addr.port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
