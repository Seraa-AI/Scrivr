import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // In dev/build, point workspace packages directly at their source.
    // This means we don't need to run `tsup` on core before starting the demo.
    alias: {
      "@canvas-editor/core": resolve(__dirname, "../../packages/core/src/index.ts"),
      "@canvas-editor/plugins": resolve(__dirname, "../../packages/plugins/src/index.ts"),
      "@canvas-editor/export": resolve(__dirname, "../../packages/export/src/index.ts"),
      "@canvas-editor/react": resolve(__dirname, "../../packages/react/src/index.ts"),
    },
  },
});
