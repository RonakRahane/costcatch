import { describe, it, expect } from "vitest";
import { detectProvider, isLLMApiCall, getProviderNames } from "../../../src/providers/registry.js";

describe("Provider Registry", () => {
  describe("detectProvider", () => {
    it("detects OpenAI from URL", () => {
      const provider = detectProvider("https://api.openai.com/v1/chat/completions");
      expect(provider.name).toBe("openai");
    });

    it("detects Anthropic from URL", () => {
      const provider = detectProvider("https://api.anthropic.com/v1/messages");
      expect(provider.name).toBe("anthropic");
    });

    it("detects OpenRouter from URL", () => {
      const provider = detectProvider("https://openrouter.ai/api/v1/chat/completions");
      expect(provider.name).toBe("openrouter");
    });

    it("detects Groq from URL", () => {
      const provider = detectProvider("https://api.groq.com/openai/v1/chat/completions");
      expect(provider.name).toBe("groq");
    });

    it("detects Mistral from URL", () => {
      const provider = detectProvider("https://api.mistral.ai/v1/chat/completions");
      expect(provider.name).toBe("mistral");
    });

    it("detects Google Gemini from URL", () => {
      const provider = detectProvider("https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent");
      expect(provider.name).toBe("google");
    });

    it("detects Ollama from localhost URL", () => {
      const provider = detectProvider("http://localhost:11434/api/chat");
      expect(provider.name).toBe("ollama");
    });

    it("detects Cohere from URL", () => {
      const provider = detectProvider("https://api.cohere.com/v2/chat");
      expect(provider.name).toBe("cohere");
    });

    it("detects Azure OpenAI from URL", () => {
      const provider = detectProvider("https://my-resource.openai.azure.com/openai/deployments/gpt-4/chat/completions");
      expect(provider.name).toBe("openai");
    });

    it("falls back to generic for unknown URLs with /chat/completions", () => {
      const provider = detectProvider("https://my-custom-proxy.com/v1/chat/completions");
      expect(provider.name).toBe("generic");
    });

    it("falls back to generic for totally unknown URLs", () => {
      const provider = detectProvider("https://random-api.com/do-something");
      expect(provider.name).toBe("generic");
    });
  });

  describe("isLLMApiCall", () => {
    it("returns true for known LLM API URLs", () => {
      expect(isLLMApiCall("https://api.openai.com/v1/chat/completions")).toBe(true);
      expect(isLLMApiCall("https://api.anthropic.com/v1/messages")).toBe(true);
      expect(isLLMApiCall("https://api.groq.com/openai/v1/chat/completions")).toBe(true);
    });

    it("returns true for generic /chat/completions URLs", () => {
      expect(isLLMApiCall("https://my-proxy.com/v1/chat/completions")).toBe(true);
    });

    it("returns false for non-LLM URLs", () => {
      expect(isLLMApiCall("https://api.github.com/repos")).toBe(false);
      expect(isLLMApiCall("https://google.com")).toBe(false);
    });
  });

  describe("getProviderNames", () => {
    it("returns all 9 registered provider names", () => {
      const names = getProviderNames();
      expect(names).toContain("openai");
      expect(names).toContain("anthropic");
      expect(names).toContain("openrouter");
      expect(names).toContain("groq");
      expect(names).toContain("mistral");
      expect(names).toContain("google");
      expect(names).toContain("ollama");
      expect(names).toContain("cohere");
      expect(names).toContain("generic");
      expect(names).toHaveLength(9);
    });
  });
});
