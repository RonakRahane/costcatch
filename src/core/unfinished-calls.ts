// Turns calls that never got a response into ordinary error calls with status 0.

import { isStartRecord, type RawHttpCall, type RawRecord, type StartRecord } from "../types/trace.js";
import { isCaptureLimitRecord, NO_RESPONSE_ERROR, NOT_RECORDED_ERROR } from "./trace-builder.js";

export { NO_RESPONSE_ERROR, NOT_RECORDED_ERROR };


function closeOut(start: StartRecord, endedAtMs: number, why: "run ended" | "capture limit" | "process exited"): RawHttpCall {
  return {
    phase: "end",
    id: start.id,
    url: start.url,
    // Start records don't carry the method, but every intercepted call is a POST.
    method: "POST",
    requestBody: start.model ? { model: start.model } : {},
    responseBody: {
      error:
        why === "capture limit"
          ? {
              type: NOT_RECORDED_ERROR,
              message: "not recorded: the capture limit was reached before this call finished",
            }
          : {
              type: NO_RESPONSE_ERROR,
              message:
                why === "process exited"
                  ? "no response: the process that made this call exited before an answer came back"
                  : "no response: the request was sent and nothing came back before the run ended",
            },
    },
    statusCode: 0,
    startMs: start.startMs,
    // We only know when the call stopped mattering, so this duration is a lower bound.
    endMs: Math.max(start.startMs, endedAtMs),
    isStreaming: false,
  };
}

export function closeExitedCall(start: StartRecord, goneAtMs: number): RawHttpCall {
  return closeOut(start, goneAtMs, "process exited");
}

// exited maps a call id to when the live view saw its process exit.
export function closeUnfinishedCalls(
  records: RawRecord[],
  endedAtMs: number,
  exited: ReadonlyMap<number, number> = new Map(),
): RawHttpCall[] {
  const calls: RawHttpCall[] = [];
  const starts = new Map<number, StartRecord>();
  const finished = new Set<number>();
  let captureLimited = false;

  for (const record of records) {
    if (isStartRecord(record)) {
      starts.set(record.id, record);
      continue;
    }
    if (isCaptureLimitRecord(record)) captureLimited = true;
    calls.push(record);
    // Older interceptors wrote end records without an id, and those calls are already finished.
    if (typeof record.id === "number") finished.add(record.id);
  }

  for (const [id, start] of starts) {
    if (finished.has(id)) continue;
    const goneAt = exited.get(id);
    if (goneAt !== undefined) calls.push(closeExitedCall(start, goneAt));
    else calls.push(closeOut(start, endedAtMs, captureLimited ? "capture limit" : "run ended"));
  }
  return calls;
}
