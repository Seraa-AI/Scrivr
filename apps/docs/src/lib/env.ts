/**
 * Centralized, validated environment variable access for the docs app.
 *
 * Inspired by the shared `createEnv` pattern used in other projects on this
 * codebase. Validates env vars at module load via Zod, provides typed access,
 * and fails fast on missing or malformed values so callers never need to
 * null-check.
 *
 * This is a client-only Vite bundle, so every variable here is `VITE_`-prefixed.
 * Vite's own gatekeeping ensures non-VITE vars can't accidentally be inlined
 * into the browser bundle, so we don't need the server/client split the fuller
 * createEnv pattern has — there IS no server side in this app's runtime.
 *
 * ⚠️ IMPORTANT: Build-time feature flags do NOT go through this module.
 *
 * Runtime env access (e.g. `env.get("VITE_COLLAB")`) happens at application
 * startup from a cached object that Rollup cannot prove will always have a
 * specific value. That means dead code behind a runtime env check will still
 * ship in the production bundle even though it's unreachable.
 *
 * For feature flags where tree-shaking matters — notably `AI_ENABLED` in
 * Playground.tsx — use direct `import.meta.env.DEV` / `import.meta.env.VITE_X`
 * checks instead. Vite replaces those as LITERAL values at build time, and
 * Rollup's constant folding + dead code elimination strips entire branches
 * of unused code from the production bundle.
 *
 * Rule of thumb:
 *   - Env var affects runtime behavior only?               → env module
 *   - Env var gates code paths that should be tree-shaken? → import.meta.env.X direct
 *
 * Don't "unify" this by routing AI_ENABLED through the module — you'll ship
 * ~100KB of unused AI code to every public docs visitor and we'll have to
 * un-unify it later. See docs/guides/ai-features.mdx for the rationale.
 */

import { z } from "zod";

const clientSchema = z.object({
  /**
   * Enable the local collaboration backend (y-websocket server).
   * When "true", the playground connects to VITE_WS_URL and uses
   * live-collab extensions instead of the static demo document.
   */
  VITE_COLLAB: z
    .enum(["true", "false"])
    .optional()
    .default("false"),

  /**
   * WebSocket URL for the collaboration server. Only used when
   * VITE_COLLAB === "true". Defaults to the local dev server port.
   */
  VITE_WS_URL: z
    .string()
    .url()
    .optional()
    .default("ws://localhost:1235"),
});

type ClientEnv = z.infer<typeof clientSchema>;

// Parse once at module load. Throws if any VITE_ variable is malformed
// (e.g. VITE_COLLAB is set to "yes" instead of "true"). Schema defaults
// cover missing variables.
const parsed = clientSchema.safeParse({
  VITE_COLLAB: import.meta.env.VITE_COLLAB,
  VITE_WS_URL: import.meta.env.VITE_WS_URL,
});

if (!parsed.success) {
  // In a dev server this surfaces as a readable error in the browser console.
  // In a production build this throws synchronously during module evaluation,
  // which fails the page load early and obviously rather than producing a
  // half-working playground with confusing runtime errors later.
  console.error(
    "❌ Client env validation failed:",
    parsed.error.format(),
  );
  throw new Error("Client environment validation failed — see console for details");
}

const cache: ClientEnv = parsed.data;

/**
 * Typed environment variable accessor.
 *
 * Example:
 *   const useCollab = env.get("VITE_COLLAB") === "true";
 *   const wsUrl = env.get("VITE_WS_URL");
 *
 * `get()` never returns undefined — the Zod schema's defaults cover absent
 * values, and malformed values throw at module load rather than at access time.
 */
export const env = {
  get<Key extends keyof ClientEnv>(key: Key): ClientEnv[Key] {
    return cache[key];
  },
};

export type { ClientEnv };
