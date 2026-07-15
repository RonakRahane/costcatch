// `costcatch estimate` counts the tokens in a prompt and prices them for one or more models.

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
import { c, dim, glyph, notice } from "../ui/theme.js";
import { formatCost, roundUsd } from "../core/cost-calculator.js";
import { ExitCode } from "./exit-codes.js";
import type { Readable } from "node:stream";

class EstimateInputError extends Error {}

export interface EstimateFlags {
  model: string;
  text?: string;
  breakdown: boolean;
  json: boolean;
  noColor: boolean;
  maxCost?: number;
}

// fileName can be a label like <stdin>, which would make a broken example.
function exampleTarget(fileName: string): string {
  return fileName.startsWith("<") ? "prompt.txt" : fileName;
}

async function readPromptInput(file: string | undefined, flags: EstimateFlags): Promise<{ text: string; fileName: string }> {
  if (flags.text) {
    return { text: flags.text, fileName: "<inline>" };
  }

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
    if (!stat.isFile()) {
      // Pipes and devices like `<(git diff)` or /dev/zero report size 0, so the size check misses them.
      const text = await readBounded(fs.createReadStream(filePath), `${file} exceeds`);
      return { text, fileName: path.basename(filePath) };
    }

    return { text: fs.readFileSync(filePath, "utf-8"), fileName: path.basename(filePath) };
  }

  if (!process.stdin.isTTY) {
    const text = await readBounded(process.stdin, "Input from stdin exceeds");
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

const MAX_INPUT_BYTES = 10 * 1024 * 1024;

async function readBounded(stream: Readable, tooLarge: string): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    total += buf.length;
    if (total > MAX_INPUT_BYTES) {
      stream.destroy();
      throw new EstimateInputError(`${tooLarge} ${MAX_INPUT_BYTES / 1024 / 1024} MB. Use a smaller prompt.`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

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
  }
  return null;
}

function parseModels(modelFlag: string): string[] {
  return modelFlag
    .split(",")
    .map((m) => m.trim())
    .filter((m) => m.length > 0);
}

function buildEstimate(
  text: string,
  model: string,
  breakdown: boolean,
): EstimateResult {
  const estimate = estimateTokens(text, model);
  const pricing = getModelPricing(model);

  let costUsd: number | null = null;
  if (pricing) {
    // Round like calculateStepCost so `estimate` and `run` agree right at the gate limit.
    costUsd = roundUsd(estimate.tokens * pricing.inputCostPerToken);
  }

  const sections = breakdown ? estimateSections(text, model) : null;

  return { model, estimate, costUsd, sections };
}

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
        dim(`\n  Example: costcatch estimate ${exampleTarget(fileName)} --model gpt-4o\n`),
    );
    return ExitCode.Usage;
  }

  const models = parseModels(rawModel);

  const results: EstimateResult[] = models.map((model) =>
    buildEstimate(text, model, flags.breakdown),
  );


  if (flags.json) {
    console.log(renderEstimateJson(results, fileName));
  } else if (results.length === 1) {
    console.log(renderSingleEstimate(results[0], fileName, useColor));
  } else {
    console.log(renderComparison(results, fileName, useColor));
  }

  if (results.length === 0) {
    // Math.max() of an empty list is -Infinity, which would pass any --max-cost gate.
    console.error(c("err", `\n  ${glyph.err} No model to estimate. Pass --model with at least one name.`));
    return ExitCode.Usage;
  }

  if (flags.maxCost !== undefined) {
    if (results.some((r) => r.costUsd === null)) {
      const unknown = results.filter((r) => r.costUsd === null).map((r) => r.model);
      console.error(
        notice("err", `CI GATE: no pricing for ${unknown.join(", ")}, cannot evaluate --max-cost.`, [
          "Run `costcatch init` to refresh the pricing database.",
        ]),
      );
      return ExitCode.GateFailed;
    }
    const maxEstimatedCost = Math.max(...results.map((r) => r.costUsd ?? 0));
    if (maxEstimatedCost > flags.maxCost) {
      console.error(
        notice(
          "err",
          `CI GATE: estimated cost ${formatCost(maxEstimatedCost)} exceeds --max-cost ${formatCost(flags.maxCost)}`,
        ),
      );
      return ExitCode.GateFailed;
    }
  }

  return ExitCode.Success;
}
