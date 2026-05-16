/**
 * Real canvas context for tests, backed by `@napi-rs/canvas` (Skia, zero
 * system deps). Use this — never a hand-rolled mock — when a test needs to
 * measure text or pull font metrics.
 *
 * Production code keeps using `document.createElement("canvas")`. Tests
 * inject the Skia-backed context via `TextMeasurer({ context })` or
 * `new Editor({ textMeasurer })`.
 *
 * Determinism note: `@napi-rs/canvas` ships fallback fonts that produce
 * stable widths across platforms (Skia metrics, not OS fonts). If we later
 * see CI drift, we'll commit `Inter-Regular.ttf` under
 * `packages/core/src/test/fixtures/fonts/` and register it via
 * `GlobalFonts.registerFromPath`.
 */

import { createCanvas } from "@napi-rs/canvas";
import type { TextMeasureContext } from "../layout/TextMeasurer";

/**
 * Returns a real 2D context measuring text via Skia.
 * Default 1024x1024 canvas — size doesn't affect measurement, only render
 * bounds. Override only if a test paints into a specific region.
 */
export function createNapiCanvasContext(
  width = 1024,
  height = 1024,
): TextMeasureContext {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  return ctx as unknown as TextMeasureContext;
}
