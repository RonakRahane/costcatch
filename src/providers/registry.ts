/**
 * Provider registry.
 *
 * Auto-detects which LLM provider an HTTP call belongs to based on the URL.
 * Providers are checked in order — first match wins.
 * The generic provider is always last as a catch-all fallback.
 */

import type { Provider } from "../types/provider.js";
import { openaiProvider } from "./openai.js";
import { anthropicProvider } from "./anthropic.js";
import { openrouterProvider } from "./openrouter.js";
import { groqProvider } from "./groq.js";
import { mistralProvider } from "./mistral.js";
import { googleProvider } from "./google.js";
import { ollamaProvider } from "./ollama.js";
import { cohereProvider } from "./cohere.js";
import { genericProvider } from "./generic.js";

/**
 * Ordered list of providers. Specific providers first, generic last.
 * Order matters: OpenRouter must be before generic (both match /chat/completions).
 */
const providers: Provider[] = [
  openaiProvider,
  anthropicProvider,
  openrouterProvider,
  groqProvider,
  mistralProvider,
  googleProvider,
  ollamaProvider,
  cohereProvider,
  genericProvider,
];

/**
 * Detect which provider an HTTP request belongs to based on the URL.
 * Returns the generic provider if no specific match is found.
 */
export function detectProvider(url: string): Provider {
  for (const provider of providers) {
    if (provider.urlPatterns.some((pattern) => pattern.test(url))) {
      return provider;
    }
  }
  return genericProvider;
}

/**
 * Check if a URL looks like an LLM API call.
 * Used by interceptors to filter out non-LLM HTTP traffic.
 */
export function isLLMApiCall(url: string): boolean {
  for (const provider of providers) {
    if (provider.urlPatterns.some((pattern) => pattern.test(url))) {
      return true;
    }
  }
  return false;
}

/** Get a provider by name. Useful for filtering. */
export function getProviderByName(name: string): Provider | undefined {
  return providers.find((p) => p.name === name);
}

/** Get all registered provider names. */
export function getProviderNames(): string[] {
  return providers.map((p) => p.name);
}
