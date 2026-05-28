// Reads the CLI version from COSTCATCH_VERSION, the build, or the nearest package.json.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

declare const __COSTCATCH_VERSION__: string | undefined;

let cached: string | null = null;

function readVersionFromPackageJson(): string | null {
  try {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let depth = 0; depth < 5; depth++) {
      const candidate = path.join(dir, "package.json");
      if (fs.existsSync(candidate)) {
        const pkg = JSON.parse(fs.readFileSync(candidate, "utf-8")) as { name?: string; version?: string };
        // Check the name because costcatch may be npm-linked inside someone else's project.
        if (pkg.name === "costcatch" && typeof pkg.version === "string") return pkg.version;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {}
  return null;
}

export function getVersion(): string {
  if (cached !== null) return cached;

  const fromEnv = process.env.COSTCATCH_VERSION;
  if (fromEnv) {
    cached = fromEnv;
    return cached;
  }

  // Use typeof because the identifier doesn't exist when running unbundled.
  if (typeof __COSTCATCH_VERSION__ === "string" && __COSTCATCH_VERSION__.length > 0) {
    cached = __COSTCATCH_VERSION__;
    return cached;
  }

  cached = readVersionFromPackageJson() ?? "0.0.0-dev";
  return cached;
}
