/**
 * Vitest setup for @scrivr/core.
 *
 * happy-dom ships an `HTMLCanvasElement` but no 2D context implementation.
 * This file wires `@napi-rs/canvas` (Skia, real font metrics, zero system
 * deps) into `getContext("2d")` once. Same role as jsdom's hardcoded
 * `require("canvas")` — just expressed in JS because happy-dom has no
 * package-level hook.
 *
 * Measurement still flows through the DI seam at `TextMeasurer` / `Editor`
 * (`createTestEditor` in `src/test-utils.ts`). The wiring here only matters
 * for paint paths (TileManager, PageRenderer, OverlayRenderer) that
 * construct their own canvas elements internally.
 */
import { createCanvas } from "@napi-rs/canvas";

const ctxCache = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
const originalGetContext = HTMLCanvasElement.prototype.getContext;

HTMLCanvasElement.prototype.getContext = function (
  this: HTMLCanvasElement,
  contextId: string,
): CanvasRenderingContext2D | null {
  if (contextId !== "2d") {
    return originalGetContext.call(this, contextId as "2d") as CanvasRenderingContext2D | null;
  }
  const cached = ctxCache.get(this);
  if (cached) return cached;
  const canvas = createCanvas(this.width || 300, this.height || 150);
  const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
  ctxCache.set(this, ctx);
  return ctx;
} as typeof HTMLCanvasElement.prototype.getContext;
