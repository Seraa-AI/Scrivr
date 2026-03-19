/**
 * High-fidelity canvas setup.
 *
 * On retina / HiDPI displays window.devicePixelRatio is 2 or 3.
 * A canvas sized at 794×1123 CSS pixels is physically rendered at
 * 794×1123 device pixels, then stretched by the browser to fill the
 * actual 1588×2246 physical pixels — producing blurry output.
 *
 * Fix: size the canvas backing store at (width * dpr) × (height * dpr),
 * keep the CSS display size at (width × height), and scale the drawing
 * context by dpr so all your coordinates remain in CSS pixel space.
 *
 * Every draw call you make is in CSS pixels. The scaling handles the rest.
 */

export interface CanvasSetupOptions {
  /** Logical width in CSS pixels (e.g. 794 for A4) */
  width: number;
  /** Logical height in CSS pixels (e.g. 1123 for A4) */
  height: number;
  /**
   * Override the pixel ratio — useful in tests or for forcing 1x.
   * Defaults to window.devicePixelRatio.
   */
  dpr?: number;
}

export interface CanvasSetupResult {
  ctx: CanvasRenderingContext2D;
  /** The actual device pixel ratio used */
  dpr: number;
  /** Logical width (CSS pixels) */
  width: number;
  /** Logical height (CSS pixels) */
  height: number;
}

/**
 * Sets up a canvas element for high-DPI rendering.
 *
 * Call this once when mounting, and again whenever the canvas is resized
 * or the window moves to a display with a different pixel ratio.
 *
 * @example
 * const { ctx } = setupCanvas(canvasEl, { width: 794, height: 1123 })
 * ctx.fillText("crisp text", 40, 60) // coordinates are still in CSS pixels
 */
export function setupCanvas(
  canvas: HTMLCanvasElement,
  options: CanvasSetupOptions
): CanvasSetupResult {
  const { width, height } = options;
  const dpr = options.dpr ?? window.devicePixelRatio ?? 1;

  // Physical backing store — sized up by dpr
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);

  // CSS display size — stays at logical size so layout is unaffected
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d", { alpha: false })!;

  // Scale all draw calls so you work in CSS pixel coordinates
  ctx.scale(dpr, dpr);

  // Consistent text rendering defaults
  ctx.textBaseline = "alphabetic"; // matches how fonts report ascent/descent metrics
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  return { ctx, dpr, width, height };
}

/**
 * Clears the entire canvas and resets the transform scale.
 *
 * Call at the start of every render pass.
 * Re-applies the dpr scale after clearing so draw calls remain in CSS pixels.
 */
export function clearCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
  background = "#ffffff"
): void {
  // resetTransform clears the dpr scale — we need to reapply it
  ctx.resetTransform();
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width * dpr, height * dpr);
  ctx.scale(dpr, dpr);
  ctx.textBaseline = "alphabetic";
}
