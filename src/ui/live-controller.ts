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
import { readCapturedCalls, type SpawnHandle } from "../core/tracer.js";
import { buildTrace } from "../core/trace-builder.js";
import { isStartRecord, type RawHttpCall, type Trace, type LLMStep } from "../types/trace.js";
import type { Runtime } from "../types/config.js";
import { createLiveRegion } from "./live-region.js";
import { renderLiveFrame, renderBootFrame, type InflightCall, type LiveState } from "../renderers/live-tree.js";
import { glyph } from "./theme.js";
import { formatCost } from "../core/cost-calculator.js";

const FRAME_MS = 80;
const PLAIN_POLL_MS = 150;

export interface RunContext {
  script: string;
  runtime: Runtime;
  command: string;
  startedAt: string; // ISO
  showCost: boolean;
  filter?: string;
  /** Latency threshold for `latency_spike` warnings, in ms. */
  thresholdMs?: number;
  /** Mid-run guard: terminate the child once spend passes this many USD. */
  budgetUsd?: number;
  /** Redact PII from captured content (default true). */
  redactPii?: boolean;
}

/** What a run produced, plus whether we cut it short. */
export interface RunResult {
  trace: Trace;
  exitCode: number;
  /** Set when `--budget` tripped and we terminated the child. */
  budgetExceeded: boolean;
}

/** Fold accumulated completed calls into live totals + steps. */
function deriveState(
  completedCalls: RawHttpCall[],
  inflight: InflightCall[],
  ctx: RunContext,
  startedAtMs: number,
): LiveState {
  const trace = buildTrace(completedCalls, ctx.script, ctx.runtime, ctx.command, ctx.startedAt, {
    // The live frame shows counts and totals only — parsing, redacting and
    // truncating every message body 12×/second is pure waste. The authoritative
    // trace built after exit captures content normally.
    captureContent: false,
    latencyThresholdMs: ctx.thresholdMs,
    providerFilter: ctx.filter,
  });
  const steps = trace.steps as LLMStep[];

  let inTok = 0;
  let outTok = 0;
  let cost = 0;
  let hasKnown = false;
  let hasUnknown = false;
  for (const s of steps) {
    inTok += s.inputTokens ?? 0;
    outTok += s.outputTokens ?? 0;
    if (s.costUsd !== null) {
      cost += s.costUsd;
      hasKnown = true;
    } else {
      hasUnknown = true;
    }
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
    costKnown: hasKnown,
    hasUnknownCost: hasUnknown,
    showCost: ctx.showCost,
  };
}

/**
 * Terminate the traced child because `--budget` was exceeded.
 *
 * SIGTERM first so the program can flush and run its own cleanup; SIGKILL after
 * a grace period for anything that ignores it. A budget guard that leaves a
 * runaway agent burning money would defeat its own purpose.
 */
function terminateForBudget(handle: SpawnHandle): void {
  try {
    handle.child.kill("SIGTERM");
  } catch {
    /* already gone */
  }
  const kill = setTimeout(() => {
    try {
      if (handle.child.exitCode === null) handle.child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }, 5_000);
  // Don't hold the event loop open just to deliver a follow-up signal.
  kill.unref?.();
}

/** Total known cost across completed calls, for the budget guard. */
function knownCost(calls: RawHttpCall[], ctx: RunContext): number {
  const trace = buildTrace(calls, ctx.script, ctx.runtime, ctx.command, ctx.startedAt, {
    captureContent: false,
  });
  let total = 0;
  for (const step of trace.steps) {
    if (step.type === "llm" && step.costUsd !== null) total += step.costUsd;
  }
  return total;
}

/**
 * Run with the full live TUI (TTY only). Returns the final trace + exit code.
 * The pinned region is cleared before returning, so the caller prints the final
 * static tree exactly once.
 */
export async function runLive(handle: SpawnHandle, ctx: RunContext): Promise<RunResult> {
  const region = createLiveRegion();
  const tail = createNdjsonTail(handle.outputFile);
  const startedAtMs = Date.now();

  const inflight = new Map<number, InflightCall>();
  const completedCalls: RawHttpCall[] = [];
  let tick = 0;
  let budgetExceeded = false;

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
    if (!budgetExceeded && ctx.budgetUsd !== undefined && knownCost(completedCalls, ctx) > ctx.budgetUsd) {
      budgetExceeded = true;
      terminateForBudget(handle);
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

  let exitCode: number;
  try {
    exitCode = await handle.done;
  } finally {
    clearInterval(timer);
    region.stop();
  }

  try {
    drain(); // final drain to catch the last records
  } catch {
    /* the authoritative read below covers us */
  }

  return { ...finalize(handle, ctx), exitCode, budgetExceeded };
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
): Promise<RunResult> {
  const tail = createNdjsonTail(handle.outputFile);
  const completedCalls: RawHttpCall[] = [];
  let budgetExceeded = false;

  if (opts.childToStderr) {
    handle.child.stdout?.on("data", (chunk) => process.stderr.write(chunk));
    handle.child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  }

  const drain = () => {
    for (const rec of tail.poll()) {
      if (isStartRecord(rec)) continue;
      completedCalls.push(rec);
      if (opts.progressive) {
        const t = buildTrace([rec], ctx.script, ctx.runtime, ctx.command, ctx.startedAt, {
          captureContent: false,
        });
        const s = t.steps[0] as LLMStep | undefined;
        if (s) {
          const tok = s.inputTokens !== null ? `${s.inputTokens}→${s.outputTokens} tok` : "tokens ?";
          const cost = ctx.showCost ? `  ${formatCost(s.costUsd)}` : "";
          process.stdout.write(`  ${glyph.ok} ${s.model}  ${tok}${cost}\n`);
        }
      }
    }
    if (!budgetExceeded && ctx.budgetUsd !== undefined && knownCost(completedCalls, ctx) > ctx.budgetUsd) {
      budgetExceeded = true;
      terminateForBudget(handle);
    }
  };

  // The budget guard needs to observe calls as they land, so poll whenever a
  // budget is set even if we are not printing progressive lines.
  const needsPolling = opts.progressive || ctx.budgetUsd !== undefined;
  const timer = needsPolling ? setInterval(drain, PLAIN_POLL_MS) : null;

  let exitCode: number;
  try {
    exitCode = await handle.done;
  } finally {
    if (timer) clearInterval(timer);
  }

  try {
    drain();
  } catch {
    /* the authoritative read below covers us */
  }

  return { ...finalize(handle, ctx), exitCode, budgetExceeded };
}

/**
 * Build the authoritative trace from the on-disk record and release the
 * capture directory. Always re-reads the file rather than trusting the
 * incremental buffer, so a dropped poll cannot lose a call.
 */
function finalize(handle: SpawnHandle, ctx: RunContext): { trace: Trace } {
  let calls: RawHttpCall[] = [];
  try {
    calls = readCapturedCalls(handle.outputFile);
  } catch {
    // Unreadable capture file: report an empty trace rather than crashing after
    // the user's program already ran successfully.
  } finally {
    handle.dispose();
  }

  const trace = buildTrace(calls, ctx.script, ctx.runtime, ctx.command, ctx.startedAt, {
    latencyThresholdMs: ctx.thresholdMs,
    providerFilter: ctx.filter,
    redactPii: ctx.redactPii,
  });
  return { trace };
}
