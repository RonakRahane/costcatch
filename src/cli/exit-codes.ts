/**
 * Exit-code contract.
 *
 * `costcatch` is designed to sit in front of other programs and inside CI
 * pipelines, so its exit status has to be predictable and documented — a script
 * wrapping it must be able to tell "your agent failed" apart from "the cost gate
 * tripped" apart from "costcatch itself broke".
 *
 * When costcatch has nothing of its own to report, the traced program's exit
 * status is passed through verbatim, including 128+N for signal deaths.
 */
export const ExitCode = {
  /** Everything succeeded, and the traced program exited 0. */
  Success: 0,
  /** A `--max-cost` / `--max-calls` / `--budget` assertion failed. */
  GateFailed: 1,
  /** Bad invocation: unknown runtime, missing arguments, unreadable input. */
  Usage: 2,
  /** costcatch itself failed (missing interceptor, unwritable temp dir, bug). */
  Internal: 70,
  /** The traced program could not be started (not found / not executable). */
  CommandNotFound: 127,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];
