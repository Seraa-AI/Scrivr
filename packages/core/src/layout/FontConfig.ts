import { substituteFamily } from "./StyleResolver";

/**
 * FontConfig — maps block node types to their base font and spacing.
 *
 * Flat map keyed by node type name. For nodes with a `level` attribute
 * (headings), styles are keyed as `{nodeType}_{level}` — e.g. "heading_1".
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
 *
 * Heading levels use compound keys: "heading_1", "heading_2", etc.
 */
export const defaultFontConfig: FontConfig = {
  paragraph: { font: "14px", spaceBefore: 0, spaceAfter: 10, align: "left" },
  heading_1: {
    font: "bold 28px",
    spaceBefore: 24,
    spaceAfter: 12,
    align: "left",
  },
  heading_2: {
    font: "bold 22px",
    spaceBefore: 20,
    spaceAfter: 10,
    align: "left",
  },
  heading_3: {
    font: "bold 18px",
    spaceBefore: 16,
    spaceAfter: 8,
    align: "left",
  },
  heading_4: {
    font: "bold 16px",
    spaceBefore: 14,
    spaceAfter: 6,
    align: "left",
  },
  heading_5: {
    font: "bold 14px",
    spaceBefore: 12,
    spaceAfter: 4,
    align: "left",
  },
  heading_6: {
    font: "italic 14px",
    spaceBefore: 10,
    spaceAfter: 4,
    align: "left",
  },
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
