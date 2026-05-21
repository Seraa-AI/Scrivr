import { setBlockType } from "prosemirror-commands";
import { textblockTypeInputRule } from "prosemirror-inputrules";
import { Extension } from "../Extension";
import type { ToolbarItemSpec } from "../types";
import type { BlockStyle } from "../../layout/FontConfig";
import { TextBlockStrategy } from "../../layout/TextBlockStrategy";
import { headingDocxContribution } from "./Heading.docx";

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

interface HeadingOptions {
  levels: HeadingLevel[];
}

/**
 * Canonical per-level heading spec — single source of truth.
 *
 * `addBlockStyles()` derives canvas `BlockStyle`s from this (px values used
 * directly), and `Heading.docx.ts` reads the same record to emit DOCX
 * paragraph styles with the same intent (px values converted to twips at
 * the format boundary, not duplicated here).
 *
 * All values in pixels; the docx layer converts (1px @ 96 DPI = 15 twips).
 */
export interface HeadingLevelSpec {
  /** Font size in px. */
  size: number;
  /** Space before the paragraph in px. */
  spaceBefore: number;
  /** Space after the paragraph in px. */
  spaceAfter: number;
}

export const HEADING_LEVEL_SPEC: Record<number, HeadingLevelSpec> = {
  1: { size: 28, spaceBefore: 24, spaceAfter: 12 },
  2: { size: 22, spaceBefore: 20, spaceAfter: 10 },
  3: { size: 18, spaceBefore: 16, spaceAfter: 8 },
  4: { size: 16, spaceBefore: 14, spaceAfter: 6 },
  5: { size: 14, spaceBefore: 12, spaceAfter: 4 },
  6: { size: 12, spaceBefore: 10, spaceAfter: 2 },
};

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
          level:       { default: 1 },
          align:       { default: "left" },
          indent:      { default: 0 },
          textIndent:  { default: 0 },
          fontFamily:  { default: null },
          nodeId:      { default: null },
          dataTracked: { default: [] },
        },
        defining: true,
        parseDOM: this.options.levels.map((level) => ({
          tag: `h${level}`,
          getAttrs(dom) {
            const el = dom as HTMLElement;
            const rawFamily = el.style.fontFamily;
            const fontFamily = rawFamily
              ? (rawFamily.replace(/['"]/g, "").split(",")[0] ?? "").trim() || null
              : null;
            const rawMarginLeft = parseFloat(el.style.marginLeft) || 0;
            const rawTextIndent = parseFloat(el.style.textIndent) || 0;
            return {
              level,
              align:      el.style.textAlign || "left",
              indent:     rawMarginLeft > 0 ? Math.round(rawMarginLeft / 24) : 0,
              textIndent: rawTextIndent > 0 ? rawTextIndent : 0,
              fontFamily: fontFamily,
              nodeId:     el.getAttribute("data-node-id") ?? null,
            };
          },
        })),
        toDOM: (node) => {
          const styles: string[] = [];
          if (node.attrs.align && node.attrs.align !== "left") styles.push(`text-align:${node.attrs.align as string}`);
          if (node.attrs.indent) styles.push(`margin-left:${(node.attrs.indent as number) * 24}px`);
          if (node.attrs.textIndent) styles.push(`text-indent:${node.attrs.textIndent as number}px`);
          if (node.attrs.fontFamily) styles.push(`font-family:${node.attrs.fontFamily as string}`);
          const attrs: Record<string, string> = {};
          if (styles.length) attrs["style"] = styles.join(";");
          if (node.attrs.nodeId) attrs["data-node-id"] = node.attrs.nodeId as string;
          return [`h${node.attrs.level as number}`, attrs, 0];
        },
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
    const styles: Record<string, BlockStyle> = {};
    for (const level of this.options.levels) {
      const spec = HEADING_LEVEL_SPEC[level]!;
      styles[`heading_${level}`] = {
        font: `bold ${spec.size}px`,
        spaceBefore: spec.spaceBefore,
        spaceAfter: spec.spaceAfter,
        align: "left" as const,
      };
    }
    return styles;
  },

  addExports() {
    // DOCX contribution lives next to the extension — see Heading.docx.ts.
    // Reads HEADING_LEVEL_SPEC so canvas and DOCX render with the same
    // intent; the docx layer converts px → twips at its boundary.
    return { docx: headingDocxContribution(this.options.levels) };
  },

  addMarkdownParserTokens() {
    return {
      heading: {
        block: "heading",
        getAttrs: (tok) => ({ level: +tok.tag.slice(1) }),
      },
    };
  },

  addMarkdownSerializerRules() {
    return {
      nodes: {
        heading(state, node) {
          state.write("#".repeat(node.attrs["level"] as number) + " ");
          state.renderInline(node);
          state.closeBlock(node);
        },
      },
    };
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
      group: "heading",
      isActive: (_marks: string[], blockType: string, blockAttrs: Record<string, unknown>) =>
        blockType === "heading" && blockAttrs["level"] === level,
    }));
    items.push({
      command: "setParagraph",
      label: "¶",
      title: "Paragraph (⌘⌥0)",
      group: "heading",
      isActive: (_marks: string[], blockType: string) => blockType === "paragraph",
    });
    return items;
  },
});

declare module "@scrivr/core" {
  interface Commands<ReturnType> {
    heading: {
      [K in 1 | 2 | 3 | 4 | 5 | 6 as `setHeading${K}`]: () => ReturnType;
    } & {
      /** Set the current block to a plain paragraph. */
      setParagraph: () => ReturnType;
    };
  }

  interface NodeAttributes {
    heading: {
      /** Heading level 1–6. */
      level: number;
      /** Text alignment override. */
      align?: "left" | "center" | "right" | "justify";
      /** Font family override. */
      fontFamily?: string | null;
    };
  }
}
