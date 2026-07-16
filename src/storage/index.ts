/**
 * Storage initialization.
 *
 * Sets up the .costcatch/ directory and adds it to .gitignore.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** Default traces directory name. */
export const TRACES_DIR = ".costcatch";

/**
 * Initialize the traces directory in the given project root.
 * Creates the directory and adds it to .gitignore if not already present.
 *
 * @returns The absolute path to the traces directory.
 */
export function initTracesDir(projectRoot: string): string {
  const tracesDir = path.join(projectRoot, TRACES_DIR);

  // Create directory if it doesn't exist
  if (!fs.existsSync(tracesDir)) {
    fs.mkdirSync(tracesDir, { recursive: true });
  }

  // Add to .gitignore
  addToGitignore(projectRoot, TRACES_DIR);

  return tracesDir;
}

/**
 * Ensure the traces directory exists (without modifying .gitignore).
 * Used during --save to lazily create the directory.
 */
export function ensureTracesDir(projectRoot: string): string {
  const tracesDir = path.join(projectRoot, TRACES_DIR);
  if (!fs.existsSync(tracesDir)) {
    fs.mkdirSync(tracesDir, { recursive: true });
  }
  return tracesDir;
}

/**
 * Add an entry to .gitignore if it's not already there.
 */
function addToGitignore(projectRoot: string, entry: string): void {
  const gitignorePath = path.join(projectRoot, ".gitignore");

  try {
    let content = "";
    if (fs.existsSync(gitignorePath)) {
      content = fs.readFileSync(gitignorePath, "utf-8");
    }

    // Check if entry already exists (exact line match)
    const lines = content.split("\n");
    const entryWithSlash = entry.endsWith("/") ? entry : `${entry}/`;
    const alreadyPresent = lines.some(
      (line) => line.trim() === entry || line.trim() === entryWithSlash,
    );

    if (!alreadyPresent) {
      // Add a newline before our entry if the file doesn't end with one
      const separator = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
      const addition = `${separator}\n# costcatch traces\n${entryWithSlash}\n`;
      fs.writeFileSync(gitignorePath, content + addition, "utf-8");
    }
  } catch {
    // Non-critical: if we can't write .gitignore, continue silently.
  }
}
