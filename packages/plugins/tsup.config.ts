import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
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
