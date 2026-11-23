import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "track-changes": "src/track-changes.ts",
    "header-footer": "src/header-footer.ts",
    ai: "src/ai.ts",
  },
  format: ["esm", "cjs"],
  // Shared helpers are emitted once instead of copied into every entry.
  splitting: true,
  dts: true,
  sourcemap: true,
  clean: true,
  external: ["react", "react-dom", "@scrivr/core", "@scrivr/plugins", "@scrivr/ai"],
});
