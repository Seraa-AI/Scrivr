import { Extension } from "../Extension";
import { setBlockType } from "prosemirror-commands";
import { textblockTypeInputRule } from "prosemirror-inputrules";
import { TextBlockStrategy } from "../../layout/TextBlockStrategy";
import type { Command } from "prosemirror-state";
import type { BlockStrategy, BlockRenderContext } from "../../layout/BlockRegistry";
import type { CharacterMap } from "../../layout/CharacterMap";
import type { LayoutBlock } from "../../layout/BlockLayout";

// ── CodeBlock rendering strategy ─────────────────────────────────────────────

const CODE_BG = "#f1f5f9";
const CODE_BORDER = "#e2e8f0";
const CODE_PAD = 8;

const CodeBlockStrategy: BlockStrategy = {
  render(block: LayoutBlock, renderCtx: BlockRenderContext, map: CharacterMap): number {
    const { ctx } = renderCtx;

    // Background + border
    ctx.save();
    ctx.fillStyle = CODE_BG;
    ctx.fillRect(
      block.x - CODE_PAD,
      block.y - CODE_PAD,
      block.availableWidth + CODE_PAD * 2,
      block.height + CODE_PAD * 2,
    );
    ctx.strokeStyle = CODE_BORDER;
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

export const CodeBlock = Extension.create({
  name: "codeBlock",

  addNodes() {
    return {
      codeBlock: {
        content: "text*",
        group: "block",
        code: true,
        marks: "",
        attrs: {},
        parseDOM: [{ tag: "pre", preserveWhitespace: "full" as const }],
        toDOM() { return ["pre", ["code", 0]]; },
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
    return { codeBlock: CodeBlockStrategy };
  },

  addToolbarItems() {
    return [
      {
        command: "toggleCodeBlock",
        label: "</>",
        title: "Code block (⌥⌘C)",
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
});

// Re-export strategy for use in tests / custom renderers
export { CodeBlockStrategy };
// Re-export Tab command for StarterKit chaining
export { insertCodeIndent };

