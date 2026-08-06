/**
 * Content extractor tests.
 *
 * Covers:
 *   - OpenAI request/response parsing (messages + choices)
 *   - Anthropic request/response parsing (top-level system + content blocks)
 *   - Google Gemini request/response parsing (contents/candidates)
 *   - Multimodal content blocks (image_url, tool_use, tool_result)
 *   - Error extraction (OpenAI, Anthropic, generic)
 *   - Truncation of long fields
 *   - Redaction within extracted content
 *   - Generic/unknown provider fallback
 *   - Null/empty bodies
 */

import { describe, it, expect } from "vitest";
import { extractContent, extractError } from "../../../src/core/content-extractor.js";

describe("extractContent — OpenAI format", () => {
  it("extracts system prompt, messages, and output from OpenAI shape", () => {
    const reqBody = {
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "What is 2+2?" },
      ],
    };
    const resBody = {
      choices: [{ message: { role: "assistant", content: "2+2 equals 4." } }],
    };

    const result = extractContent(reqBody, resBody, "openai");

    expect(result.system).toBe("You are a helpful assistant.");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("user");
    expect(result.messages[0].content).toBe("What is 2+2?");
    expect(result.output).toBe("2+2 equals 4.");
    expect(result.truncated).toBe(false);
  });

  it("handles multimodal content blocks", () => {
    const reqBody = {
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this image." },
            { type: "image_url", image_url: { url: "data:image/png;base64,..." } },
          ],
        },
      ],
    };
    const resBody = {
      choices: [{ message: { role: "assistant", content: "I see a cat." } }],
    };

    const result = extractContent(reqBody, resBody, "openai");
    expect(result.messages[0].content).toContain("Describe this image.");
    expect(result.messages[0].content).toContain("[image]");
    expect(result.output).toBe("I see a cat.");
  });
});

describe("extractContent — Anthropic format", () => {
  it("extracts top-level system and content blocks", () => {
    const reqBody = {
      model: "claude-sonnet-4-20250514",
      system: "You are Claude, a helpful AI assistant.",
      messages: [
        { role: "user", content: "Hello!" },
        { role: "assistant", content: "Hi there!" },
        { role: "user", content: "What can you do?" },
      ],
    };
    const resBody = {
      content: [{ type: "text", text: "I can help with many tasks." }],
    };

    const result = extractContent(reqBody, resBody, "anthropic");
    expect(result.system).toBe("You are Claude, a helpful AI assistant.");
    expect(result.messages).toHaveLength(3);
    expect(result.messages[0].role).toBe("user");
    expect(result.messages[0].content).toBe("Hello!");
    expect(result.output).toBe("I can help with many tasks.");
  });

  it("handles Anthropic content blocks with tool_use", () => {
    const reqBody = {
      model: "claude-sonnet-4-20250514",
      system: "Use tools when needed.",
      messages: [{ role: "user", content: "Search for cats." }],
    };
    const resBody = {
      content: [
        { type: "text", text: "Let me search for that." },
        { type: "tool_use", id: "tool_1", name: "web_search", input: { query: "cats" } },
      ],
    };

    const result = extractContent(reqBody, resBody, "anthropic");
    expect(result.output).toContain("Let me search for that.");
    expect(result.output).toContain("[tool_use web_search]");
  });

  it("handles Anthropic system as array of content blocks", () => {
    const reqBody = {
      model: "claude-sonnet-4-20250514",
      system: [{ type: "text", text: "You are a helpful assistant." }],
      messages: [{ role: "user", content: "Hi" }],
    };
    const resBody = {
      content: [{ type: "text", text: "Hello!" }],
    };

    const result = extractContent(reqBody, resBody, "anthropic");
    expect(result.system).toBe("You are a helpful assistant.");
  });
});

describe("extractContent — Google Gemini format", () => {
  it("extracts contents and candidates", () => {
    const reqBody = {
      contents: [
        { role: "user", parts: [{ text: "Hello Gemini" }] },
      ],
    };
    const resBody = {
      candidates: [
        { content: { role: "model", parts: [{ text: "Hello! How can I help?" }] } },
      ],
    };

    const result = extractContent(reqBody, resBody, "google");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("user");
    expect(result.messages[0].content).toContain("Hello Gemini");
    expect(result.output).toContain("Hello! How can I help?");
  });
});

describe("extractContent — edge cases", () => {
  it("handles null request body", () => {
    const result = extractContent(null, null, "openai");
    expect(result.system).toBeNull();
    expect(result.messages).toHaveLength(0);
    expect(result.output).toBeNull();
  });

  it("handles empty messages array", () => {
    const result = extractContent({ messages: [] }, {}, "openai");
    expect(result.messages).toHaveLength(0);
  });

  it("redacts secrets in extracted content", () => {
    const reqBody = {
      messages: [
        { role: "user", content: "Use this key: sk-proj-abc123456789012345678901234567890123456789ABCDEF" },
      ],
    };
    const resBody = {
      choices: [{ message: { role: "assistant", content: "Got it." } }],
    };

    const result = extractContent(reqBody, resBody, "openai");
    expect(result.messages[0].content).toContain("«redacted»");
    expect(result.messages[0].content).not.toContain("sk-proj-abc");
  });

  it("truncates very long system prompts", () => {
    const longSystem = "x".repeat(10000);
    const reqBody = {
      messages: [
        { role: "system", content: longSystem },
        { role: "user", content: "Hi" },
      ],
    };
    const result = extractContent(reqBody, {}, "openai");
    expect(result.system!.length).toBeLessThan(longSystem.length);
    expect(result.truncated).toBe(true);
    expect(result.system).toContain("…[truncated");
  });
});

describe("extractError", () => {
  it("extracts OpenAI error shape", () => {
    const body = {
      error: {
        message: "Rate limit exceeded",
        type: "rate_limit_error",
        code: "rate_limit_exceeded",
      },
    };
    const err = extractError(body);
    expect(err).not.toBeNull();
    expect(err!.type).toBe("rate_limit_error");
    expect(err!.message).toContain("Rate limit exceeded");
  });

  it("extracts Anthropic error shape", () => {
    const body = {
      type: "error",
      error: {
        type: "overloaded_error",
        message: "Overloaded",
      },
    };
    const err = extractError(body);
    expect(err).not.toBeNull();
    expect(err!.type).toBe("overloaded_error");
    expect(err!.message).toBe("Overloaded");
  });

  it("handles raw string body (HTML error page)", () => {
    const err = extractError("<html>500 Internal Server Error</html>");
    expect(err).not.toBeNull();
    expect(err!.message).toContain("500 Internal Server Error");
  });

  it("returns null for null body", () => {
    expect(extractError(null)).toBeNull();
  });

  it("returns generic error for body without error field", () => {
    const err = extractError({ status: "fail" });
    expect(err).not.toBeNull();
    expect(err!.message).toContain("non-2xx");
  });

  it("redacts secrets in error messages", () => {
    const body = {
      error: {
        message: "Invalid API Key sk-proj-abc123456789012345678901234567890123456789ABCDEF",
        type: "authentication_error",
      },
    };
    const err = extractError(body);
    expect(err!.message).toContain("«redacted»");
    expect(err!.message).not.toContain("sk-proj-abc");
  });
});
