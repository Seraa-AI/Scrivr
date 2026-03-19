/**
 * FontConfig — maps block node types to their base font and spacing.
 *
 * This is the single source of truth for typography in the editor.
 * Every value here is in CSS pixels.
 *
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

export interface FontConfig {
  paragraph: BlockStyle;
  heading: Record<number, BlockStyle>; // keyed by heading level 1–6
  bullet_list: BlockStyle;
  ordered_list: BlockStyle;
  list_item: BlockStyle;
  [key: string]: BlockStyle | Record<number, BlockStyle>;
}

/**
 * Default font config — A4 legal document, Georgia body text.
 *
 * Spacing follows the rule: headings have generous space before,
 * paragraphs have modest space after. Margin collapsing in PageLayout
 * means adjacent identical blocks don't double-space.
 */
export const defaultFontConfig: FontConfig = {
  paragraph: {
    font: "14px Georgia, serif",
    spaceBefore: 0,
    spaceAfter: 10,
    align: "left",
  },
  heading: {
    1: { font: "bold 28px Georgia, serif", spaceBefore: 24, spaceAfter: 12, align: "left" },
    2: { font: "bold 22px Georgia, serif", spaceBefore: 20, spaceAfter: 10, align: "left" },
    3: { font: "bold 18px Georgia, serif", spaceBefore: 16, spaceAfter: 8,  align: "left" },
    4: { font: "bold 16px Georgia, serif", spaceBefore: 14, spaceAfter: 6,  align: "left" },
    5: { font: "bold 14px Georgia, serif", spaceBefore: 12, spaceAfter: 4,  align: "left" },
    6: { font: "italic 14px Georgia, serif", spaceBefore: 10, spaceAfter: 4, align: "left" },
  },
  bullet_list:  { font: "14px Georgia, serif", spaceBefore: 4,  spaceAfter: 4,  align: "left" },
  ordered_list: { font: "14px Georgia, serif", spaceBefore: 4,  spaceAfter: 4,  align: "left" },
  list_item:    { font: "14px Georgia, serif", spaceBefore: 2,  spaceAfter: 2,  align: "left" },
};

/**
 * Resolves the BlockStyle for a given node type name and optional level.
 * Falls back to paragraph style for unknown node types.
 */
export function getBlockStyle(
  config: FontConfig,
  nodeTypeName: string,
  level?: number
): BlockStyle {
  if (nodeTypeName === "heading" && level != null) {
    return (config.heading as Record<number, BlockStyle>)[level] ?? config.paragraph;
  }

  const style = config[nodeTypeName];
  if (!style) return config.paragraph;
  if ("font" in style) return style as BlockStyle;
  return config.paragraph;
}
