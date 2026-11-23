import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "track-changes": "src/track-changes.ts",
    "header-footer": "src/header-footer.ts",
    ai: "src/ai.ts",
  },
  format: ["esm", "cjs"],
  // Entries share one copy of each module in each format, so state a hook
  // keeps is the same whichever entry it was imported from.
  splitting: true,
  dts: true,
  sourcemap: true,
  clean: true,
  external: ["react", "react-dom", "@scrivr/core", "@scrivr/plugins", "@scrivr/ai"],
});
