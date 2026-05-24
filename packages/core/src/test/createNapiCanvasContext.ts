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
 *
 * The `@napi-rs/canvas` `SKRSContext2D` has a different declared type than
 * the DOM `CanvasRenderingContext2D`, but is structurally a superset of the
 * two `TextMeasureContext` members (`font`, `measureText`). The narrow guard
 * below adapts via a single typed parameter — no `as unknown as` cast at the
 * call site, and the compiler still enforces that the napi ctx supplies the
 * fields the engine reads.
 */
function adaptMeasureContext(ctx: {
  font: string;
  measureText: (text: string) => TextMetrics;
}): TextMeasureContext {
  return ctx;
}

export function createNapiCanvasContext(
  width = 1024,
  height = 1024,
): TextMeasureContext {
  return adaptMeasureContext(createCanvas(width, height).getContext("2d"));
}
