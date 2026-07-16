/**
 * Live controller — orchestrates a traced run's terminal experience.
 *
 * Owns the single render loop: it drains the NDJSON tail, folds "start"/"end"
 * records into live state, and repaints the pinned region ~12×/second while the
 * child's own output scrolls above. On exit it tears the region down and returns
 * the final trace for the caller to render statically.
 *
 * Also provides `runPlain` for non-TTY / CI / --json / --quiet: no cursor
 * control, one append-only line per completed call.
 */

import { createNdjsonTail } from "../core/ndjson-tail.js";
import { readCapturedCalls, cleanupOutputFile, type SpawnHandle } from "../core/tracer.js";
import { buildTrace } from "../core/trace-builder.js";
import { isStartRecord, type RawHttpCall, type Trace, type LLMStep } from "../types/trace.js";
import type { Runtime } from "../types/config.js";
import { createLiveRegion } from "./live-region.js";
import { renderLiveFrame, renderBootFrame, type InflightCall, type LiveState } from "../renderers/live-tree.js";
import { glyph } from "./theme.js";
import { formatCost } from "../core/cost-calculator.js";

const FRAME_MS = 80;

export interface RunContext {
  script: string;
  runtime: Runtime;
  command: string;
  startedAt: string; // ISO
  showCost: boolean;
  filter?: string;
}

/** Apply the optional provider filter to a set of steps. */
function filterSteps(steps: LLMStep[], filter?: string): LLMStep[] {
  if (!filter) return steps;
  return steps.filter((s) => s.provider === filter);
}

/** Fold accumulated completed calls into live totals + steps. */
function deriveState(
  completedCalls: RawHttpCall[],
  inflight: InflightCall[],
  ctx: RunContext,
  startedAtMs: number,
): LiveState {
  const trace = buildTrace(completedCalls, ctx.script, ctx.runtime, ctx.command, ctx.startedAt);
  const steps = filterSteps(trace.steps as LLMStep[], ctx.filter);

  let inTok = 0;
  let outTok = 0;
  let cost = 0;
  let costKnown = steps.length > 0;
  for (const s of steps) {
    inTok += s.inputTokens ?? 0;
    outTok += s.outputTokens ?? 0;
    if (s.costUsd === null) costKnown = false;
    else cost += s.costUsd;
  }

  return {
    script: ctx.script,
    runtime: ctx.runtime,
    completed: steps,
    inflight,
    startedAtMs,
    totalInputTokens: inTok,
    totalOutputTokens: outTok,
    totalCostUsd: cost,
    costKnown,
    showCost: ctx.showCost,
  };
}

/**
 * Run with the full live TUI (TTY only). Returns the final trace + exit code.
 * The pinned region is cleared before returning, so the caller prints the final
 * static tree exactly once.
 */
export async function runLive(
  handle: SpawnHandle,
  ctx: RunContext,
): Promise<{ trace: Trace; exitCode: number }> {
  const region = createLiveRegion();
  const tail = createNdjsonTail(handle.outputFile);
  const startedAtMs = Date.now();

  const inflight = new Map<number, InflightCall>();
  const completedCalls: RawHttpCall[] = [];
  let tick = 0;

  // Forward child output above the pinned region.
  handle.child.stdout?.on("data", (chunk) => region.writePassthrough(chunk, process.stdout));
  handle.child.stderr?.on("data", (chunk) => region.writePassthrough(chunk, process.stderr));

  function drain(): void {
    for (const rec of tail.poll()) {
      if (isStartRecord(rec)) {
        inflight.set(rec.id, {
          id: rec.id,
          model: rec.model,
          provider: rec.provider ?? "unknown",
          startMs: rec.startMs,
        });
      } else {
        if (typeof rec.id === "number") inflight.delete(rec.id);
        completedCalls.push(rec);
      }
    }
  }

  function paint(): void {
    // A render error must never crash the traced run or leak the cursor —
    // just skip this frame and keep going.
    try {
      drain();
      const state = deriveState(completedCalls, [...inflight.values()], ctx, startedAtMs);
      region.update(
        tick === 0 && completedCalls.length === 0 && inflight.size === 0
          ? renderBootFrame(tick)
          : renderLiveFrame(state, tick, Date.now()),
      );
    } catch {
      // swallow — the final static render is authoritative
    }
    tick++;
  }

  const timer = setInterval(paint, FRAME_MS);
  paint(); // paint immediately so the box appears at once

  const exitCode = await handle.done;

  clearInterval(timer);
  drain(); // final drain to catch the last records
  region.stop();

  const calls = readCapturedCalls(handle.outputFile);
  cleanupOutputFile(handle.outputFile);
  const trace = buildTrace(calls, ctx.script, ctx.runtime, ctx.command, ctx.startedAt);
  if (ctx.filter) trace.steps = filterSteps(trace.steps as LLMStep[], ctx.filter);

  return { trace, exitCode };
}

/**
 * Run without cursor control (non-TTY / CI / --json / --quiet).
 *
 * @param opts.progressive  print one plain line per completed call as it lands.
 * @param opts.childToStderr forward the child's stdout+stderr to OUR stderr
 *   (used by --json so stdout stays a pure JSON document for piping to jq).
 *   Requires the handle to have been spawned with pipeChildOutput: true.
 */
export async function runPlain(
  handle: SpawnHandle,
  ctx: RunContext,
  opts: { progressive: boolean; childToStderr?: boolean },
): Promise<{ trace: Trace; exitCode: number }> {
  const tail = createNdjsonTail(handle.outputFile);
  const completedCalls: RawHttpCall[] = [];

  if (opts.childToStderr) {
    handle.child.stdout?.on("data", (chunk) => process.stderr.write(chunk));
    handle.child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  }

  const drain = () => {
    for (const rec of tail.poll()) {
      if (isStartRecord(rec)) continue;
      completedCalls.push(rec);
      if (opts.progressive) {
        const t = buildTrace([rec], ctx.script, ctx.runtime, ctx.command, ctx.startedAt);
        const s = t.steps[0] as LLMStep | undefined;
        if (s) {
          const tok = s.inputTokens !== null ? `${s.inputTokens}→${s.outputTokens} tok` : "tokens ?";
          const cost = ctx.showCost ? `  ${formatCost(s.costUsd)}` : "";
          process.stdout.write(`  ${glyph.ok} ${s.model}  ${tok}${cost}\n`);
        }
      }
    }
  };

  const timer = opts.progressive ? setInterval(drain, 150) : null;
  const exitCode = await handle.done;
  if (timer) clearInterval(timer);
  drain();

  const calls = readCapturedCalls(handle.outputFile);
  cleanupOutputFile(handle.outputFile);
  const trace = buildTrace(calls, ctx.script, ctx.runtime, ctx.command, ctx.startedAt);
  if (ctx.filter) trace.steps = filterSteps(trace.steps as LLMStep[], ctx.filter);

  return { trace, exitCode };
}
