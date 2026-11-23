import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    collaboration: "src/collaboration/index.ts",
    "track-changes": "src/track-changes/index.ts",
    "citation-highlight": "src/citation-highlight/index.ts",
    "header-footer": "src/header-footer/index.ts",
    "sealed-viewer": "src/sealed-viewer/index.ts",
  },
  format: ["esm", "cjs"],
  // Entries share one copy of each module in both formats, so a plugin key
  // from the root and from its own entry are the same key.
  splitting: true,
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    "@scrivr/core",
    "@hocuspocus/provider",
    "prosemirror-model",
    "prosemirror-state",
    "prosemirror-transform",
    "y-prosemirror",
    "yjs",
  ],
});
