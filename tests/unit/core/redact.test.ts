/**
 * Adversarial redaction tests.
 *
 * The redaction module is the ONE module where a passing happy-path test can
 * still ship a real leak. These tests cover:
 *   - Secrets nested inside JSON body values
 *   - Secrets as substrings of longer strings
 *   - Multiple secrets in the same string
 *   - Secrets inside prompt content (not just headers)
 *   - Every provider key format
 *   - PII: emails, phones, Luhn-valid cards
 *   - Edge cases: empty strings, no secrets, near-matches
 */

import { describe, it, expect } from "vitest";
import { redactString, redactSecrets, looksSecret } from "../../../src/core/redact.js";

describe("redact — secrets (tier 1)", () => {
  it("scrubs OpenAI API key", () => {
    const input = "my key is sk-proj-abc123456789012345678901234567890123456789ABCDEF";
    const result = redactString(input);
    expect(result).not.toContain("sk-proj-abc");
    expect(result).toContain("«redacted»");
  });

  it("scrubs Anthropic API key", () => {
    const input = 'Authorization: Bearer sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
    const result = redactString(input);
    expect(result).not.toContain("sk-ant-api03");
    expect(result).toContain("«redacted»");
  });

  it("scrubs Google API key", () => {
    const input = 'Using AIzaSyB1234567890abcdefghijklmnopqrstuv_w as key';
    const result = redactString(input);
    expect(result).not.toContain("AIzaSyB");
    expect(result).toContain("«redacted»");
  });

  it("scrubs AWS access key ID", () => {
    const input = "export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE";
    const result = redactString(input);
    expect(result).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(result).toContain("«redacted»");
  });

  it("scrubs Groq API key", () => {
    const input = 'gsk_abc123def456ghi789jkl012mno345pqr678stu901vwx';
    const result = redactString(input);
    expect(result).not.toContain("gsk_abc");
    expect(result).toContain("«redacted»");
  });

  it("scrubs Replicate API key", () => {
    const input = 'r8_abc123def456ghi789jkl012mno345pqr678';
    const result = redactString(input);
    expect(result).not.toContain("r8_abc");
    expect(result).toContain("«redacted»");
  });

  it("scrubs GitHub PAT", () => {
    const input = 'ghp_abcdefghijklmnopqrstuvwxyzABCDEFGH1234';
    const result = redactString(input);
    expect(result).not.toContain("ghp_abcdefg");
    expect(result).toContain("«redacted»");
  });

  it("scrubs Slack token", () => {
    const input = 'xoxb-1234567890-abcdefghij';
    const result = redactString(input);
    expect(result).not.toContain("xoxb-");
    expect(result).toContain("«redacted»");
  });

  it("scrubs Bearer token in Authorization header", () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc123';
    const result = redactString(input);
    expect(result).toContain("Bearer");
    expect(result).toContain("«redacted»");
    expect(result).not.toContain("eyJhbGci");
  });

  it("scrubs labeled secret pairs (api_key: value)", () => {
    const input = '"api_key": "my-super-secret-key-value-12345"';
    const result = redactString(input);
    expect(result).toContain('"api_key"');
    expect(result).toContain("«redacted»");
    expect(result).not.toContain("my-super-secret");
  });

  it("scrubs labeled secret pairs (password=value)", () => {
    const input = 'password=verylongsecretpasswordvalue1234';
    const result = redactString(input);
    expect(result).toContain("password");
    expect(result).toContain("«redacted»");
    expect(result).not.toContain("verylongsecretpassword");
  });

  it("scrubs x-api-key header value", () => {
    const input = '"x-api-key": "sk-1234567890abcdefghijklmn"';
    const result = redactString(input);
    expect(result).toContain("x-api-key");
    expect(result).toContain("«redacted»");
  });
});

describe("redact — adversarial / nested cases", () => {
  it("scrubs a secret embedded in JSON body", () => {
    const input = JSON.stringify({
      model: "gpt-4",
      messages: [
        { role: "system", content: "You are helpful. API key: sk-proj-abc123456789012345678901234567890123456789ABCDEF" },
      ],
    });
    const result = redactString(input);
    expect(result).not.toContain("sk-proj-abc");
    expect(result).toContain("«redacted»");
    expect(result).toContain("gpt-4"); // non-secret content preserved
  });

  it("scrubs multiple different secrets in one string", () => {
    const input = `
      OpenAI: sk-proj-abc123456789012345678901234567890123456789ABCDEF
      Anthropic: sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
      Google: AIzaSyB1234567890abcdefghijklmnopqrstuv_w
    `;
    const result = redactString(input);
    expect(result).not.toContain("sk-proj-abc");
    expect(result).not.toContain("sk-ant-api03");
    expect(result).not.toContain("AIzaSyB");
    // 3 redacted tokens
    expect((result.match(/«redacted»/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it("scrubs a secret that is a substring of a longer word", () => {
    const input = 'prefix_sk-proj-abc123456789012345678901234567890123456789ABCDEF_suffix';
    const result = redactString(input);
    expect(result).not.toContain("sk-proj-abc");
    expect(result).toContain("«redacted»");
  });

  it("preserves non-secret content that looks similar", () => {
    // "sk-" followed by short string should NOT be redacted (< 20 chars)
    const input = 'sk-short is not a key';
    const result = redactString(input);
    expect(result).toBe(input);
  });

  it("scrubs secrets inside a tool result echo", () => {
    const input = `[tool_result] The environment variable OPENAI_API_KEY is set to sk-proj-abc123456789012345678901234567890123456789ABCDEF`;
    const result = redactString(input);
    expect(result).not.toContain("sk-proj-abc");
    expect(result).toContain("[tool_result]");
  });

  it("handles empty string without error", () => {
    expect(redactString("")).toBe("");
  });

  it("handles string with no secrets", () => {
    const input = "This is a perfectly normal prompt about cooking pasta.";
    expect(redactString(input)).toBe(input);
  });
});

describe("redact — PII (tier 2)", () => {
  it("scrubs email addresses", () => {
    const input = "Contact me at john.doe@example.com for details";
    const result = redactString(input);
    expect(result).not.toContain("john.doe@example.com");
    expect(result).toContain("«email»");
  });

  it("scrubs phone numbers with separators", () => {
    const input = "Call me at +1 415-555-1234";
    const result = redactString(input);
    expect(result).toContain("«phone»");
    expect(result).not.toContain("415-555-1234");
  });

  it("scrubs phone numbers with dots", () => {
    const input = "My number is 415.555.1234";
    const result = redactString(input);
    expect(result).toContain("«phone»");
  });

  it("does NOT scrub 10-digit numbers without separators (avoids false positives)", () => {
    const input = "Token count is 1234567890";
    const result = redactString(input);
    expect(result).not.toContain("«phone»");
  });

  it("scrubs Luhn-valid credit card numbers", () => {
    // 4111 1111 1111 1111 is the classic Visa test card (passes Luhn)
    const input = "Card: 4111 1111 1111 1111";
    const result = redactString(input);
    expect(result).toContain("«card»");
    expect(result).not.toContain("4111");
  });

  it("does NOT scrub non-Luhn digit sequences", () => {
    const input = "ID: 1234 5678 9012 3456";
    const result = redactString(input);
    // This should NOT be redacted (doesn't pass Luhn)
    expect(result).not.toContain("«card»");
  });

  it("skips PII when pii=false", () => {
    const input = "Email: user@example.com, Phone: 415-555-1234";
    const result = redactString(input, false);
    // PII preserved
    expect(result).toContain("user@example.com");
    expect(result).toContain("415-555-1234");
  });
});

describe("looksSecret", () => {
  it("returns true for string containing OpenAI key", () => {
    expect(looksSecret("here is sk-proj-abc123456789012345678901234567890123456789ABCDEF okay")).toBe(true);
  });

  it("returns false for clean string", () => {
    expect(looksSecret("just a normal prompt")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(looksSecret("")).toBe(false);
  });
});
