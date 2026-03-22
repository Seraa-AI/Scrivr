import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@inscribe/core": resolve(__dirname, "../../packages/core/src/index.ts"),
      "@inscribe/plugins": resolve(__dirname, "../../packages/plugins/src/index.ts"),
      "@inscribe/export": resolve(__dirname, "../../packages/export/src/index.ts"),
      "@inscribe/react": resolve(__dirname, "../../packages/react/src/index.ts"),
    },
  },
  plugins: [
    tanstackStart(),
    // react's vite plugin must come after start's vite plugin
    viteReact(),
  ],
});
