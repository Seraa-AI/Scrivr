import type { Node } from "prosemirror-model";
import { substituteFamily } from "./StyleResolver";

/**
 * FontConfig — maps block node types to their base font and spacing.
 *
 * Flat map keyed by node type name. For nodes with a `level` attribute,
 * styles are keyed as `{nodeType}_{level}`.
 * getBlockStyle() handles the compound key lookup automatically.
 *
 * Extensions contribute their own block styles via addBlockStyles().
 * PageLayout reads spaceBefore/spaceAfter for margin collapsing.
 * StyleResolver reads font as the base for mark resolution.
 */

export interface BlockStyle {
  /** Base CSS font string — StyleResolver applies marks on top of this */
  font: string;
  /** Space above the block in px — PageLayout collapses adjacent margins */
  spaceBefore: number;
  /** Space below the block in px */
  spaceAfter: number;
  /** Text alignment */
  align: "left" | "center" | "right" | "justify";
}

/** Flat map from node type key to BlockStyle. */
export type FontConfig = Record<string, BlockStyle>;

/**
 * Document-level font family fallback.
 * Applied by runPipeline when PageConfig.fontFamily is not set.
 * Extensions and defaultFontConfig intentionally omit the family — it is
 * always injected at pipeline time so there is a single place to change it.
 */
export const DEFAULT_FONT_FAMILY = "Arial, sans-serif";

/**
 * Default font config.
 * Font strings contain only size/weight/style — NO family.
 * The family is injected at layout time via applyPageFont(config, pageConfig.fontFamily ?? DEFAULT_FONT_FAMILY).
 * Every other block's style comes from its extension (`addBlockStyles`).
 */
export const defaultFontConfig: FontConfig = {
  paragraph: { font: "14px", spaceBefore: 0, spaceAfter: 10, align: "left" },
};

/**
 * Resolves the BlockStyle for a ProseMirror node type.
 *
 * Lookup order:
 *   1. Compound key — "{nodeTypeName}_{level}" (for headed block types)
 *   2. Base name    — "{nodeTypeName}"
 *   3. Paragraph fallback
 */
export function getBlockStyle(
  config: FontConfig,
  nodeTypeName: string,
  level?: number,
): BlockStyle {
  if (level != null) {
    const keyed = config[`${nodeTypeName}_${level}`];
    if (keyed) return keyed;
  }
  return (
    config[nodeTypeName] ??
    config["paragraph"] ?? {
      font: "14px",
      spaceBefore: 0,
      spaceAfter: 10,
      align: "left" as const,
    }
  );
}

/**
 * The font a block's unmarked text is drawn in: its style's, with the block's
 * own `fontFamily` attr in place of the style's family when it names one.
 */
export function blockFontOf(node: Node, config: FontConfig): string {
  const level = node.attrs["level"];
  const style = getBlockStyle(config, node.type.name, typeof level === "number" ? level : undefined);
  const family = node.attrs["fontFamily"];
  return typeof family === "string" && family.length > 0 ? substituteFamily(style.font, family) : style.font;
}

/**
 * Returns a new FontConfig with the font family in every block style replaced
 * by `fontFamily`. Sizes, weights, and spacing are unchanged.
 *
 * Used by layoutDocument to apply the document-level font from PageConfig.
 */
export function applyPageFont(
  config: FontConfig,
  fontFamily: string,
): FontConfig {
  const result: FontConfig = {};
  for (const [key, style] of Object.entries(config)) {
    result[key] = { ...style, font: substituteFamily(style.font, fontFamily) };
  }
  return result;
}
