import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Use happy-dom for DOM APIs (canvas, measureText, etc.)
    environment: "happy-dom",

    // Pick up tests from all packages
    include: ["packages/*/src/**/*.test.ts", "packages/*/src/**/*.spec.ts"],

    // Global test utilities available without importing
    globals: true,

    coverage: {
      provider: "v8",
      include: ["packages/*/src/**"],
      exclude: ["**/index.ts", "**/*.test.ts", "**/*.spec.ts"],
      reporter: ["text", "html"],
    },
  },
});
