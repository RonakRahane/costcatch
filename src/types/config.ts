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
  /** Show tokens arriving in real time */
  stream: boolean;
  /** After run, show full conversation content for each step */
  inspect: boolean;
  /** Auto-diff against the most recent saved trace for this script */
  compareLast: boolean;
  /** CI gate: non-zero exit if total cost exceeds N USD */
  maxCost?: number;
  /** CI gate: non-zero exit if LLM call count exceeds N */
  maxCalls?: number;
  /** Mid-run guard: warn/abort if cost exceeds N USD during the run */
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
