import type { FontSynthesis } from "./types";

/**
 * How a renderer stands in for a face nobody owns.
 *
 * Resolution finds the closest face and records what it does not supply;
 * this is the other half — what to do about it. Kept in one place because
 * both lanes have to do the same thing to the same widths: the canvas strokes
 * and shears, the PDF fills-and-strokes and skews, and if the two disagreed
 * about how much, they would disagree about the page.
 *
 * Both techniques are advance-preserving on purpose. A browser's own synthetic
 * bold widens every glyph, which no exporter can reproduce; thickening a glyph
 * in place and leaning it are the two alterations that leave the geometry
 * measured for the real face still true.
 */

/** The lean of a designed italic, near enough: tan(12°). */
export const SYNTHETIC_ITALIC_SHEAR = 0.2126;

/** A full weight step, the distance between a regular and a bold. */
const FULL_WEIGHT_STEP = 300;

/** Stroke width for a full step, as a fraction of the em. */
const EMBOLDEN_RATIO = 0.028;

/**
 * The stroke that stands in for the missing weight, in the same units as the
 * size it is given.
 *
 * Proportional to how far the face falls short, so a regular standing in for a
 * semibold is thickened less than one standing in for a black, and clamped so
 * an extreme request cannot fill the counters in.
 */
export function emboldenWidth(
  synthesis: FontSynthesis | undefined,
  sizePx: number,
): number {
  const weight = synthesis?.weight;
  if (!weight || weight.to <= weight.from) return 0;
  const shortfall = Math.min((weight.to - weight.from) / FULL_WEIGHT_STEP, 1.5);
  return sizePx * EMBOLDEN_RATIO * shortfall;
}

/** The pixel size a CSS shorthand asks for. */
export function fontSizeOf(cssFont: string): number {
  const match = /(\d+(?:\.\d+)?)px/.exec(cssFont);
  return match?.[1] ? Number.parseFloat(match[1]) : 14;
}
