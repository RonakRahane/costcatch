import { defineConfig } from "tsup";
import { cpSync, rmSync, existsSync, readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { version: string };

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: true,
  dts: false,
  shims: false,
  banner: {
    // Shebang for CLI binary execution
    js: "#!/usr/bin/env node",
  },
  publicDir: false,
  // Single-sourced from package.json. `src/core/version.ts` reads this behind a
  // `typeof` guard so the unbundled dev path (tsx/vitest) still resolves a
  // version. The previous config defined `process.env.AGENT_TRACE_VERSION`,
  // which no code ever read — so `--version` was permanently stuck at 0.1.0.
  define: {
    __COSTCATCH_VERSION__: JSON.stringify(pkg.version),
  },
  // Interceptors are runtime assets (.cjs / .py) loaded from disk when the
  // child process is spawned — they must be COPIED, not bundled. tsup's
  // `clean` runs before esbuild; `onSuccess` runs after, so this ordering is
  // correct. Without this, a published `npm install -g costcatch` ships zero
  // interceptors and captures nothing.
  onSuccess: async () => {
    const dest = "dist/interceptors";
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
    cpSync("src/interceptors", dest, {
      recursive: true,
      // don't copy Python bytecode caches or macOS cruft
      filter: (src) => !src.includes("__pycache__") && !src.endsWith(".DS_Store"),
    });
    // Defensive copy of the pricing snapshot (already inlined into the bundle,
    // but handy for the `init` refresh reference).
    cpSync("src/pricing/fallback-prices.json", "dist/pricing/fallback-prices.json");
  },
});
