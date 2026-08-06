/**
 * CLI configuration types.
 *
 * These map directly to the flags and options accepted by each command.
 */

/** Flags for the `costcatch run` command. */
export interface RunFlags {
  /** Save trace to .costcatch/ */
  save: boolean;
  /** Save with a specific name */
  saveAs?: string;
  /** Show cost breakdown per step */
  cost: boolean;
  /** Output raw JSON instead of tree */
  json: boolean;
  /** Disable colored output (for CI) */
  noColor: boolean;
  /** Only show calls to a specific provider */
  filter?: string;
  /** Warn on LLM calls slower than N ms */
  threshold?: number;
  /** Only show summary, not full tree */
  quiet: boolean;
  /**
   * Redact PII (emails, phones, cards) from captured content. Default true.
   * Secrets and terminal escapes are always scrubbed regardless.
   */
  redact?: boolean;
  /** After run, show full conversation content for each step */
  inspect: boolean;
  /** Auto-diff against the most recent saved trace for this script */
  compareLast: boolean;
  /** CI gate: non-zero exit if total cost exceeds N USD */
  maxCost?: number;
  /** CI gate: non-zero exit if LLM call count exceeds N */
  maxCalls?: number;
  /**
   * Mid-run guard: terminate the traced program once known spend exceeds N USD.
   *
   * Enforced by the live controller as calls land (SIGTERM, then SIGKILL after a
   * grace period), so a runaway loop is stopped rather than merely reported
   * after the fact.
   */
  budget?: number;
}

/** Flags for the `costcatch stats` command. */
export interface StatsFlags {
  /** Show stats for today only */
  today: boolean;
  /** Show stats for the last 7 days */
  week: boolean;
  /** Filter by script name */
  script?: string;
  /** Filter by model name */
  model?: string;
}

/** Supported runtime environments. */
export type Runtime = "python" | "node";
