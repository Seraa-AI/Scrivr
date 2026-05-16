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
 *
 * Cache invariant: per the HTML canvas spec, assigning `canvas.width` or
 * `canvas.height` resets the 2D context (transform, fillStyle, clip, etc.).
 * Real DOM enforces this; the napi-rs context does not. Production paint
 * code resizes the canvas + calls `ctx.scale(dpr, dpr)` on every repaint
 * (TileManager pool reuses tiles), so a naive cache would stack transforms
 * across paints and silently produce green-but-wrong tests. Cache entries
 * are therefore keyed on observed `(width, height)` and invalidated the
 * moment either dimension changes.
 */
import { createCanvas } from "@napi-rs/canvas";

interface CachedCtx {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
}

const ctxCache = new WeakMap<HTMLCanvasElement, CachedCtx>();
const offscreenCache = new WeakMap<OffscreenCanvas, CachedCtx>();
const originalGetContext = HTMLCanvasElement.prototype.getContext;

function wrap(canvas: HTMLCanvasElement | OffscreenCanvas): CanvasRenderingContext2D {
  const napi = createCanvas(
    (canvas.width || 300) as number,
    (canvas.height || 150) as number,
  );
  return napi.getContext("2d") as unknown as CanvasRenderingContext2D;
}

HTMLCanvasElement.prototype.getContext = function (
  this: HTMLCanvasElement,
  contextId: string,
): CanvasRenderingContext2D | null {
  if (contextId !== "2d") {
    return originalGetContext.call(this, contextId as "2d") as CanvasRenderingContext2D | null;
  }
  const w = this.width || 300;
  const h = this.height || 150;
  const cached = ctxCache.get(this);
  if (cached && cached.width === w && cached.height === h) return cached.ctx;
  const ctx = wrap(this);
  ctxCache.set(this, { ctx, width: w, height: h });
  return ctx;
} as typeof HTMLCanvasElement.prototype.getContext;

// Patch OffscreenCanvas too so a future happy-dom that ships it doesn't
// silently bypass the wiring. happy-dom 20.x doesn't expose it, but
// guarding the symbol means we ship a forward-compat setup.
if (typeof OffscreenCanvas !== "undefined") {
  const originalOffscreen = OffscreenCanvas.prototype.getContext;
  OffscreenCanvas.prototype.getContext = function (
    this: OffscreenCanvas,
    contextId: string,
  ): OffscreenCanvasRenderingContext2D | null {
    if (contextId !== "2d") {
      return originalOffscreen.call(
        this,
        contextId as "2d",
      ) as OffscreenCanvasRenderingContext2D | null;
    }
    const w = this.width || 300;
    const h = this.height || 150;
    const cached = offscreenCache.get(this);
    if (cached && cached.width === w && cached.height === h) {
      return cached.ctx as unknown as OffscreenCanvasRenderingContext2D;
    }
    const ctx = wrap(this);
    offscreenCache.set(this, { ctx, width: w, height: h });
    return ctx as unknown as OffscreenCanvasRenderingContext2D;
  } as typeof OffscreenCanvas.prototype.getContext;
}
