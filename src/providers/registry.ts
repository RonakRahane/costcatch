// Picks the provider for a request URL.

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

// The first match wins. Keep generic last, because it matches /chat/completions on any host.
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

export function detectProvider(url: string): Provider {
  for (const provider of providers) {
    if (provider.urlPatterns.some((pattern) => pattern.test(url))) {
      return provider;
    }
  }
  return genericProvider;
}

export function getProviderNames(): string[] {
  return providers.map((p) => p.name);
}
