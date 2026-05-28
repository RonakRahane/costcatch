// Exit codes are a public contract for CI scripts. With nothing of its own to report, costcatch
// exits with the traced program's status, including 128+N after a signal.
export const ExitCode = {
  Success: 0,
  GateFailed: 1,
  Usage: 2,
  Internal: 70,
  CommandNotFound: 127,
} as const;
