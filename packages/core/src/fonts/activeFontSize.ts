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
import { defaultFontConfig, type BlockStyle } from "../layout/FontConfig";

/**
 * Size a block style renders at, from its font shorthand.
 *
 * Block styles carry a CSS-ish `font` string rather than a number, so the size
 * has to be read out of it. Shared with layout so the value a control shows and
 * the value the text is drawn at come from one place.
 */
export function parseFontSizePx(font: string): number | null {
  const [, size] = font.match(/(\d+(?:\.\d+)?)px/) ?? [];
  return size === undefined ? null : parseFloat(size);
}

/**
 * Size used when neither a mark nor the block style names one — read from the
 * default paragraph style, because that is what such a run is actually drawn at.
 * Derived rather than restated so the two cannot drift.
 */
export const DEFAULT_FONT_SIZE_PX =
  parseFontSizePx(defaultFontConfig["paragraph"]?.font ?? "") ?? 14;

/**
 * The size at a position: the inline mark's if it has one, otherwise the size
 * the block style renders at. Always a number — a control needs a value to show.
 *
 * A non-positive mark size is treated as absent: `fontSize` carries a px number,
 * and zero is not a size a run renders at.
 */
export function resolveActiveFontSize(markSize: number | undefined, blockStyle: BlockStyle): number {
  if (typeof markSize === "number" && markSize > 0) return markSize;
  return parseFontSizePx(blockStyle.font) ?? DEFAULT_FONT_SIZE_PX;
}
