/**
 * Single source of truth for the CLI's version string.
 *
 * The version used to be hardcoded in three places (`src/index.ts`,
 * `src/ui/matrix-banner.ts`, and a tsup `define` that injected a *different*
 * variable name than the code read). `costcatch --version` therefore reported
 * `0.1.0` forever, no matter what package.json said — which makes every bug
 * report ambiguous about which build the user is actually running.
 *
 * Resolution order:
 *   1. `COSTCATCH_VERSION` env var — lets packagers and tests override.
 *   2. `__COSTCATCH_VERSION__` — replaced at build time by tsup with the literal
 *      from package.json.
 *   3. package.json found by walking up from this module — the dev/tsx path.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** Injected by tsup's `define`. Absent when running unbundled. */
declare const __COSTCATCH_VERSION__: string | undefined;

let cached: string | null = null;

/** Walk up from this module looking for the package's own package.json. */
function readVersionFromPackageJson(): string | null {
  try {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let depth = 0; depth < 5; depth++) {
      const candidate = path.join(dir, "package.json");
      if (fs.existsSync(candidate)) {
        const pkg = JSON.parse(fs.readFileSync(candidate, "utf-8")) as { name?: string; version?: string };
        // Guard against picking up a *user's* package.json when costcatch is
        // linked into their tree.
        if (pkg.name === "costcatch" && typeof pkg.version === "string") return pkg.version;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // Unreadable or malformed — fall through to "unknown".
  }
  return null;
}

/** The running CLI's version, e.g. "0.1.0". Never throws. */
export function getVersion(): string {
  if (cached !== null) return cached;

  const fromEnv = process.env.COSTCATCH_VERSION;
  if (fromEnv) {
    cached = fromEnv;
    return cached;
  }

  // `typeof` on an undeclared identifier is safe in both bundled and dev builds.
  if (typeof __COSTCATCH_VERSION__ === "string" && __COSTCATCH_VERSION__.length > 0) {
    cached = __COSTCATCH_VERSION__;
    return cached;
  }

  cached = readVersionFromPackageJson() ?? "0.0.0-dev";
  return cached;
}
