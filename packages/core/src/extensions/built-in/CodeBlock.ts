import { Extension } from "../Extension";
import { setBlockType } from "prosemirror-commands";
import { textblockTypeInputRule } from "prosemirror-inputrules";
import { TextBlockStrategy } from "../../layout/TextBlockStrategy";
import type { Command } from "prosemirror-state";
import type { BlockStrategy, BlockRenderContext } from "../../layout/BlockRegistry";
import type { CharacterMap } from "../../layout/CharacterMap";
import type { LayoutBlock } from "../../layout/BlockLayout";
import {
  xml,
  type DocxNodeHandler,
  type DocxParagraphStyleTransform,
} from "../../exports/docx";

// ── Theme tokens — overridable via CodeBlock.configure({ theme: {...} }) ─────

interface CodeBlockTheme {
  /** Background fill behind the code block. */
  bg?: string;
  /** Border stroke around the code block. */
  border?: string;
}

interface CodeBlockOptions {
  /**
   * Per-extension theme overrides. Defaults to slate-100 / slate-200 to match
   * the canvas's light defaults; pass a `{ bg, border }` pair when configuring
   * to swap for a dark-mode palette. Values are literal CSS color strings
   * (the canvas resolver does not run on per-extension themes).
   *
   * @example
   * CodeBlock.configure({ theme: { bg: "#1e293b", border: "#334155" } })
   */
  theme?: CodeBlockTheme;
}

const DEFAULT_CODE_BG = "#f1f5f9";
const DEFAULT_CODE_BORDER = "#e2e8f0";
const CODE_PAD = 8;

function createCodeBlockStrategy(theme: CodeBlockTheme): BlockStrategy {
  const bg = theme.bg ?? DEFAULT_CODE_BG;
  const border = theme.border ?? DEFAULT_CODE_BORDER;
  return {
    render(block: LayoutBlock, renderCtx: BlockRenderContext, map: CharacterMap): number {
      const { ctx } = renderCtx;

      // Background + border
      ctx.save();
      ctx.fillStyle = bg;
      ctx.fillRect(
        block.x - CODE_PAD,
        block.y - CODE_PAD,
        block.availableWidth + CODE_PAD * 2,
        block.height + CODE_PAD * 2,
      );
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.strokeRect(
        block.x - CODE_PAD,
        block.y - CODE_PAD,
        block.availableWidth + CODE_PAD * 2,
        block.height + CODE_PAD * 2,
      );
      ctx.restore();

      // Delegate text rendering (handles charmap, marks, etc.)
      return TextBlockStrategy.render(block, renderCtx, map);
    },
  };
}

const CodeBlockStrategy: BlockStrategy = createCodeBlockStrategy({});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Inserts two spaces at the cursor when inside a codeBlock. Returns false otherwise. */
function insertCodeIndent(): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;
    for (let d = $from.depth; d >= 0; d--) {
      if ($from.node(d).type.name === "codeBlock") {
        if (dispatch) dispatch(state.tr.insertText("  "));
        return true;
      }
    }
    return false;
  };
}

/** Toggles between codeBlock and paragraph for the current block. */
function makeToggleCodeBlock(): Command {
  return (state, dispatch, view) => {
    const codeBlock = state.schema.nodes["codeBlock"];
    const paragraph = state.schema.nodes["paragraph"];
    if (!codeBlock || !paragraph) return false;
    const isCode = state.selection.$from.parent.type === codeBlock;
    return isCode
      ? setBlockType(paragraph)(state, dispatch, view)
      : setBlockType(codeBlock)(state, dispatch, view);
  };
}

// ── Extension ─────────────────────────────────────────────────────────────────

export const CodeBlock = Extension.create<CodeBlockOptions>({
  name: "codeBlock",

  defaultOptions: {
    theme: {},
  },

  addNodes() {
    return {
      codeBlock: {
        content: "text*",
        group: "block",
        code: true,
        marks: "",
        attrs: {
          nodeId:      { default: null },
          dataTracked: { default: [] },
        },
        parseDOM: [{
          tag: "pre",
          preserveWhitespace: "full" as const,
          getAttrs(dom) {
            return { nodeId: (dom as HTMLElement).getAttribute("data-node-id") ?? null };
          },
        }],
        toDOM(node) {
          const attrs: Record<string, string> = {};
          if (node.attrs.nodeId) attrs["data-node-id"] = node.attrs.nodeId as string;
          return ["pre", attrs, ["code", 0]];
        },
      },
    };
  },

  addKeymap() {
    return {
      // Tab inserts spaces inside code blocks; falls through for list Tab chaining in StarterKit
      Tab: insertCodeIndent(),
      "Mod-Alt-c": makeToggleCodeBlock(),
    };
  },

  addCommands() {
    return {
      toggleCodeBlock: () => makeToggleCodeBlock(),
    };
  },

  addBlockStyles() {
    return {
      codeBlock: {
        font: "13px 'Courier New', Courier, monospace",
        spaceBefore: 14,
        spaceAfter: 14,
        align: "left" as const,
      },
    };
  },

  addLayoutHandlers() {
    return { codeBlock: createCodeBlockStrategy(this.options.theme ?? {}) };
  },

  addExports() {
    const handler: DocxNodeHandler = (_node, children, ctx) => {
      const styleId = ctx.styles.paragraph.getOrCreate("Code Block", {
        font: "Courier New",
        size: 13,
      });
      return xml("w:p", undefined, [
        xml("w:pPr", undefined, [xml("w:pStyle", { "w:val": styleId })]),
        ...children,
      ]);
    };
    return { docx: { nodes: { codeBlock: handler } } };
  },

  addImports() {
    // Exporter writes the "Code Block" paragraph style (sanitized to
    // "CodeBlock"). Import flips that back: paragraph with that pStyle →
    // codeBlock node. CodeBlock's schema is content="text*" with marks="",
    // so we flatten any marked text children to a single text run and
    // turn hard breaks into literal newlines.
    const importer: DocxParagraphStyleTransform = (_block, content, ctx) => {
      const t = ctx.schema.nodes["codeBlock"];
      if (!t) return null;
      const pieces: string[] = [];
      for (const child of content) {
        if (child.isText) {
          pieces.push(child.text ?? "");
        } else if (child.type.name === "hardBreak") {
          pieces.push("\n");
        }
      }
      const text = pieces.join("");
      return text.length > 0 ? t.create(null, ctx.schema.text(text)) : t.create();
    };
    return { docx: { paragraphStyles: { CodeBlock: importer } } };
  },

  addToolbarItems() {
    return [
      {
        command: "toggleCodeBlock",
        label: "</>",
        title: "Code block (⌥⌘C)",
        group: "insert",
        isActive: (_marks: string[], blockType: string) => blockType === "codeBlock",
      },
    ];
  },

  addInputRules() {
    const codeBlock = this.schema.nodes["codeBlock"];
    if (!codeBlock) return [];
    // Typing "```" at the start of a block converts it to a code block
    return [textblockTypeInputRule(/^```$/, codeBlock)];
  },

  addMarkdownParserTokens() {
    return {
      code_block: { block: "codeBlock", noCloseToken: true },
      fence: { block: "codeBlock", noCloseToken: true },
    };
  },

  addMarkdownSerializerRules() {
    return {
      nodes: {
        codeBlock(state, node) {
          state.write("```\n");
          state.text(node.textContent, false);
          state.ensureNewLine();
          state.write("```");
          state.closeBlock(node);
        },
      },
    };
  },
});

// Re-export strategy for use in tests / custom renderers
export { CodeBlockStrategy, createCodeBlockStrategy };
export type { CodeBlockOptions, CodeBlockTheme };
// Re-export Tab command for StarterKit chaining
export { insertCodeIndent };

declare module "@scrivr/core" {
  interface Commands<ReturnType> {
    codeBlock: {
      /** Toggle a code block at the current block. */
      toggleCodeBlock: () => ReturnType;
    };
  }
}

