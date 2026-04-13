import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  target: "esnext",
  dts: true,
  sourcemap: true,
  clean: true,
});
