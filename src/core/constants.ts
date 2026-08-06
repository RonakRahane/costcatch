/**
 * Cross-process contract between the CLI and the injected interceptors.
 *
 * The interceptors are NOT TypeScript — `node/preload.cjs` and
 * `python/sitecustomize.py` are runtime assets copied verbatim into `dist/`.
 * They cannot import from here, so every name below is duplicated as a string
 * literal on their side. `tests/unit/core/constants.test.ts` reads both
 * interceptor sources and asserts the literals still match these values, so a
 * rename can never silently break capture again.
 *
 * (It did once: the CLI exported `COSTCATCH_OUTPUT` while both interceptors
 * read `AGENT_TRACE_OUTPUT`, so every traced run captured exactly zero calls.)
 */

/** Absolute path of the NDJSON file the interceptor appends captured calls to. */
export const ENV_OUTPUT = "COSTCATCH_OUTPUT";

/** Set to "1" by the interceptor's own child guard; blocks recursive tracing. */
export const ENV_ACTIVE = "COSTCATCH_ACTIVE";

/** Max bytes an interceptor will buffer for a single response body. */
export const ENV_MAX_BODY_BYTES = "COSTCATCH_MAX_BODY_BYTES";

/** Max total bytes an interceptor will append to the NDJSON file. */
export const ENV_MAX_TRACE_BYTES = "COSTCATCH_MAX_TRACE_BYTES";

/** Injected at build time by tsup; falls back to package.json in dev. */
export const ENV_VERSION = "COSTCATCH_VERSION";

/**
 * Default per-response capture ceiling (2 MiB).
 *
 * A single LLM response is measured in kilobytes; anything past this is either a
 * pathological payload or a non-LLM endpoint that matched our URL heuristic.
 * Buffering it would grow the traced process's heap without bound, so we stop
 * accumulating and mark the record truncated instead.
 */
export const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * Default whole-trace capture ceiling (64 MiB).
 *
 * Bounds worst-case disk use for a long-running agent, and bounds how much the
 * CLI will read back into memory when it builds the final trace.
 */
export const DEFAULT_MAX_TRACE_BYTES = 64 * 1024 * 1024;

/** Directory (relative to the project root) where saved traces live. */
export const TRACES_DIR = ".costcatch";
