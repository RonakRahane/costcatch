/**
 * `costcatch estimate` command.
 *
 * Takes a prompt file (or stdin/inline text) and a model name, estimates
 * token count, and reports projected input cost — before you ever hit the API.
 *
 * Input sources (priority order):
 *   1. File path:  `costcatch estimate prompt.txt --model gpt-4o`
 *   2. Stdin pipe:  `cat prompt.md | costcatch estimate --model claude-sonnet-4`
 *   3. Inline text: `costcatch estimate --text "You are a helpful assistant..."`
 *
 * Multi-model comparison:
 *   `costcatch estimate prompt.txt --model gpt-4o,claude-sonnet-4,gemini-2.0-flash`
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  estimateTokens,
  estimateSections,
  type EstimateResult,
} from "../core/token-estimator.js";
import { getModelPricing } from "../pricing/pricing-db.js";
import {
  renderSingleEstimate,
  renderComparison,
  renderEstimateJson,
} from "../renderers/estimate.js";
import { c, dim, glyph } from "../ui/theme.js";
import { formatCost } from "../core/cost-calculator.js";
import { ExitCode } from "./exit-codes.js";

/** Thrown for user-input problems so the caller can map them to an exit code. */
class EstimateInputError extends Error {}

/** Options for the estimate command. */
export interface EstimateFlags {
  /** Target model(s), comma-separated */
  model: string;
  /** Inline prompt text */
  text?: string;
  /** Show per-section breakdown */
  breakdown: boolean;
  /** Machine-readable JSON output */
  json: boolean;
  /** Disable color */
  noColor: boolean;
  /** CI gate: exit 1 if estimated cost exceeds this */
  maxCost?: number;
}

/** Default model when none specified. */
const DEFAULT_MODEL = "gpt-4o";

/**
 * Read prompt text from the available input source.
 *
 * Priority:
 *   1. --text flag (inline)
 *   2. File argument
 *   3. Stdin (only if piped, not TTY)
 */
async function readPromptInput(file: string | undefined, flags: EstimateFlags): Promise<{ text: string; fileName: string }> {
  // 1. Inline text
  if (flags.text) {
    return { text: flags.text, fileName: "<inline>" };
  }

  // 2. File argument
  if (file) {
    const filePath = path.resolve(file);

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      throw new EstimateInputError(`File not found: ${file}`);
    }
    if (stat.isDirectory()) {
      throw new EstimateInputError(`Expected a file, got a directory: ${file}`);
    }
    if (stat.size > MAX_INPUT_BYTES) {
      throw new EstimateInputError(
        `File too large (${(stat.size / 1024 / 1024).toFixed(1)} MB). Max: ${MAX_INPUT_BYTES / 1024 / 1024} MB`,
      );
    }

    return { text: fs.readFileSync(filePath, "utf-8"), fileName: path.basename(filePath) };
  }

  // 3. Stdin (piped)
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of process.stdin) {
      const buf = chunk as Buffer;
      total += buf.length;
      // Bound the read: `costcatch estimate < /dev/zero` must fail fast rather
      // than buffer until the process is OOM-killed.
      if (total > MAX_INPUT_BYTES) {
        throw new EstimateInputError(
          `Input from stdin exceeds ${MAX_INPUT_BYTES / 1024 / 1024} MB — pipe a smaller prompt.`,
        );
      }
      chunks.push(buf);
    }
    const text = Buffer.concat(chunks).toString("utf-8");
    if (text.trim().length === 0) {
      throw new EstimateInputError("No input received from stdin.");
    }
    return { text, fileName: "<stdin>" };
  }

  throw new EstimateInputError(
    "No input specified.\n" +
      "    Usage: costcatch estimate <file> --model <model>\n" +
      '           costcatch estimate --text "prompt text..."\n' +
      "           cat prompt.md | costcatch estimate --model gpt-4o",
  );
}

/** Largest prompt we will tokenize, from a file or stdin. */
const MAX_INPUT_BYTES = 10 * 1024 * 1024;

/** Auto-detect active LLM model from local .env file in current working directory. */
function detectActiveModelFromEnv(): string | null {
  try {
    const envPath = path.join(process.cwd(), ".env");
    if (!fs.existsSync(envPath)) return null;

    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [key, ...valParts] = trimmed.split("=");
      const k = key.trim();
      const val = valParts.join("=").trim().replace(/^["']|["']$/g, "");
      if ((k === "LLM_MODEL" || k === "MODEL" || k === "OPENROUTER_MODEL" || k === "OPENAI_MODEL" || k === "GEMINI_MODEL") && val) {
        return val;
      }
    }
  } catch {
    // Ignore errors
  }
  return null;
}

/**
 * Parse the --model flag into an array of model names.
 * Supports comma-separated: "gpt-4o,claude-sonnet-4,gemini-2.0-flash"
 */
function parseModels(modelFlag: string): string[] {
  return modelFlag
    .split(",")
    .map((m) => m.trim())
    .filter((m) => m.length > 0);
}

/**
 * Build an EstimateResult for one model.
 */
function buildEstimate(
  text: string,
  model: string,
  breakdown: boolean,
): EstimateResult {
  const estimate = estimateTokens(text, model);
  const pricing = getModelPricing(model);

  let costUsd: number | null = null;
  if (pricing) {
    costUsd = estimate.tokens * pricing.inputCostPerToken;
    // Round to 6 decimal places
    costUsd = Math.round(costUsd * 1_000_000) / 1_000_000;
  }

  const sections = breakdown ? estimateSections(text, model) : null;

  return { model, estimate, costUsd, sections };
}

/**
 * Main estimate command handler.
 */
export async function estimateCommand(file: string | undefined, flags: EstimateFlags): Promise<number> {
  const useColor = !flags.noColor && !process.env.NO_COLOR;

  let text: string;
  let fileName: string;
  try {
    ({ text, fileName } = await readPromptInput(file, flags));
  } catch (err) {
    if (err instanceof EstimateInputError) {
      console.error(c("err", `\n  ${glyph.err} ${err.message}\n`));
      return ExitCode.Usage;
    }
    console.error(c("err", `\n  ${glyph.err} ${err instanceof Error ? err.message : String(err)}\n`));
    return ExitCode.Internal;
  }

  let rawModel = flags.model;
  if (!rawModel) {
    const envModel = detectActiveModelFromEnv();
    if (envModel) {
      rawModel = envModel;
    }
  }

  if (!rawModel) {
    console.error(
      c("warn", `\n  ${glyph.warn} No model specified and no LLM_MODEL found in .env`) +
        dim(`\n\n  Please specify a model using --model <name> or set LLM_MODEL in your .env file.`) +
        dim(`\n  Example: costcatch estimate ${fileName || "prompt.py"} --model deepseek/deepseek-v4-pro\n`),
    );
    return ExitCode.Usage;
  }

  const models = parseModels(rawModel);

  // Build estimates for all models
  const results: EstimateResult[] = models.map((model) =>
    buildEstimate(text, model, flags.breakdown),
  );

  // ── Render output ──

  if (flags.json) {
    console.log(renderEstimateJson(results, fileName));
  } else if (results.length === 1) {
    console.log(renderSingleEstimate(results[0], fileName, useColor));
  } else {
    console.log(renderComparison(results, fileName, useColor));
  }

  // ── CI gate ──
  if (flags.maxCost !== undefined) {
    // An unpriced model cannot clear a cost gate. Passing it would make
    // `--max-cost` quietly permissive for exactly the models we know least about.
    if (results.some((r) => r.costUsd === null)) {
      const unknown = results.filter((r) => r.costUsd === null).map((r) => r.model);
      console.error(
        c("err", `\n  ${glyph.err} CI GATE: no pricing for ${unknown.join(", ")} — cannot evaluate --max-cost.`),
      );
      console.error(dim("    Run `costcatch init` to refresh the pricing database.\n"));
      return ExitCode.GateFailed;
    }
    const maxEstimatedCost = Math.max(...results.map((r) => r.costUsd ?? 0));
    if (maxEstimatedCost > flags.maxCost) {
      console.error(
        c(
          "err",
          `\n  ${glyph.err} CI GATE: estimated cost ${formatCost(maxEstimatedCost)} exceeds --max-cost ${formatCost(flags.maxCost)}`,
        ),
      );
      return ExitCode.GateFailed;
    }
  }

  return ExitCode.Success;
}
