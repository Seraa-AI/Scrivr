import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["**/index.ts", "**/*.test.ts", "**/*.spec.ts", "**/test-utils.ts"],
      reporter: ["text", "html"],
    },
  },
});
