// Creates the per-project traces directory, and adds it to .gitignore on init.
import * as fs from "node:fs";
import * as path from "node:path";
import { TRACES_DIR } from "../core/constants.js";

export { TRACES_DIR };

export type GitignoreResult = "added" | "present" | "failed";

export function initTracesDir(projectRoot: string): { dir: string; gitignore: GitignoreResult } {
  const dir = ensureTracesDir(projectRoot);
  return { dir, gitignore: addToGitignore(projectRoot, TRACES_DIR) };
}

// Runs on every save, so it leaves .gitignore alone.
export function ensureTracesDir(projectRoot: string): string {
  const tracesDir = path.join(projectRoot, TRACES_DIR);
  if (!fs.existsSync(tracesDir)) {
    fs.mkdirSync(tracesDir, { recursive: true });
  } else if (!fs.statSync(tracesDir).isDirectory()) {
    throw new Error(`${tracesDir} exists but is not a directory`);
  }
  return tracesDir;
}

function addToGitignore(projectRoot: string, entry: string): GitignoreResult {
  const gitignorePath = path.join(projectRoot, ".gitignore");

  try {
    let content = "";
    if (fs.existsSync(gitignorePath)) {
      content = fs.readFileSync(gitignorePath, "utf-8");
    }

    // Match whole lines, since a substring test would also match .costcatch-old/.
    const lines = content.split("\n");
    const entryWithSlash = entry.endsWith("/") ? entry : `${entry}/`;
    const alreadyPresent = lines.some(
      (line) => line.trim() === entry || line.trim() === entryWithSlash,
    );

    if (alreadyPresent) return "present";
    const separator = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
    const addition = `${separator}\n# costcatch traces\n${entryWithSlash}\n`;
    fs.writeFileSync(gitignorePath, content + addition, "utf-8");
    return "added";
  } catch {
    return "failed";
  }
}
