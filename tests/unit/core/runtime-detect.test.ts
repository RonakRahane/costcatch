/**
 * Runtime detection and argv splitting.
 *
 * `splitInvocation` is what stops costcatch from stealing flags that belong to
 * the traced program. `run` was declared with `allowUnknownOption` +
 * `allowExcessArguments`, so `costcatch python agent.py --json` used to switch
 * COSTCATCH into JSON mode instead of passing `--json` to the agent.
 */

import { describe, it, expect } from "vitest";
import {
  detectRuntime,
  classifyExecutable,
  isRuntimeExecutable,
  splitInvocation,
} from "../../../src/core/runtime-detect.js";

describe("classifyExecutable", () => {
  it.each([
    ["python", "python"],
    ["python3", "python"],
    ["python3.12", "python"],
    ["python3.13", "python"],
    ["pythonw", "python"],
    ["py", "python"],
    ["/usr/local/bin/python3.11", "python"],
    ["C:\\Python312\\python.exe", "python"],
    ["node", "node"],
    ["nodejs", "node"],
    ["npx", "node"],
    ["tsx", "node"],
    ["ts-node", "node"],
    ["C:\\Program Files\\nodejs\\node.EXE", "node"],
  ])("%s → %s", (input, expected) => {
    expect(classifyExecutable(input)).toBe(expected);
  });

  it.each(["go", "cargo", "ruby", "java", "", "./agent.py"])(
    "%s is not an instrumentable runtime",
    (input) => {
      expect(classifyExecutable(input)).toBeNull();
    },
  );

  it("rejects bun and deno rather than producing an empty trace", () => {
    // Neither honours --require, so injecting the preload would look like it
    // worked while capturing nothing.
    expect(classifyExecutable("bun")).toBeNull();
    expect(classifyExecutable("deno")).toBeNull();
  });
});

describe("detectRuntime", () => {
  it("reads the first argument", () => {
    expect(detectRuntime(["python", "agent.py"])).toBe("python");
    expect(detectRuntime(["node", "agent.js"])).toBe("node");
  });

  it("returns null for an empty command", () => {
    expect(detectRuntime([])).toBeNull();
  });

  it("returns null for an unsupported runtime", () => {
    expect(detectRuntime(["go", "run", "main.go"])).toBeNull();
  });
});

describe("isRuntimeExecutable", () => {
  it("accepts runtimes and rejects flags", () => {
    expect(isRuntimeExecutable("python3")).toBe(true);
    expect(isRuntimeExecutable("--save")).toBe(false);
  });
});

describe("splitInvocation", () => {
  it("splits at the first runtime executable", () => {
    expect(splitInvocation(["--save", "python", "agent.py"])).toEqual({
      ownArgs: ["--save"],
      userCommand: ["python", "agent.py"],
    });
  });

  it("leaves the traced program's own flags alone", () => {
    const { ownArgs, userCommand } = splitInvocation(["--save", "python", "agent.py", "--json", "-v"]);
    expect(ownArgs).toEqual(["--save"]);
    // The regression: --json used to be consumed by costcatch.
    expect(userCommand).toEqual(["python", "agent.py", "--json", "-v"]);
  });

  it("honours an explicit -- terminator", () => {
    expect(splitInvocation(["--save", "--", "python", "agent.py", "--save"])).toEqual({
      ownArgs: ["--save"],
      userCommand: ["python", "agent.py", "--save"],
    });
  });

  it("lets -- override the runtime heuristic entirely", () => {
    const { userCommand } = splitInvocation(["--", "poetry", "run", "python", "agent.py"]);
    expect(userCommand).toEqual(["poetry", "run", "python", "agent.py"]);
  });

  it("keeps the run subcommand on costcatch's side", () => {
    expect(splitInvocation(["run", "--save", "node", "agent.js"])).toEqual({
      ownArgs: ["run", "--save"],
      userCommand: ["node", "agent.js"],
    });
  });

  it("returns no user command when nothing looks like a runtime", () => {
    expect(splitInvocation(["stats", "--week"])).toEqual({
      ownArgs: ["stats", "--week"],
      userCommand: [],
    });
  });

  it("handles an empty argv", () => {
    expect(splitInvocation([])).toEqual({ ownArgs: [], userCommand: [] });
  });
});
