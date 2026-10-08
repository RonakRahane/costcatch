// Runs a traced program and shows its LLM calls as they happen.
// runLive repaints a box in place, and runPlain prints one line per call.

import { createNdjsonTail } from "../core/ndjson-tail.js";
import { readCapturedRecords, type SpawnHandle } from "../core/tracer.js";
import { closeExitedCall, closeUnfinishedCalls } from "../core/unfinished-calls.js";
import {
  buildTrace,
  createToolResultLinker,
  isCaptureLimitRecord,
  matchesProvider,
  type FailedToolCall,
} from "../core/trace-builder.js";
import { isStartRecord, type RawHttpCall, type Trace, type LLMStep, type StartRecord } from "../types/trace.js";
import type { Runtime } from "../types/config.js";
import { createLiveRegion } from "./live-region.js";
import {
  renderLiveFrame,
  renderFlushedSteps,
  renderLateFailures,
  stepsToFlush,
  frameRows,
  liveBoxCapacity,
  type InflightCall,
  type LiveState,
} from "../renderers/live-tree.js";
import { dim, glyph, terminalSize, visibleLength, reservedColumnCount, truncate, REVEAL_TICKS } from "./theme.js";
import { findTerminalSharers, describeCommand, type Sharer } from "./terminal-sharers.js";
import { formatCost, roundUsd } from "../core/cost-calculator.js";
import { callMark, formatArgs, isFailedCall, oneLine } from "../renderers/tree.js";
import { isRejectedCall, isUnpricedCall } from "../core/step-checks.js";
import { redactString } from "../core/redact.js";

const FRAME_MS = 80;
const PLAIN_POLL_MS = 150;

const SETTLE_MS = 300;
const RECENT_LINES = 500;
const SHARER_CHECK_MS = 5_000;
const ANCHORED_FRAME_MS = 1_000;
const ORPHAN_CHECK_MS = 1_000;

const READY_LINE = /\b(?:ready|listening|started|startup complete|running (?:on|at)|compiled successfully|serving)\b/i;
const SETTLE_AFTER_READY_MS = 400;
const QUIET_MS = 1_500;
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

// The box first appears once startup output goes quiet, or at the first LLM call.
export function createRevealGate(startedAtMs: number) {
  let lastOutputAt = startedAtMs;
  let readyAt: number | null = null;
  let revealed = false;

  return {
    output(chunk: string | Buffer, nowMs: number): void {
      lastOutputAt = nowMs;
      if (readyAt !== null) return;
      const text = (typeof chunk === "string" ? chunk : chunk.toString("utf8")).replace(ANSI, "");
      if (READY_LINE.test(text)) readyAt = nowMs;
    },
    activity(): void {
      revealed = true;
    },
    ready(nowMs: number): boolean {
      if (revealed) return true;
      if (readyAt !== null && nowMs - lastOutputAt >= SETTLE_AFTER_READY_MS) revealed = true;
      else if (nowMs - lastOutputAt >= QUIET_MS) revealed = true;
      return revealed;
    },
  };
}

export interface RunContext {
  script: string;
  runtime: Runtime;
  command: string;
  startedAt: string; // ISO timestamp
  showCost: boolean;
  filter?: string;
  thresholdMs?: number;
  budgetUsd?: number;
  // Defaults to true.
  redactPii?: boolean;
}

export interface RunResult {
  trace: Trace;
  exitCode: number;
  budgetExceeded: boolean;
  // --budget stopped the run because a call's cost couldn't be counted, not because spend passed it.
  budgetUnpriced?: boolean;
  // --budget found the program still running and stopped it. False when it had already exited.
  budgetStopped?: boolean;
  // The tracer has already printed why the program didn't start.
  failedToStart: boolean;
  // The capture hit COSTCATCH_MAX_TRACE_BYTES, so later calls are missing from the trace.
  captureLimited: boolean;
}

// Applies --filter so that --budget only counts calls the printed trace will show.
function createLiveAccumulator(ctx: RunContext) {
  const steps: LLMStep[] = [];
  // true redacts PII, the same default buildTrace uses.
  const toolResults = createToolResultLinker(true);
  const late: FailedToolCall[] = [];
  const positionOf = new Map<LLMStep, number>();
  const calls = new Map<number, { startMs: number; done: number | null }>();
  const unkeyed: { startMs: number; done: number | null }[] = [];
  let completions = 0;
  let consumed = 0;
  let inTok = 0;
  let outTok = 0;
  let cost = 0;
  let hasKnown = false;
  let hasUnknown = false;
  // If every call was rejected, the total is $0 rather than unknown.
  let allRejected = true;
  let flushed = 0;

  // Numbers calls by start time the way the final trace does, counting calls still in flight.
  function stepNumber(call: RawHttpCall): number {
    const key = typeof call.id === "number" ? call.id : null;
    let entry = key === null ? undefined : calls.get(key);
    if (!entry) {
      entry = { startMs: call.startMs, done: null };
      if (key === null) unkeyed.push(entry);
      else calls.set(key, entry);
    }
    entry.done = ++completions;
    let n = 1;
    for (const other of [...calls.values(), ...unkeyed]) {
      if (other === entry) continue;
      if (other.startMs < entry.startMs || (other.startMs === entry.startMs && other.done !== null && other.done < entry.done)) n++;
    }
    return n;
  }

  function ingest(completed: RawHttpCall[]): { added: LLMStep[]; failedTools: FailedToolCall[] } {
    const added: LLMStep[] = [];
    const failedTools: FailedToolCall[] = [];
    for (; consumed < completed.length; consumed++) {
      const call = completed[consumed];
      if (isCaptureLimitRecord(call)) continue;
      if (ctx.filter && !matchesProvider(call, ctx.filter)) continue;
      let built;
      try {
        built = buildTrace([call], ctx.script, ctx.runtime, ctx.command, ctx.startedAt, {
          captureContent: false,
          latencyThresholdMs: ctx.thresholdMs,
        });
      } catch {
        continue;
      }
      const step = built.steps[0] as LLMStep | undefined;
      if (!step || step.type !== "llm") continue;
      // buildTrace starts at 1 for every call, so renumber to match the final trace.
      step.id = stepNumber(call);
      positionOf.set(step, steps.length);
      steps.push(step);
      added.push(step);
      let failed: FailedToolCall[] = [];
      try {
        failed = toolResults.link(step, call.requestBody);
      } catch {}
      failedTools.push(...failed);
      for (const f of failed) if ((positionOf.get(f.step) ?? Infinity) < flushed) late.push(f);
      inTok += step.inputTokens ?? 0;
      outTok += step.outputTokens ?? 0;
      if (step.costUsd !== null) {
        // Round the same way the final total does, so spending exactly the budget isn't over it.
        cost = roundUsd(cost + step.costUsd);
        hasKnown = true;
      } else if (isUnpricedCall(step)) {
        // Rejected calls (like a 429) cost nothing, so they don't make the total unknown.
        hasUnknown = true;
      }
      if (!isRejectedCall(step)) allRejected = false;
    }
    return { added, failedTools };
  }

  return {
    ingest,
    started(rec: StartRecord): void {
      if (ctx.filter && !matchesProvider({ url: rec.url } as RawHttpCall, ctx.filter)) return;
      if (!calls.has(rec.id)) calls.set(rec.id, { startMs: rec.startMs, done: null });
    },
    cost(calls: RawHttpCall[]): number {
      ingest(calls);
      return cost;
    },
    // A call that may have been billed but has no price, so --budget can't count it.
    hasUnpriced(): boolean {
      return hasUnknown;
    },
    state(calls: RawHttpCall[], inflight: InflightCall[], startedAtMs: number): LiveState {
      ingest(calls);
      return {
        script: ctx.script,
        runtime: ctx.runtime,
        completed: steps,
        inflight,
        startedAtMs,
        totalInputTokens: inTok,
        totalOutputTokens: outTok,
        totalCostUsd: cost,
        costKnown: hasKnown || (steps.length > 0 && allRejected),
        hasUnknownCost: hasUnknown,
        showCost: ctx.showCost,
        flushed,
      };
    },
    flush(n: number): void {
      flushed += n;
    },
    takeLate(): FailedToolCall[] {
      return late.splice(0);
    },
  };
}

// Returns false when the program had already exited, so there was nothing to stop.
function terminateForBudget(handle: SpawnHandle): boolean {
  if (handle.child.exitCode !== null || (handle.child.signalCode ?? null) !== null) return false;
  try {
    handle.child.kill("SIGTERM");
  } catch {}
  const kill = setTimeout(() => {
    try {
      if (handle.child.exitCode === null) handle.child.kill("SIGKILL");
    } catch {}
  }, 5_000);
  kill.unref?.();
  return true;
}

export interface LiveOptions {
  gutter?: number;
  anchored?: boolean;
  findSharers?: () => Promise<Sharer[]>;
  processAlive?: (pid: number) => boolean;
}

// Signal 0 only checks that the process exists. EPERM means it exists but belongs to another user.
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

// Clears the box before it returns, so the caller can print the final tree.
export async function runLive(handle: SpawnHandle, ctx: RunContext, opts: LiveOptions = {}): Promise<RunResult> {
  const anchored = opts.anchored === true;
  const findSharers = opts.findSharers ?? (() => findTerminalSharers());
  const alive = opts.processAlive ?? processAlive;
  const region = createLiveRegion(process.stdout, {
    gutter: opts.gutter,
    columns: () => terminalSize().columns,
    rows: () => terminalSize().rows,
    anchored,
  });
  const tail = createNdjsonTail(handle.outputFile);
  const startedAtMs = Date.now();
  const reveal = createRevealGate(startedAtMs);

  const inflight = new Map<number, InflightCall>();
  const starts = new Map<number, StartRecord>();
  const exited = new Map<number, number>();
  const goneSince = new Map<number, number>();
  let orphansCheckedAt = -Infinity;
  const completedCalls: RawHttpCall[] = [];
  const live = createLiveAccumulator(ctx);
  // turbo's pane repaints only once a second, too slow for the header animation, so skip it there.
  let tick = anchored ? REVEAL_TICKS : 0;
  let budgetExceeded = false;
  let budgetUnpriced = false;
  let budgetStopped = false;
  let shown = false;
  let finished = false;
  let size = terminalSize();
  let resizedAt: number | null = null;
  // Set when another process writes to this terminal, since the box would draw over its output.
  let degraded = false;
  let sharersCheckedAt = -Infinity;
  let checkingSharers = false;
  let lastPaintAt = -Infinity;
  let lastPaintKey = "";
  const held: { chunk: string | Buffer; target: NodeJS.WriteStream }[] = [];
  const recent: string[] = [];
  let partial = "";

  function remember(text: string): void {
    const pieces = (partial + text).split("\n");
    partial = pieces.pop() ?? "";
    for (const line of pieces) recent.push(`${line}\n`);
    if (recent.length > RECENT_LINES) recent.splice(0, recent.length - RECENT_LINES);
  }

  function passthrough(chunk: string | Buffer, target: NodeJS.WriteStream): void {
    remember(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    region.writePassthrough(chunk, target);
  }

  function recentThatFits(rows: number): string {
    const { columns, rows: height } = terminalSize();
    const gutter = reservedColumnCount();
    let budget = height - rows - 3; // park line, spare line and the blank top row
    const lines: string[] = [];
    const takes = (line: string) => Math.max(1, Math.ceil((gutter + visibleLength(line.replace(/\n$/, ""))) / Math.max(1, columns)));
    if (partial) {
      budget -= takes(partial);
      lines.unshift(partial);
    }
    for (let i = recent.length - 1; i >= 0 && budget > 0; i--) {
      const cost = takes(recent[i]);
      if (cost > budget) break;
      budget -= cost;
      lines.unshift(recent[i]);
    }
    return lines.join("");
  }

  // Called before every write, not just once a frame, so we never write at an old size.
  function checkSize(now: number): void {
    const current = terminalSize();
    if (current.columns !== size.columns || current.rows !== size.rows) {
      size = current;
      resizedAt = now;
    }
  }

  function forward(chunk: string | Buffer, target: NodeJS.WriteStream): void {
    const now = Date.now();
    reveal.output(chunk, now);
    if (degraded) {
      target.write(chunk);
      return;
    }
    // turbo replays all output itself after a resize, so there's nothing to hold back.
    if (!anchored) checkSize(now);
    if (resizedAt !== null) {
      remember(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      held.push({ chunk, target });
    } else {
      passthrough(chunk, target);
    }
  }
  handle.child.stdout?.on("data", (chunk) => forward(chunk, process.stdout));
  handle.child.stderr?.on("data", (chunk) => forward(chunk, process.stderr));

  function drain(): void {
    for (const rec of tail.poll()) {
      reveal.activity();
      if (isStartRecord(rec)) {
        inflight.set(rec.id, {
          id: rec.id,
          model: rec.model,
          provider: rec.provider ?? "unknown",
          startMs: rec.startMs,
        });
        starts.set(rec.id, rec);
        live.started(rec);
      } else {
        if (typeof rec.id === "number") {
          inflight.delete(rec.id);
          starts.delete(rec.id);
        }
        completedCalls.push(rec);
      }
    }
    closeOrphans(Date.now());
    if (!budgetExceeded && ctx.budgetUsd !== undefined) {
      const over = live.cost(completedCalls) > ctx.budgetUsd;
      if (over || live.hasUnpriced()) {
        budgetExceeded = true;
        budgetUnpriced = !over;
        budgetStopped = terminateForBudget(handle);
      }
    }
  }

  // Closes calls whose process has died, the same way the final trace does. The process must be
  // gone on two checks in a row, so we know everything it wrote has been read.
  function closeOrphans(now: number): void {
    if (now - orphansCheckedAt < ORPHAN_CHECK_MS) return;
    orphansCheckedAt = now;
    const gone = new Map<number, boolean>();
    for (const [id, start] of starts) {
      if (start.pid === undefined) continue;
      let isGone = gone.get(start.pid);
      if (isGone === undefined) gone.set(start.pid, (isGone = !alive(start.pid)));
      if (!isGone) continue;
      const since = goneSince.get(start.pid);
      if (since === undefined) continue;
      starts.delete(id);
      inflight.delete(id);
      exited.set(id, since);
      completedCalls.push(closeExitedCall(start, since));
    }
    for (const [pid, isGone] of gone) {
      if (!isGone) goneSince.delete(pid);
      else if (!goneSince.has(pid)) goneSince.set(pid, now);
    }
    for (const pid of goneSince.keys()) if (!gone.has(pid)) goneSince.delete(pid);
  }

  function watchSharers(now: number): void {
    if (degraded || checkingSharers || now - sharersCheckedAt < SHARER_CHECK_MS) return;
    checkingSharers = true;
    sharersCheckedAt = now;
    findSharers().then(
      (found) => {
        checkingSharers = false;
        if (found.length > 0 && !finished && !degraded) degrade(found);
      },
      () => {
        checkingSharers = false;
      },
    );
  }

  function degrade(found: Sharer[]): void {
    degraded = true;
    resizedAt = null;
    region.stop();
    for (const { chunk, target } of held.splice(0)) target.write(chunk);
    process.stderr.write(sharerNotice(found));
    const state = live.state(completedCalls, [...inflight.values()], startedAtMs);
    for (const step of state.completed.slice(state.flushed)) {
      process.stderr.write(progressLine(step, ctx.showCost));
      for (const call of step.toolCalls) if (call.error) process.stderr.write(toolFailureLine({ step, call }));
    }
    for (const f of live.takeLate()) process.stderr.write(toolFailureLine(f));
  }

  function printProgress(): void {
    const { added, failedTools } = live.ingest(completedCalls);
    for (const s of added) process.stderr.write(progressLine(s, ctx.showCost));
    for (const f of failedTools) process.stderr.write(toolFailureLine(f));
    live.takeLate(); // drop these, they were just printed above
  }

  // turbo replays everything a task wrote on each resize, so in its pane we repaint at most once a second.
  function paintDue(now: number): boolean {
    const { columns, rows } = terminalSize();
    const key = `${completedCalls.length}/${inflight.size}/${columns}x${rows}`;
    if (key === lastPaintKey && now - lastPaintAt < ANCHORED_FRAME_MS) return false;
    lastPaintKey = key;
    lastPaintAt = now;
    return true;
  }

  function paint(): void {
    // A render error shouldn't crash the traced run or leave the cursor hidden.
    try {
      drain();
      const now = Date.now();
      watchSharers(now);
      if (degraded) {
        printProgress();
        return;
      }
      // Keep draining before the box shows so the budget check still runs, and leave tick at 0 for the header animation.
      if (!reveal.ready(now)) return;
      // Checked here as well as on "resize", because a runner's pseudo terminal never sends that event.
      if (!anchored) checkSize(now);
      else if (!paintDue(now)) return;
      let state = live.state(completedCalls, [...inflight.values()], startedAtMs);
      let frame = renderLiveFrame(state, tick, now);
      if (resizedAt !== null) {
        if (now - resizedAt < SETTLE_MS) return;
        resizedAt = null;
        if (shown) {
          // Write held output first, so anything the repaint can't fit still ends up in scrollback.
          for (const { chunk, target } of held.splice(0)) target.write(chunk);
          region.restart(recentThatFits(frameRows(frame)));
        } else {
          for (const { chunk, target } of held.splice(0)) region.writePassthrough(chunk, target);
        }
      }
      shown = true;
      const flush = stepsToFlush(state, frameRows(frame), liveBoxCapacity());
      if (flush > 0) {
        const steps = state.completed.slice(state.flushed, state.flushed + flush);
        passthrough(renderFlushedSteps(steps, state.showCost), process.stdout);
        live.flush(flush);
        state = live.state(completedCalls, [...inflight.values()], startedAtMs);
        frame = renderLiveFrame(state, tick, now);
      }
      const late = live.takeLate();
      if (late.length > 0) passthrough(renderLateFailures(late), process.stdout);
      region.update(frame);
    } catch {}
    tick++;
  }

  watchSharers(Date.now());
  const timer = setInterval(paint, FRAME_MS);

  const onResize = (): void => paint();
  process.stdout.on("resize", onResize);

  let exitCode: number;
  try {
    exitCode = await handle.done;
  } finally {
    finished = true;
    clearInterval(timer);
    process.stdout.removeListener("resize", onResize);
    region.stop();
    for (const { chunk, target } of held.splice(0)) target.write(chunk);
  }

  try {
    drain();
    if (degraded) printProgress();
  } catch {
    // finalize reads everything again
  }

  return { ...finalize(handle, ctx, exitCode, budgetExceeded, exited), exitCode, budgetExceeded, budgetUnpriced, budgetStopped, failedToStart: handle.failedToStart() };
}

// childToStderr keeps stdout clean for JSON. It needs a handle spawned with pipeChildOutput.
export async function runPlain(
  handle: SpawnHandle,
  ctx: RunContext,
  opts: { progressive: boolean; childToStderr?: boolean },
): Promise<RunResult> {
  const tail = createNdjsonTail(handle.outputFile);
  const completedCalls: RawHttpCall[] = [];
  const live = createLiveAccumulator(ctx);
  let budgetExceeded = false;
  let budgetUnpriced = false;
  let budgetStopped = false;

  if (opts.childToStderr) {
    handle.child.stdout?.on("data", (chunk) => process.stderr.write(chunk));
    handle.child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  }

  const drain = () => {
    for (const rec of tail.poll()) {
      if (isStartRecord(rec)) {
        live.started(rec);
        continue;
      }
      completedCalls.push(rec);
    }
    if (opts.progressive) {
      const { added, failedTools } = live.ingest(completedCalls);
      // Progress goes to stderr, so redirecting stdout to a file captures only the final tree.
      for (const s of added) process.stderr.write(progressLine(s, ctx.showCost));
      for (const f of failedTools) process.stderr.write(toolFailureLine(f));
    }
    if (!budgetExceeded && ctx.budgetUsd !== undefined) {
      const over = live.cost(completedCalls) > ctx.budgetUsd;
      if (over || live.hasUnpriced()) {
        budgetExceeded = true;
        budgetUnpriced = !over;
        budgetStopped = terminateForBudget(handle);
      }
    }
  };

  const needsPolling = opts.progressive || ctx.budgetUsd !== undefined;
  const timer = needsPolling
    ? setInterval(() => {
        try {
          drain();
        } catch {
          // finalize reads everything again
        }
      }, PLAIN_POLL_MS)
    : null;

  let exitCode: number;
  try {
    exitCode = await handle.done;
  } finally {
    if (timer) clearInterval(timer);
  }

  try {
    drain();
  } catch {
    // finalize reads everything again
  }

  return { ...finalize(handle, ctx, exitCode, budgetExceeded), exitCode, budgetExceeded, budgetUnpriced, budgetStopped, failedToStart: handle.failedToStart() };
}

function progressLine(s: LLMStep, showCost: boolean): string {
  if (isFailedCall(s)) {
    const kind = s.error?.type ? ` ${oneLine(s.error.type)}` : "";
    const why = s.error?.message ? `: ${truncate(oneLine(s.error.message), PROGRESS_MESSAGE_MAX)}` : "";
    return `  ${glyph.err} ${s.model}  HTTP ${s.statusCode ?? "?"}${kind}${why}\n`;
  }
  const tok = s.inputTokens !== null ? `${s.inputTokens} tok in→${s.outputTokens ?? "?"} tok out` : "tokens ?";
  const cost = showCost ? `  ${formatCost(s.costUsd)}` : "";
  return `  ${callMark(s).mark} ${s.model}  ${tok}${cost}\n`;
}

// A tool failure only shows up in the next call's request, so name the step that called the tool.
function toolFailureLine({ step, call }: FailedToolCall): string {
  const why = call.error?.message ? `: ${truncate(oneLine(call.error.message), PROGRESS_MESSAGE_MAX)}` : "";
  return `  ${glyph.err} step ${step.id} tool ${oneLine(call.name)}(${formatArgs(call.input)}) failed${why}\n`;
}

const PROGRESS_MESSAGE_MAX = 160;

export function sharerNotice(found: Sharer[]): string {
  const one = found.length === 1;
  const named = found.slice(0, 2).map((s) => `pid ${s.pid} (${describeCommand(redactString(s.command))})`);
  const more = found.length > 2 ? ` and ${found.length - 2} more` : "";
  return (
    dim(
      `  ${glyph.warn} live view off: ${named.join(", ")}${more} ${one ? "writes" : "write"} to this terminal too,` +
        ` and the box would draw over ${one ? "its" : "their"} lines. Showing one line per LLM call instead;` +
        ` give ${one ? "it a terminal or turbo task of its own" : "them terminals or turbo tasks of their own"} to keep the box.`,
    ) + "\n"
  );
}

// Reads the capture file again from the start, so a missed poll can't lose a call.
function finalize(
  handle: SpawnHandle,
  ctx: RunContext,
  exitCode: number,
  stoppedByBudget: boolean,
  exited?: ReadonlyMap<number, number>,
): { trace: Trace; captureLimited: boolean } {
  let calls: RawHttpCall[] = [];
  try {
    calls = closeUnfinishedCalls(readCapturedRecords(handle.outputFile), Date.now(), exited);
  } catch {
    // build an empty trace
  } finally {
    handle.dispose();
  }

  const trace = buildTrace(calls, ctx.script, ctx.runtime, ctx.command, ctx.startedAt, {
    latencyThresholdMs: ctx.thresholdMs,
    providerFilter: ctx.filter,
    redactPii: ctx.redactPii,
    exitCode,
    stoppedByBudget,
  });
  // buildTrace drops the capture-limit marker because it isn't a call, so check the raw records.
  return { trace, captureLimited: calls.some(isCaptureLimitRecord) };
}
