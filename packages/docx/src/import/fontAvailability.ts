/**
 * Deciding whether this environment can actually draw a font family.
 *
 * `document.fonts.check()` is the obvious candidate and the wrong one: it
 * answers "is this font face loaded", and returns true for a family the
 * browser will silently substitute. The reliable test is the one the renderer
 * performs anyway — measure a probe string in the candidate family and in a
 * generic, and see whether asking for the family changed anything.
 */

/** Glyphs whose advance widths differ widely between faces. */
const PROBE = "MWmwIl10OQ";

/** Generics a missing family could fall back to; all three must be unchanged. */
const GENERICS = ["monospace", "serif", "sans-serif"] as const;

/**
 * A measurement-backed availability check, or `undefined` where there is no
 * font system to ask (the server). Results are cached — a document names few
 * families and repeats them thousands of times.
 */
export function createCanvasFontAvailability():
  | ((family: string) => boolean)
  | undefined {
  if (typeof document === "undefined") return undefined;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return undefined;

  const widthOf = (font: string): number => {
    context.font = `72px ${font}`;
    return context.measureText(PROBE).width;
  };

  const cache = new Map<string, boolean>();
  return (family: string): boolean => {
    const cached = cache.get(family);
    if (cached !== undefined) return cached;
    // A family the browser does not have falls through to the generic, so the
    // measured width is identical to the generic's in every case.
    const available = GENERICS.some(
      (generic) => widthOf(`"${family}", ${generic}`) !== widthOf(generic),
    );
    cache.set(family, available);
    return available;
  };
}
