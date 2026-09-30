/**
 * The font size in effect at a position.
 *
 * The counterpart to `getActiveFontFamily`'s family resolution. A size control
 * that read the `fontSize` mark directly got `undefined` for every run without
 * one — which is most runs, since a run with no mark still renders at the block
 * style's size. The control then showed nothing over text the document plainly
 * draws at a size, and the size was not readable from outside at all:
 * `getBlockInfo()` returns the block's attrs, and `PageConfig` carries a family
 * and no size.
 */
import type { BlockStyle } from "../layout/FontConfig";

/**
 * Size a block style renders at, from its font shorthand.
 *
 * Block styles carry a CSS-ish `font` string rather than a number, so the size
 * has to be read out of it. Shared with layout so the value a control shows and
 * the value the text is drawn at come from one place.
 */
export function parseFontSizePx(font: string): number | null {
  const match = font.match(/(\d+(?:\.\d+)?)px/);
  return match ? parseFloat(match[1]!) : null;
}

/** Size used when neither a mark nor the block style names one. */
export const DEFAULT_FONT_SIZE_PX = 14;

/**
 * The size at a position: the inline mark's if it has one, otherwise the size
 * the block style renders at.
 *
 * Always a number. A control needs a value to show, and "unset" over text with
 * a visible size is the thing this exists to prevent.
 */
export function resolveActiveFontSize(
  markSize: number | undefined,
  blockStyle: BlockStyle | null | undefined,
): number {
  if (typeof markSize === "number" && markSize > 0) return markSize;
  const fromStyle = blockStyle ? parseFontSizePx(blockStyle.font) : null;
  return fromStyle ?? DEFAULT_FONT_SIZE_PX;
}
