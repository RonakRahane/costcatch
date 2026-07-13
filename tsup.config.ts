import { defineConfig } from "tsup";
import { cpSync, rmSync, existsSync } from "node:fs";

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
  esbuildOptions(options) {
    options.define = {
      "process.env.AGENT_TRACE_VERSION": '"0.1.0"',
    };
  },
  // Interceptors are runtime assets (.cjs / .py) loaded from disk when the
  // child process is spawned — they must be COPIED, not bundled. tsup's
  // `clean` runs before esbuild; `onSuccess` runs after, so this ordering is
  // correct. Without this, a published `npm install -g agent-trace` ships zero
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
