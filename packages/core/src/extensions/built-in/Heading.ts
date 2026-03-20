import { setBlockType } from "prosemirror-commands";
import { textblockTypeInputRule } from "prosemirror-inputrules";
import { Extension } from "../Extension";
import type { ToolbarItemSpec } from "../types";
import type { BlockStyle } from "../../layout/FontConfig";
import { TextBlockStrategy } from "../../layout/TextBlockStrategy";

interface HeadingOptions {
  levels: number[];
}

export const Heading = Extension.create<HeadingOptions>({
  name: "heading",

  defaultOptions: {
    levels: [1, 2, 3, 4, 5, 6],
  },

  addNodes() {
    return {
      heading: {
        group: "block",
        content: "inline*",
        attrs: {
          level: { default: 1 },
          align: { default: "left" },
        },
        defining: true,
        parseDOM: this.options.levels.map((level) => ({
          tag: `h${level}`,
          attrs: { level },
        })),
        toDOM: (node) => [`h${node.attrs.level}`, 0],
      },
    };
  },

  addKeymap() {
    const km: Record<string, ReturnType<typeof setBlockType>> = {};
    for (const level of this.options.levels) {
      km[`Mod-Alt-${level}`] = setBlockType(this.schema.nodes["heading"]!, { level });
    }
    km["Mod-Alt-0"] = setBlockType(this.schema.nodes["paragraph"]!);
    return km;
  },

  addCommands() {
    const cmds: Record<string, () => ReturnType<typeof setBlockType>> = {};
    for (const level of this.options.levels) {
      cmds[`setHeading${level}`] = () => setBlockType(this.schema.nodes["heading"]!, { level });
    }
    cmds["setParagraph"] = () => setBlockType(this.schema.nodes["paragraph"]!);
    return cmds;
  },

  addLayoutHandlers() {
    return { heading: TextBlockStrategy };
  },

  addBlockStyles() {
    const levelStyles: Record<number, BlockStyle> = {
      1: { font: "bold 28px Georgia, serif", spaceBefore: 24, spaceAfter: 12, align: "left" as const },
      2: { font: "bold 22px Georgia, serif", spaceBefore: 20, spaceAfter: 10, align: "left" as const },
      3: { font: "bold 18px Georgia, serif", spaceBefore: 16, spaceAfter: 8,  align: "left" as const },
      4: { font: "bold 16px Georgia, serif", spaceBefore: 14, spaceAfter: 6,  align: "left" as const },
      5: { font: "bold 14px Georgia, serif", spaceBefore: 12, spaceAfter: 4,  align: "left" as const },
      6: { font: "bold 12px Georgia, serif", spaceBefore: 10, spaceAfter: 2,  align: "left" as const },
    };
    const styles: Record<string, BlockStyle> = {};
    for (const level of this.options.levels) {
      styles[`heading_${level}`] = levelStyles[level]!;
    }
    return styles;
  },

  addMarkdownRules() {
    // These back up the built-in heading handler in PasteTransformer.
    // They're intentionally not registered since PasteTransformer already handles "# "
    // natively — returning [] here avoids double-processing.
    // Custom extensions that want heading-like behaviour can use this hook instead.
    return [];
  },

  addInputRules() {
    const heading = this.schema.nodes["heading"];
    const paragraph = this.schema.nodes["paragraph"];
    if (!heading) return [];

    const rules = this.options.levels.map((level) =>
      textblockTypeInputRule(
        new RegExp(`^(#{${level}})\\s$`),
        heading,
        { level },
      )
    );

    // "# " with too many hashes (beyond configured levels) — ignore
    // "## " → h2, etc. Each rule is specific to its level count.

    // Also: typing "###### " then space in a paragraph that's already a heading
    // of a different level converts it. setBlockType handles this correctly.

    // Bonus: Mod-Alt-0 already converts heading → paragraph via keymap.
    // Input rule for "paragraph": not needed (no markdown prefix for plain text).
    void paragraph; // unused but kept for symmetry
    return rules;
  },

  addToolbarItems(): ToolbarItemSpec[] {
    const items: ToolbarItemSpec[] = this.options.levels.slice(0, 3).map((level) => ({
      command: `setHeading${level}`,
      label: `H${level}`,
      title: `Heading ${level} (⌘⌥${level})`,
      isActive: (_marks: string[], blockType: string, blockAttrs: Record<string, unknown>) =>
        blockType === "heading" && blockAttrs["level"] === level,
    }));
    items.push({
      command: "setParagraph",
      label: "¶",
      title: "Paragraph (⌘⌥0)",
      isActive: (_marks: string[], blockType: string) => blockType === "paragraph",
    });
    return items;
  },
});
