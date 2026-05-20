import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.spec.ts", "src/**/*.test.tsx", "src/**/*.spec.tsx"],
    globals: true,
    reporters: process.env.CI ? ["github-actions", "verbose"] : ["default"],
  },
});
