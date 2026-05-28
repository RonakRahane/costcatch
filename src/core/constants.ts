// Values shared with the injected interceptors, which repeat them as literals.
// constants.test.ts checks that both sides still match.

// Absolute path of the NDJSON file the interceptor appends to.
export const ENV_OUTPUT = "COSTCATCH_OUTPUT";

export const ENV_ACTIVE = "COSTCATCH_ACTIVE";

export const ENV_MAX_BODY_BYTES = "COSTCATCH_MAX_BODY_BYTES";
export const ENV_MAX_TRACE_BYTES = "COSTCATCH_MAX_TRACE_BYTES";

export const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;

export const DEFAULT_MAX_TRACE_BYTES = 64 * 1024 * 1024;

export const TRACES_DIR = ".costcatch";
