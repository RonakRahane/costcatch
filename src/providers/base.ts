/**
 * Base provider utilities.
 *
 * Shared helpers used by multiple provider parsers to reduce duplication.
 */

import type { ToolCall } from "../types/trace.js";

/**
 * Safely extract a string field from an unknown object.
 * Returns the fallback if the field is missing or not a string.
 */
export function getString(obj: unknown, key: string, fallback: string = ""): string {
  if (obj !== null && typeof obj === "object" && key in obj) {
    const val = (obj as Record<string, unknown>)[key];
    return typeof val === "string" ? val : fallback;
  }
  return fallback;
}

/**
 * Safely extract a number field from an unknown object.
 * Returns null if the field is missing or not a number.
 */
export function getNumber(obj: unknown, key: string): number | null {
  if (obj !== null && typeof obj === "object" && key in obj) {
    const val = (obj as Record<string, unknown>)[key];
    return typeof val === "number" ? val : null;
  }
  return null;
}

/**
 * Safely extract a nested object field.
 * Returns null if the field is missing or not an object.
 */
export function getObject(obj: unknown, key: string): Record<string, unknown> | null {
  if (obj !== null && typeof obj === "object" && key in obj) {
    const val = (obj as Record<string, unknown>)[key];
    return val !== null && typeof val === "object" ? (val as Record<string, unknown>) : null;
  }
  return null;
}

/**
 * Safely extract a boolean field from an unknown object.
 * Returns the fallback if the field is missing or not a boolean.
 */
export function getBoolean(obj: unknown, key: string, fallback: boolean = false): boolean {
  if (obj !== null && typeof obj === "object" && key in obj) {
    const val = (obj as Record<string, unknown>)[key];
    return typeof val === "boolean" ? val : fallback;
  }
  return fallback;
}

/**
 * Safely extract an array field from an unknown object.
 * Returns an empty array if the field is missing or not an array.
 */
export function getArray(obj: unknown, key: string): unknown[] {
  if (obj !== null && typeof obj === "object" && key in obj) {
    const val = (obj as Record<string, unknown>)[key];
    return Array.isArray(val) ? val : [];
  }
  return [];
}

/**
 * Parse tool calls from OpenAI-compatible format.
 * Used by OpenAI, Groq, Mistral, OpenRouter, and generic providers.
 *
 * Expected shape:
 * ```json
 * { "tool_calls": [{ "function": { "name": "...", "arguments": "..." } }] }
 * ```
 */
export function parseOpenAIToolCalls(message: unknown): ToolCall[] {
  const toolCallsRaw = getArray(message, "tool_calls");
  const result: ToolCall[] = [];

  for (const tc of toolCallsRaw) {
    const fn = getObject(tc, "function");
    if (!fn) continue;

    const name = getString(fn, "name", "unknown");
    const argsStr = getString(fn, "arguments", "{}");

    let input: Record<string, unknown> = {};
    try {
      input = JSON.parse(argsStr);
    } catch {
      // Arguments may not be valid JSON (e.g. partial streaming).
      // Store the raw string so the user can still see something.
      input = { _raw: argsStr };
    }

    result.push({ name, input });
  }

  return result;
}
