#!/usr/bin/env node
// Regenerates web/data/site-captures.ts, the terminal output shown on the landing page and /demo.
//
//   npm run build              at the repository root, so dist/ is the current CLI
//   npm run captures           in web/ (about two minutes; needs python with httpx)
//   npm run captures -- --offline    the same, with `init --offline` (no price download)
//
// The landing copy quotes figures from these runs, so update it if a scenario changes.

import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, "../..");
const REPO = path.resolve(WEB, "..");
const CLI = path.join(REPO, "dist", "index.js");
const OUT = path.join(WEB, "data", "site-captures.ts");
const WIDTH = 96;
const OFFLINE = process.argv.includes("--offline");

function fail(message) {
  console.error(`captures: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(CLI)) fail(`${path.relative(process.cwd(), CLI)} is missing. Run "npm run build" at the repository root first.`);

const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "costcatch-site-")));
const PROJECT = path.join(ROOT, "oncall-agent");
const BIN = path.join(ROOT, "bin");
const HOME = path.join(ROOT, "home");
const INIT_HOME = path.join(ROOT, "init-home");
for (const dir of [PROJECT, BIN, HOME, INIT_HOME]) fs.mkdirSync(dir, { recursive: true });

let api = null;
process.on("exit", () => {
  api?.kill();
  fs.rmSync(ROOT, { recursive: true, force: true });
});

fs.writeFileSync(path.join(BIN, "costcatch"), `#!/bin/sh\nexec "${process.execPath}" "${CLI}" "$@"\n`, { mode: 0o755 });

const onPath = (cmd) =>
  (process.env.PATH ?? "")
    .split(path.delimiter)
    .map((dir) => path.join(dir, cmd))
    .find((file) => fs.existsSync(file));
if (!onPath("python")) {
  const python3 = onPath("python3");
  if (!python3) fail("python3 is not on PATH.");
  fs.symlinkSync(python3, path.join(BIN, "python"));
}

const AGENT = fs.readFileSync(path.join(HERE, "research_agent.py"), "utf-8");
const AGENT_FIXED = fs.readFileSync(path.join(HERE, "research_agent_fixed.py"), "utf-8");
const installAgent = (source) => fs.writeFileSync(path.join(PROJECT, "research_agent.py"), source);
fs.copyFileSync(path.join(HERE, "summarize.py"), path.join(PROJECT, "summarize.py"));
fs.copyFileSync(path.join(HERE, "prompt.md"), path.join(PROJECT, "prompt.md"));

const env = { ...process.env, PATH: `${BIN}${path.delimiter}${process.env.PATH}`, COLUMNS: String(WIDTH) };
for (const key of Object.keys(env)) {
  if (key.startsWith("COSTCATCH_") || ["NO_COLOR", "FORCE_COLOR", "CI", "LINES"].includes(key)) delete env[key];
}
env.COSTCATCH_HOME = HOME;

if (spawnSync("python", ["-c", "import httpx"], { env }).status !== 0) fail("the demo agents need httpx: pip install httpx");

function sh(command, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-c", command], { cwd: PROJECT, env: { ...env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let combined = "";
    child.stdout.on("data", (d) => { stdout += d; combined += d; });
    child.stderr.on("data", (d) => { stderr += d; combined += d; });
    child.on("close", (code) => resolve({ command, exitCode: code ?? 1, stdout, stderr, combined }));
  });
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");

function tidy(text) {
  const lines = text
    .replace(ANSI, "")
    .replaceAll(PROJECT, "~/oncall-agent")
    .split("\n")
    .map((line) => line.trimEnd());
  let top = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith("┌")) top = line;
    else if (line.trimStart().startsWith("└")) top = null;
    else if (top && line.includes("created .costcatch/ (")) {
      const indent = line.length - line.trimStart().length;
      const row = "│ ✓ created .costcatch/ (~/oncall-agent/.costcatch)";
      lines[i] = " ".repeat(indent) + row.padEnd(top.length - indent - 1) + "│";
    }
  }
  while (lines.length && lines[0] === "") lines.shift();
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

function lastBoxes(text) {
  const lines = tidy(text).split("\n");
  const end = lines.findLastIndex((line) => line.startsWith("└"));
  let start = lines.findLastIndex((line, i) => i < end && line.startsWith("┌"));
  if (start < 0 || end < 0) fail(`no closing box in:\n${text}`);
  // Each failed gate prints its own box, so walk back to include all of them.
  for (;;) {
    let prev = start - 1;
    while (prev >= 0 && lines[prev] === "") prev--;
    if (prev < 0 || !lines[prev].startsWith("└")) break;
    start = lines.findLastIndex((line, i) => i < prev && line.startsWith("┌"));
  }
  return lines.slice(start, end + 1).join("\n");
}

const captures = {};

async function capture(id, command, { keep = "stdout", expectExit, extraEnv } = {}) {
  process.stdout.write(`  ${id.padEnd(9)} $ ${command}\n`);
  const run = await sh(command, extraEnv);
  if (expectExit !== undefined && run.exitCode !== expectExit) {
    fail(`"${command}" exited ${run.exitCode}, expected ${expectExit}\n${run.stdout}\n${run.stderr}`);
  }
  const output = keep === "lastBoxes" ? lastBoxes(run.stderr) : tidy(keep === "combined" ? run.combined : run.stdout);
  captures[id] = { command, output, exitCode: run.exitCode };
}

async function setup(command, expectExit) {
  process.stdout.write(`  ${"(setup)".padEnd(9)} $ ${command}\n`);
  const run = await sh(command);
  if (run.exitCode !== expectExit) fail(`"${command}" exited ${run.exitCode}, expected ${expectExit}\n${run.stdout}\n${run.stderr}`);
}

api = spawn(process.execPath, [path.join(HERE, "demo-api.mjs"), "0"], { stdio: ["ignore", "pipe", "inherit"] });
env.DEMO_API_URL = await new Promise((resolve, reject) => {
  api.stdout.once("data", (d) => resolve(/http:\/\/\S+/.exec(String(d))?.[0]));
  api.once("exit", (code) => reject(new Error(`demo API exited with ${code}`)));
});

try {
  console.log(`captures: running in ${PROJECT}`);
  await capture("init", OFFLINE ? "costcatch init --offline" : "costcatch init", {
    keep: "combined",
    expectExit: 0,
    extraEnv: { COSTCATCH_HOME: INIT_HOME },
  });
  if (!OFFLINE && !captures.init.output.includes("fetched latest pricing")) {
    fail(`init could not download prices:\n${captures.init.output}\nRun with --offline to use the bundled prices.`);
  }

  installAgent(AGENT);
  await capture("run", "costcatch --save python research_agent.py", { expectExit: 1 });
  await capture("show", "costcatch show --step 1", { expectExit: 0 });

  installAgent(AGENT_FIXED);
  await setup("costcatch --save python research_agent.py", 0);
  await capture("diff", "costcatch diff", { expectExit: 0 });
  await capture("replay", "costcatch replay", { expectExit: 0 });

  await setup("costcatch --save python summarize.py", 0);
  await capture("stats", "costcatch stats", { expectExit: 0 });
  await capture("estimate", "costcatch estimate prompt.md --model gpt-4o,claude-sonnet-4-20250514,gemini-2.5-flash", { expectExit: 0 });
  await capture("watch", "costcatch watch python research_agent.py", { expectExit: 0 });
  await capture("clean", "costcatch clean --keep 3 --dry-run", { expectExit: 0 });

  installAgent(AGENT);
  await capture("gates", "costcatch --max-cost 0.05 --max-errors 0 python research_agent.py", { keep: "lastBoxes", expectExit: 1 });
  await capture("budget", "costcatch --budget 0.03 python research_agent.py", { keep: "lastBoxes", expectExit: 1 });
} finally {
  api.kill();
  api = null;
}

// The oldest saved trace is the first run.
const saved = fs.readdirSync(path.join(PROJECT, ".costcatch")).filter((f) => f.endsWith("-research_agent.json")).sort();
const trace = JSON.parse(fs.readFileSync(path.join(PROJECT, ".costcatch", saved[0]), "utf-8"));
const warnings = trace.warnings.map(({ code, severity, message }) => ({ code, severity, message }));
const printed = captures.run.output.split("\n").filter((line) => line.startsWith("│ ● ")).length;
if (warnings.length !== printed) fail(`the saved trace has ${warnings.length} warnings, the run printed ${printed}`);

const leaks = [ROOT, os.homedir(), "/private/", "/var/folders", String.fromCharCode(27)];
for (const [id, c] of Object.entries(captures)) {
  const hit = leaks.find((needle) => c.output.includes(needle) || c.command.includes(needle));
  if (hit) fail(`capture "${id}" contains ${JSON.stringify(hit)}:\n${c.output}`);
  for (const line of c.output.split("\n")) {
    if (line.startsWith("│") && line.length !== WIDTH && !line.startsWith("│ ✓ created")) {
      // Only init's banner panel is narrower than the trace boxes. Any other short row is broken.
      if (id !== "init") fail(`capture "${id}" has a row of width ${line.length}: ${line}`);
    }
  }
}

const literal = (s) => "`" + s.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${") + "`";
const body = Object.entries(captures)
  .map(([id, c]) => `  ${id}: {\n    command: ${literal(c.command)},\n    output: ${literal(c.output)},\n    exitCode: ${c.exitCode},\n  },`)
  .join("\n");

const version = spawnSync(process.execPath, [CLI, "--version"], { env, encoding: "utf-8" }).stdout.trim();
const file = `/**
 * Terminal output for the landing page and /demo. Generated by scripts/captures/generate.mjs
 * from real runs of the costcatch CLI (v${version}); do not edit by hand.
 *
 * The agent is a demo on-call agent in Python, run against a local stand-in for the provider
 * APIs; init downloaded the public price lists, and the other runs use the bundled prices.
 * Output is as printed, except: colour is stripped; the project's path reads ~/oncall-agent;
 * and the gates and budget entries keep only the boxes printed at the end.
 */

import type { Capture } from "./captures";

export const SITE_CAPTURES = {
${body}
} satisfies Record<string, Capture>;

export type SiteCaptureId = keyof typeof SITE_CAPTURES;

/** The first run's warnings (\`run\`), worst first, as its saved trace records them. */
export const RUN_WARNINGS: { code: string; severity: "critical" | "warn" | "info"; message: string }[] = ${JSON.stringify(warnings, null, 2)};
`;

fs.writeFileSync(OUT, file);
console.log(`captures: wrote ${path.relative(process.cwd(), OUT)} (${Object.keys(captures).length} captures)`);
