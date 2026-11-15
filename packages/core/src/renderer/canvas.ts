/**
 * High-fidelity canvas setup.
 *
 * On retina / HiDPI displays window.devicePixelRatio is 2 or 3, and a view
 * may be zoomed. A canvas whose backing store matched its logical size would
 * be stretched by the browser to fill the physical pixels — blurry.
 *
 * Fix: size the backing store at the logical size times the device pixels
 * each logical unit covers (the display's ratio times the zoom), show it at
 * the logical size times the zoom, and scale the context to match, so draw
 * calls stay in logical units — page units, in Scrivr.
 */

/** The most pixels a canvas may hold: iOS Safari paints a larger one blank. */
export const MAX_CANVAS_PIXELS = 16_777_216;

/**
 * Device pixels per logical unit for a `width × height` canvas shown at
 * `scale`: the display's ratio times the scale, lowered for a backing store
 * that would pass `MAX_CANVAS_PIXELS` — the browser then stretches it, soft
 * at an extreme zoom but never blank. (`+ 1` leaves room for rounding each
 * side up.)
 */
export function pixelsPerUnit(
  width: number,
  height: number,
  scale: number,
  dpr: number = window.devicePixelRatio ?? 1,
): number {
  const ceiling = Math.sqrt(MAX_CANVAS_PIXELS / ((width + 1) * (height + 1)));
  return Math.min(dpr * scale, ceiling);
}

export interface CanvasSetupOptions {
  /** Logical width (e.g. 794 for an A4 page) */
  width: number;
  /** Logical height (e.g. 1123 for an A4 page) */
  height: number;
  /**
   * Override the display's pixel ratio — useful in tests or for forcing 1x.
   * Defaults to window.devicePixelRatio.
   */
  dpr?: number;
  /**
   * The view's zoom. The canvas is shown at `width × scale` CSS pixels and
   * its backing store rasterised at that size, so text stays crisp at every
   * zoom while draw calls keep using logical units. Default: 1.
   */
  scale?: number;
}

export interface CanvasSetupResult {
  ctx: CanvasRenderingContext2D;
  /** Device pixels per logical unit — see `pixelsPerUnit`. Pass it on as the paint's `dpr`. */
  dpr: number;
  /** Logical width */
  width: number;
  /** Logical height */
  height: number;
}

/**
 * Sets up a canvas element for high-DPI rendering.
 *
 * Call this once when mounting, and again whenever the canvas is resized,
 * the zoom changes, or the window moves to a display with a different ratio.
 *
 * @example
 * const { ctx } = setupCanvas(canvasEl, { width: 794, height: 1123 })
 * ctx.fillText("crisp text", 40, 60) // coordinates are in logical units
 */
export function setupCanvas(
  canvas: HTMLCanvasElement,
  options: CanvasSetupOptions
): CanvasSetupResult {
  const { width, height, scale = 1 } = options;
  const dpr = pixelsPerUnit(width, height, scale, options.dpr);

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);

  canvas.style.width = `${width * scale}px`;
  canvas.style.height = `${height * scale}px`;

  const ctx = canvas.getContext("2d", { alpha: false })!;

  ctx.scale(dpr, dpr);

  // Consistent text rendering defaults
  ctx.textBaseline = "alphabetic"; // matches how fonts report ascent/descent metrics
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  return { ctx, dpr, width, height };
}

/**
 * Returns the effective device pixel ratio, accounting for both the display's
 * native ratio and any pinch-to-zoom applied via the Visual Viewport API.
 *
 * pinch-to-zoom changes `visualViewport.scale` but NOT `devicePixelRatio`.
 * Without this, canvas rasterization stays at the base DPR and appears blurry
 * when the user zooms in on trackpad/touch.
 *
 * Capped at 4 to prevent excessive memory usage.
 */
export function getEffectiveDpr(): number {
  const baseDpr = window.devicePixelRatio ?? 1;
  const pinchScale = window.visualViewport?.scale ?? 1;
  return Math.min(baseDpr * pinchScale, 4);
}

/**
 * Watches for device pixel ratio changes (browser zoom, display switch,
 * pinch-to-zoom) and invokes the callback when the effective DPR changes.
 *
 * Returns a cleanup function that removes all listeners.
 */
export function watchDpr(onChange: (dpr: number) => void): () => void {
  let currentDpr = getEffectiveDpr();

  // matchMedia fires when browser zoom changes (devicePixelRatio changes).
  // We create a new query each time the dpr changes because the media query
  // matches a specific value.
  let mql: MediaQueryList | null = null;
  const handleMediaChange = (): void => {
    // Remove old listener before creating new one
    mql?.removeEventListener("change", handleMediaChange);
    const newDpr = getEffectiveDpr();
    if (Math.abs(newDpr - currentDpr) > 0.01) {
      currentDpr = newDpr;
      onChange(currentDpr);
    }
    // Re-listen at the new DPR value
    mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mql.addEventListener("change", handleMediaChange);
  };
  mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  mql.addEventListener("change", handleMediaChange);

  // visualViewport resize fires on pinch-to-zoom
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const handleViewportResize = (): void => {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      const newDpr = getEffectiveDpr();
      if (Math.abs(newDpr - currentDpr) > 0.01) {
        currentDpr = newDpr;
        onChange(currentDpr);
      }
    }, 150);
  };
  window.visualViewport?.addEventListener("resize", handleViewportResize);

  return () => {
    mql?.removeEventListener("change", handleMediaChange);
    window.visualViewport?.removeEventListener("resize", handleViewportResize);
    if (debounceTimer !== null) clearTimeout(debounceTimer);
  };
}

/**
 * Clears the entire canvas and resets the transform scale.
 *
 * Call at the start of every render pass. Re-applies the `dpr` scale — device
 * pixels per logical unit, as `setupCanvas` returned it — after clearing, so
 * draw calls stay in logical units.
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
