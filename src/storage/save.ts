// Writes traces through a temp file and rename, so an interrupted run can't leave a half-written one.
import * as fs from "node:fs";
import * as path from "node:path";
import type { Trace } from "../types/trace.js";
import { ensureTracesDir } from "./index.js";

export function saveTrace(trace: Trace, projectRoot: string, customName?: string): string {
  const tracesDir = ensureTracesDir(projectRoot);

  const wanted = customName ? sanitizeFilename(customName.replace(/\.json$/i, "")) : "";
  // A trace named pricing would overwrite the price cache when run from $COSTCATCH_HOME.
  const chosen = wanted && wanted.toLowerCase() !== "pricing" ? wanted : null;
  const filename = customName ? `${chosen ?? (wanted ? `${wanted}-trace` : "trace")}.json` : buildFilename(trace);
  const filepath = uniquePath(path.join(tracesDir, filename), chosen !== null);

  const json = JSON.stringify(trace, null, 2);
  const tmp = `${filepath}.${process.pid}.tmp`;

  try {
    fs.writeFileSync(tmp, json, { encoding: "utf-8", mode: 0o600 });
    fs.renameSync(tmp, filepath);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {}
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`costcatch: could not save trace to ${filepath}: ${reason}`);
  }

  return filepath;
}

function buildFilename(trace: Trace): string {
  const scriptBase = path.basename(trace.script, path.extname(trace.script));
  const safeName = sanitizeFilename(scriptBase) || "trace";
  return `${sanitizeFilename(trace.runId)}-${safeName}.json`;
}

// Run ids only go down to the second, so only a name chosen with --save-as may overwrite.
function uniquePath(desired: string, allowOverwrite: boolean): string {
  if (allowOverwrite || !fs.existsSync(desired)) return desired;

  const dir = path.dirname(desired);
  const ext = path.extname(desired);
  const base = path.basename(desired, ext);
  for (let n = 2; n < 1000; n++) {
    const candidate = path.join(dir, `${base}-${n}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(dir, `${base}-${Date.now()}${ext}`);
}

// Keeping only these characters also blocks path traversal like ../../etc/passwd.
function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned.slice(0, 120);
}
