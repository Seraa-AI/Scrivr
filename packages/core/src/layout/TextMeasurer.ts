/**
 * TextMeasurer — wraps canvas.measureText() with caching and font metric stability.
 *
 * Three problems it solves:
 *
 * 1. Jiggling lines — uses fontBoundingBoxAscent/Descent (constant per font)
 *    rather than actualBoundingBoxAscent/Descent (varies per string content).
 *    Every line in "14pt Georgia" is the same height whether it contains
 *    "aaa" or "Agpyj".
 *
 * 2. Performance — measureText() is expensive. A 10-page document has thousands
 *    of unique words but only hundreds of unique (font, word) pairs. Double-keyed
 *    cache: Map<font, Map<text, width>>.
 *
 * 3. Kerning — "AV" is narrower than measureWidth("A") + measureWidth("V").
 *    measureRun() gives per-character x positions via cumulative measurement,
 *    so CharacterMap coordinates are kerning-accurate.
 */

export interface FontMetrics {
  /** Distance from baseline to top of tallest possible glyph in this font */
  ascent: number;
  /** Distance from baseline to bottom of deepest possible glyph in this font */
  descent: number;
  /** ascent + descent — height to allocate per line */
  lineHeight: number;
}

export interface RunMetrics {
  /** Total measured width of the string */
  totalWidth: number;
  /**
   * X position of each character relative to the start of the string.
   * Length === text.length. Kerning-accurate via cumulative measurement.
   *
   * charPositions[0] is always 0 (first char starts at the run's origin).
   * charPositions[1] is the width of text[0] (accounting for kerning with text[1]).
   */
  charPositions: number[];
}

/**
 * Minimal LRU cache backed by a Map.
 * JavaScript Maps maintain insertion order — deleting and re-inserting on
 * access keeps the most-recently-used entry at the end and the least-recently-
 * used at the front.  Eviction is O(1): `map.keys().next()` gives the oldest.
 */
class LRUCache<V> {
  private map = new Map<string, V>();
  constructor(private readonly maxSize: number) {}

  get(key: string): V | undefined {
    const val = this.map.get(key);
    if (val === undefined) return undefined;
    // Move to end (most recently used)
    this.map.delete(key);
    this.map.set(key, val);
    return val;
  }

  set(key: string, val: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, val);
    if (this.map.size > this.maxSize) {
      // Evict least-recently-used (first entry)
      this.map.delete(this.map.keys().next().value!);
    }
  }

  /** Remove all entries whose key satisfies the predicate. O(n). */
  deleteIf(predicate: (key: string) => boolean): void {
    for (const key of [...this.map.keys()]) {
      if (predicate(key)) this.map.delete(key);
    }
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}

export class TextMeasurer {
  private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

  /** font → text → width */
  private widthCache = new Map<string, Map<string, number>>();

  /** font → FontMetrics */
  private metricCache = new Map<string, FontMetrics>();

  /**
   * LRU cache for measureRun results.
   * Key: `${font}\x00${text}` — null separator avoids collisions.
   * 2 000 entries covers the vocabulary of a large document with room to spare.
   * measureRun() is O(n) raw ctx.measureText calls; a cache hit is O(1).
   */
  private runCache = new LRUCache<RunMetrics>(2000);

  /** How much to multiply (ascent + descent) for final line height */
  private lineHeightMultiplier: number;

  constructor({ lineHeightMultiplier = 1.2 }: { lineHeightMultiplier?: number } = {}) {
    this.lineHeightMultiplier = lineHeightMultiplier;
    this.ctx = this.createContext();
  }

  /**
   * Returns the width of a string in a given font.
   * Results are cached — safe to call thousands of times per layout pass.
   *
   * Note: do NOT trim the text — "word " must be measured differently
   * from "word" because the trailing space affects where lines break.
   */
  measureWidth(text: string, font: string): number {
    let fontCache = this.widthCache.get(font);
    if (!fontCache) {
      fontCache = new Map();
      this.widthCache.set(font, fontCache);
    }

    const cached = fontCache.get(text);
    if (cached !== undefined) return cached;

    this.ctx.font = font;
    const width = this.ctx.measureText(text).width;
    fontCache.set(text, width);
    return width;
  }

  /**
   * Returns stable vertical metrics for a font.
   * Uses fontBoundingBoxAscent/Descent when available (Chrome/Edge/Firefox 116+).
   * Falls back to measuring "Hg" — tall cap + deep descender — for older browsers.
   *
   * Result is cached per font string and never varies with string content,
   * so line heights stay stable as the user types.
   */
  getFontMetrics(font: string): FontMetrics {
    const cached = this.metricCache.get(font);
    if (cached) return cached;

    this.ctx.font = font;
    const m = this.ctx.measureText("Hg");

    const ascent =
      "fontBoundingBoxAscent" in m && m.fontBoundingBoxAscent != null
        ? m.fontBoundingBoxAscent
        : m.actualBoundingBoxAscent;

    const descent =
      "fontBoundingBoxDescent" in m && m.fontBoundingBoxDescent != null
        ? m.fontBoundingBoxDescent
        : m.actualBoundingBoxDescent;

    const metrics: FontMetrics = {
      ascent,
      descent,
      lineHeight: (ascent + descent) * this.lineHeightMultiplier,
    };

    this.metricCache.set(font, metrics);
    return metrics;
  }

  /**
   * Measures a full text run and returns the x position of every character.
   *
   * Uses cumulative measurement to capture kerning:
   *   charPositions[i] = measureWidth(text.slice(0, i), font)
   *
   * This is more expensive than measureWidth() — use it only when populating
   * the CharacterMap (i.e. during layout, not during line-break decisions).
   */
  measureRun(text: string, font: string): RunMetrics {
    if (text.length === 0) {
      return { totalWidth: 0, charPositions: [] };
    }

    const key = `${font}\x00${text}`;
    const cached = this.runCache.get(key);
    if (cached) return cached;

    this.ctx.font = font;
    const charPositions: number[] = new Array(text.length).fill(0) as number[];

    // charPositions[0] is always 0 — first character starts at the run origin
    for (let i = 1; i < text.length; i++) {
      // Measure the string up to this character — captures kerning with prior chars
      charPositions[i] = this.ctx.measureText(text.slice(0, i)).width;
    }

    const totalWidth = this.ctx.measureText(text).width;
    const result: RunMetrics = { totalWidth, charPositions };
    this.runCache.set(key, result);
    return result;
  }

  /**
   * Clears cached measurements.
   *
   * Call after a font loads (document.fonts.ready or FontFaceObserver) to
   * prevent stale metrics from corrupting layout. The layout engine should
   * trigger a full re-layout after invalidation.
   *
   * @param font — if provided, clears only that font's cache entries.
   *               if omitted, clears everything.
   */
  invalidate(font?: string): void {
    if (font) {
      this.widthCache.delete(font);
      this.metricCache.delete(font);
      // Evict only run-cache entries for this font — key format is `${font}\x00${text}`.
      // Clearing all entries would discard valid kerning data for other fonts.
      const prefix = `${font}\x00`;
      this.runCache.deleteIf((key) => key.startsWith(prefix));
    } else {
      this.widthCache.clear();
      this.metricCache.clear();
      this.runCache.clear();
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private createContext(): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
    // OffscreenCanvas is preferred: no DOM required, works in Web Workers
    if (typeof OffscreenCanvas !== "undefined") {
      return new OffscreenCanvas(1, 1).getContext("2d")!;
    }
    // Fallback for environments without OffscreenCanvas (older Safari, jsdom, happy-dom)
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    return canvas.getContext("2d")!;
  }
}
