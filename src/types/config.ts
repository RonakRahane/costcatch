// Parsed flags for costcatch run and costcatch stats.
export interface RunFlags {
  save: boolean;
  saveAs?: string;
  cost: boolean;
  json: boolean;
  noColor: boolean;
  // Provider name. Calls to other providers are dropped.
  filter?: string;
  // In milliseconds. Slower calls get a latency warning.
  threshold?: number;
  quiet: boolean;
  // Only controls PII, and is on by default. Secrets and terminal escapes are always scrubbed.
  redact?: boolean;
  inspect: boolean;
  compareLast: boolean;
  // In USD, checked once the run ends.
  maxCost?: number;
  maxCalls?: number;
  // Counts failed LLM calls plus failed tool calls.
  maxErrors?: number;
  // In USD. Checked during the run, with SIGTERM once spend passes it and SIGKILL if ignored.
  budget?: number;
}

export interface StatsFlags {
  today: boolean;
  week: boolean;
  script?: string;
  model?: string;
}

export type Runtime = "python" | "node";
