import type { Attrs, Node, NodeType } from "prosemirror-model";
import type { Command, EditorState } from "prosemirror-state";
import type { PdfNodeHandler } from "../../exports/pdf";
import { textblockTypeInputRule } from "prosemirror-inputrules";
import { Extension } from "../Extension";
import { blockStyleAttrs } from "./blockStyleAttrs";
import { INDENT_STEP } from "./Indent";
import type {
  SlashCommandContribution,
  SlashCommandSpec,
  ToolbarItemSpec,
} from "../types";
import type { BlockStyle } from "../../layout/FontConfig";
import { TextBlockStrategy } from "../../layout/TextBlockStrategy";
import {
  xml,
  pxToTwips,
  type DocxNodeHandler,
  type DocxParagraphStyleTransform,
  type XmlNode,
} from "../../exports/docx";
import type { SemanticNodeHandler } from "../../exports/semantic";
import { alignToJc, reportUnwrittenTextblockAttrs } from "./Paragraph";

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

interface HeadingOptions {
  levels: HeadingLevel[];
}

/**
 * Canonical per-level heading spec — single source of truth.
 *
 * `addBlockStyles()` derives canvas `BlockStyle`s from this (px values used
 * directly), and `addExports()` reads the same record to emit DOCX paragraph
 * styles with the same intent (px values converted to twips at the format
 * boundary, not duplicated here).
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

/**
 * A heading's own level, so one deeper than the configured `levels` still
 * nests in order; a level stored as text reads as the number it spells.
 */
function headingOutlineLevel(node: Node): number {
  const raw = node.attrs["level"];
  const level = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  return typeof level === "number" && Number.isFinite(level) ? level : 1;
}

const headingPdf: PdfNodeHandler = (block, ctx) => ctx.draw.lines(block, ctx);

export const Heading = Extension.create<HeadingOptions>({
  name: "heading",

  defaultOptions: {
    levels: [1, 2, 3, 4, 5, 6],
  },

  addNodes() {
    return {
      heading: {
        group: "block listItemLead",
        content: "inline*",
        attrs: {
          level: { default: 1 },
          align: { default: "left" },
          indent: { default: 0 },
          textIndent: { default: 0 },
          fontFamily: { default: null },
          nodeId: { default: null },
          dataTracked: { default: [] },
        },
        defining: true,
        outlineLevel: headingOutlineLevel,
        parseDOM: this.options.levels.map((level) => ({
          tag: `h${level}`,
          getAttrs: (el) => ({ level, ...blockStyleAttrs(el) }),
        })),
        toDOM: (node) => {
          const styles: string[] = [];
          if (node.attrs.align && node.attrs.align !== "left")
            styles.push(`text-align:${node.attrs.align as string}`);
          if (node.attrs.indent)
            styles.push(`margin-left:${(node.attrs.indent as number) * INDENT_STEP}px`);
          if (node.attrs.textIndent)
            styles.push(`text-indent:${node.attrs.textIndent as number}px`);
          if (node.attrs.fontFamily)
            styles.push(`font-family:${node.attrs.fontFamily as string}`);
          const attrs: Record<string, string> = {};
          if (styles.length) attrs["style"] = styles.join(";");
          if (node.attrs.nodeId)
            attrs["data-node-id"] = node.attrs.nodeId as string;
          return [`h${node.attrs.level as number}`, attrs, 0];
        },
      },
    };
  },

  addKeymap() {
    const km: Record<string, Command> = {};
    for (const level of this.options.levels) {
      km[`Mod-Alt-${level}`] = setTextblock(this.schema.nodes["heading"]!, { level });
    }
    km["Mod-Alt-0"] = setTextblock(this.schema.nodes["paragraph"]!, {});
    return km;
  },

  addCommands() {
    const heading = this.schema.nodes["heading"]!;
    const paragraph = this.schema.nodes["paragraph"]!;
    const { levels } = this.options;
    return {
      setHeading: (attrs: unknown): Command => (state, dispatch) => {
        const level = configuredLevel(attrs, levels);
        return level !== null && setTextblock(heading, { level })(state, dispatch);
      },
      toggleHeading: (attrs: unknown): Command => (state, dispatch) => {
        const level = configuredLevel(attrs, levels);
        if (level === null) return false;
        return everyBlockIsHeading(state, heading, level)
          ? setTextblock(paragraph, {})(state, dispatch)
          : setTextblock(heading, { level })(state, dispatch);
      },
      setParagraph: (): Command => setTextblock(paragraph, {}),
    };
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
    // Reads HEADING_LEVEL_SPEC so canvas + DOCX render with the same intent
    // — px values converted to twips here at the format boundary, never
    // duplicated. The walker calls this handler per heading node; the
    // style is registered once per level via getOrCreate.
    const levels = this.options.levels;
    const readLevel = (raw: unknown): HeadingLevel => {
      if (typeof raw === "number") {
        const lvl = raw as HeadingLevel;
        if (levels.includes(lvl)) return lvl;
      }
      return levels[0] ?? 1;
    };
    const headingHandler: DocxNodeHandler = (node, children, ctx) => {
      reportUnwrittenTextblockAttrs(node, ctx);
      const level = readLevel(node.attrs["level"]);
      const spec = HEADING_LEVEL_SPEC[level];
      const styleId = ctx.styles.paragraph.getOrCreate(`Heading ${level}`, {
        bold: true,
        size: spec?.size ?? 14,
        spacingBefore: spec ? pxToTwips(spec.spaceBefore) : 0,
        spacingAfter: spec ? pxToTwips(spec.spaceAfter) : 0,
      });
      const pPr: XmlNode[] = [xml("w:pStyle", { "w:val": styleId })];
      const jc = alignToJc(node.attrs["align"]);
      if (jc) pPr.push(xml("w:jc", { "w:val": jc }));
      return xml("w:p", undefined, [xml("w:pPr", undefined, pPr), ...children]);
    };
    const semanticHandler: SemanticNodeHandler = () => ({ type: "heading" });
    return {
      docx: { nodes: { heading: headingHandler } },
      semantic: { nodes: { heading: semanticHandler } },
      pdf: { nodes: { heading: headingPdf } },
    };
  },

  addImports() {
    // OOXML emits `<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>` (sanitized
    // form of "Heading 1"). The paragraphStyle dispatch in the import
    // pipeline runs BEFORE the default paragraph handler, so this catches
    // every paragraph carrying a heading style and produces a heading
    // node with the right level. Single source of truth: same
    // `Heading ${level}` style name the exporter emits.
    const levels = this.options.levels;
    const handlers: Record<string, DocxParagraphStyleTransform> = {};
    for (const level of levels) {
      // Match both `Heading1` (sanitized — what we emit) and `Heading ${level}`
      // (Word's friendly name) just in case the source authored both forms.
      const make: DocxParagraphStyleTransform = (block, content, ctx) => {
        const t = ctx.schema.nodes["heading"];
        if (!t) return null;
        const attrs: Record<string, unknown> = { level };
        if (block.attrs.align && block.attrs.align !== "left") {
          attrs.align = block.attrs.align;
        }
        return t.create(attrs, content);
      };
      handlers[`Heading${level}`] = make;
      handlers[`heading${level}`] = make;
    }
    return { docx: { paragraphStyles: handlers } };
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

  addInputRules() {
    const heading = this.schema.nodes["heading"];
    const paragraph = this.schema.nodes["paragraph"];
    if (!heading) return [];

    const rules = this.options.levels.map((level) =>
      textblockTypeInputRule(new RegExp(`^(#{${level}})\\s$`), heading, {
        level,
      }),
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
    const items: ToolbarItemSpec[] = this.options.levels
      .slice(0, 3)
      .map((level): ToolbarItemSpec => ({
        command: "setHeading",
        args: [{ level }],
        label: `H${level}`,
        title: `Heading ${level} (⌘⌥${level})`,
        group: "heading",
        isActive: ({ blockType, blockAttrs }) => blockType === "heading" && blockAttrs["level"] === level,
      }));
    items.push({
      command: "setParagraph",
      label: "¶",
      title: "Paragraph (⌘⌥0)",
      group: "heading",
      isActive: ({ blockType }) => blockType === "paragraph",
    });
    return items;
  },

  addSlashCommands(): SlashCommandContribution[] {
    return [{
      items: [
        {
          id: "heading.paragraph",
          label: "Text",
          description: "Plain paragraph",
          group: "blocks",
          order: 10,
          command: "setParagraph",
        },
        // Driven by the configured levels, like the toolbar items: a kit built
        // with fewer headings should not offer entries it cannot honour.
        ...this.options.levels.slice(0, 3).map((level, i): SlashCommandSpec => ({
          id: `heading.${level}`,
          label: `Heading ${level}`,
          description: HEADING_DESCRIPTIONS[level] ?? `Level ${level} heading`,
          group: "blocks",
          order: 20 + i * 10,
          command: "setHeading",
          args: [{ level }],
        })),
      ],
    }];
  },
});

/**
 * The level a caller asked for, when the editor was configured with it.
 *
 * A toolbar or slash spec carries its args untyped, so a missing or malformed
 * level refuses like an unconfigured one: a kit built with fewer levels has no
 * style for the rest.
 */
function configuredLevel(attrs: unknown, levels: readonly HeadingLevel[]): HeadingLevel | null {
  if (typeof attrs !== "object" || attrs === null || !("level" in attrs)) return null;
  return levels.find((level) => level === attrs.level) ?? null;
}

/**
 * Turns the selected textblocks into `type` with `attrs`, keeping what else
 * they carry that `type` has too: alignment, indent, id.
 */
function setTextblock(type: NodeType, attrs: Attrs): Command {
  return (state, dispatch) => {
    const tr = state.tr;
    for (const { from, to } of headingSpans(state)) {
      tr.setBlockType(tr.mapping.map(from), tr.mapping.map(to), type, (node) => ({ ...node.attrs, ...attrs }));
    }
    if (!tr.docChanged) return false;
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

/**
 * The selected ranges, less the empty paragraph a document ends in when a
 * range covers more than it. Select All takes in the one TrailingNode keeps
 * after a closing heading, and restyling it would make TrailingNode add
 * another, one more for every press.
 */
function headingSpans(state: EditorState): { from: number; to: number }[] {
  const { doc } = state;
  const last = doc.lastChild;
  const lastStart = doc.content.size - (last?.nodeSize ?? 0);
  const endsEmpty = last !== null && last.type.name === "paragraph" && last.content.size === 0;
  return state.selection.ranges.map(({ $from, $to }) => ({
    from: $from.pos,
    to: endsEmpty && $from.pos < lastStart && $to.pos > lastStart ? lastStart : $to.pos,
  }));
}

/**
 * Whether every textblock the heading commands would change already is a
 * heading of `level`. One that is not means a toggle sets the heading on all of them, as
 * Word does when a style meets a mixed selection.
 */
function everyBlockIsHeading(state: EditorState, heading: NodeType, level: HeadingLevel): boolean {
  let touched = false;
  let every = true;
  for (const { from, to } of headingSpans(state)) {
    state.doc.nodesBetween(from, to, (node) => {
      if (!node.isTextblock) return true;
      touched = true;
      // An imported heading can carry its level as text.
      if (node.type !== heading || Number(node.attrs["level"]) !== level) every = false;
      return false;
    });
  }
  return touched && every;
}

/** Relative size, which is what a reader picking a heading is choosing between. */
const HEADING_DESCRIPTIONS: Record<number, string> = {
  1: "Large section title",
  2: "Medium section title",
  3: "Small section title",
};

declare module "@scrivr/core" {
  interface Commands<ReturnType> {
    heading: {
      /** Set the current block to a heading of `level`. False for a level the editor was not configured with. */
      setHeading: (attrs: { level: HeadingLevel }) => ReturnType;
      /** Set the selected blocks to a heading of `level`, or back to paragraphs when every one already is a heading of that level. False for a level the editor was not configured with. */
      toggleHeading: (attrs: { level: HeadingLevel }) => ReturnType;
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
