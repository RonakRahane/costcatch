/**
 * Guards the cross-process contract between the CLI and its interceptors.
 *
 * The interceptors are runtime assets (.cjs / .py) that cannot import the
 * TypeScript constants, so every env var name is duplicated as a string literal
 * on their side. That duplication once drifted: the CLI exported
 * `COSTCATCH_OUTPUT` while both interceptors read `AGENT_TRACE_OUTPUT`, so every
 * traced run captured exactly zero calls and nothing in the build or the unit
 * suite noticed. These tests are the thing that would have noticed.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ENV_OUTPUT,
  ENV_ACTIVE,
  ENV_MAX_BODY_BYTES,
  ENV_MAX_TRACE_BYTES,
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_MAX_TRACE_BYTES,
} from "../../../src/core/constants.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const nodeInterceptor = fs.readFileSync(
  path.join(repoRoot, "src/interceptors/node/preload.cjs"),
  "utf-8",
);
const pythonInterceptor = fs.readFileSync(
  path.join(repoRoot, "src/interceptors/python/sitecustomize.py"),
  "utf-8",
);

describe("interceptor env-var contract", () => {
  const names = [ENV_OUTPUT, ENV_ACTIVE, ENV_MAX_BODY_BYTES, ENV_MAX_TRACE_BYTES];

  it.each(names)("Node interceptor declares %s", (name) => {
    expect(nodeInterceptor).toContain(`"${name}"`);
  });

  it.each(names)("Python interceptor declares %s", (name) => {
    expect(pythonInterceptor).toContain(`"${name}"`);
  });

  it("neither interceptor still reads the old AGENT_TRACE_* names", () => {
    expect(nodeInterceptor).not.toContain("AGENT_TRACE_OUTPUT");
    expect(pythonInterceptor).not.toContain("AGENT_TRACE_OUTPUT");
  });

  it("the Node interceptor reads the output path from the shared name", () => {
    expect(nodeInterceptor).toContain(`process.env[ENV_OUTPUT]`);
    expect(nodeInterceptor).toContain(`const ENV_OUTPUT = "${ENV_OUTPUT}"`);
  });

  it("the Python interceptor reads the output path from the shared name", () => {
    expect(pythonInterceptor).toContain(`ENV_OUTPUT = "${ENV_OUTPUT}"`);
    expect(pythonInterceptor).toContain("os.environ.get(ENV_OUTPUT)");
  });

  it("both interceptors use the same capture ceilings as the CLI", () => {
    expect(nodeInterceptor).toContain(`const DEFAULT_MAX_BODY_BYTES = ${DEFAULT_MAX_BODY_BYTES / (1024 * 1024)} * 1024 * 1024`);
    expect(pythonInterceptor).toContain(`DEFAULT_MAX_BODY_BYTES = ${DEFAULT_MAX_BODY_BYTES / (1024 * 1024)} * 1024 * 1024`);
    expect(nodeInterceptor).toContain(`const DEFAULT_MAX_TRACE_BYTES = ${DEFAULT_MAX_TRACE_BYTES / (1024 * 1024)} * 1024 * 1024`);
    expect(pythonInterceptor).toContain(`DEFAULT_MAX_TRACE_BYTES = ${DEFAULT_MAX_TRACE_BYTES / (1024 * 1024)} * 1024 * 1024`);
  });
});

describe("Python interceptor startup safety", () => {
  it("chains the sitecustomize it shadows", () => {
    // Prepending our directory to PYTHONPATH hides any sitecustomize the user's
    // environment already had (conda, Debian, coverage.py). Tracing a script
    // must not silently disable their startup hooks.
    expect(pythonInterceptor).toContain("_chain_original_sitecustomize()");
    expect(pythonInterceptor).toContain("_costcatch_chained_sitecustomize");
  });

  it("guards against double installation", () => {
    expect(pythonInterceptor).toContain("_costcatch_installed");
  });
});

describe("Node interceptor startup safety", () => {
  it("guards against double installation", () => {
    expect(nodeInterceptor).toContain("__costcatchInstalled");
  });

  it("patches get() as well as request()", () => {
    // http.get closes over the module-local `request`, so patching only
    // `mod.request` leaves every `https.get(...)` call invisible.
    expect(nodeInterceptor).toContain("mod.get = function patchedGet");
  });
});
