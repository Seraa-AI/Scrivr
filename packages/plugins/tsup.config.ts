import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    "@inscribe/core",
    "@hocuspocus/provider",
    "prosemirror-model",
    "prosemirror-state",
    "prosemirror-transform",
    "y-prosemirror",
    "yjs",
  ],
});
