import { Extension } from "../Extension";
import type { Command } from "prosemirror-state";
import { InputRule } from "prosemirror-inputrules";
import type { BlockStrategy, BlockRenderContext } from "../../layout/BlockRegistry";
import type { CharacterMap } from "../../layout/CharacterMap";
import type { LayoutBlock } from "../../layout/BlockLayout";

// ── HorizontalRule rendering strategy ────────────────────────────────────────

const HR_COLOR = "#cbd5e1";
const HR_THICKNESS = 1.5;

const HorizontalRuleStrategy: BlockStrategy = {
  render(block: LayoutBlock, renderCtx: BlockRenderContext, map: CharacterMap): number {
    const { ctx, lineIndexOffset } = renderCtx;
    const midY = block.y + block.height / 2;

    ctx.save();
    ctx.strokeStyle = HR_COLOR;
    ctx.lineWidth = HR_THICKNESS;
    ctx.beginPath();
    ctx.moveTo(block.x, midY);
    ctx.lineTo(block.x + block.availableWidth, midY);
    ctx.stroke();
    ctx.restore();

    // Charmap registration is handled by layoutLeafBlock — nothing to do here.
    return lineIndexOffset + 1;
  },
};

// ── Insert command ────────────────────────────────────────────────────────────

function insertHorizontalRule(): Command {
  return (state, dispatch) => {
    const { $head } = state.selection;
    const hr = state.schema.nodes["horizontalRule"];
    if (!hr) return false;

    // Insert the HR node after the current top-level block
    const after = $head.after(1);
    if (dispatch) {
      const tr = state.tr.insert(after, hr.create()).scrollIntoView();
      dispatch(tr);
    }
    return true;
  };
}

// ── Extension ─────────────────────────────────────────────────────────────────

export const HorizontalRule = Extension.create({
  name: "horizontalRule",

  addNodes() {
    return {
      horizontalRule: {
        group: "block",
        parseDOM: [{ tag: "hr" }],
        toDOM() { return ["hr"]; },
      },
    };
  },

  addCommands() {
    return {
      insertHorizontalRule: () => insertHorizontalRule(),
    };
  },

  addBlockStyles() {
    return {
      horizontalRule: {
        font: "8px Georgia, serif",  // keep block height tight; only the rule line is drawn
        spaceBefore: 24,
        spaceAfter: 24,
        align: "left" as const,
      },
    };
  },

  addLayoutHandlers() {
    return { horizontalRule: HorizontalRuleStrategy };
  },

  addToolbarItems() {
    return [
      {
        command: "insertHorizontalRule",
        label: "—",
        title: "Horizontal rule",
        group: "insert",
        isActive: () => false,
      },
    ];
  },

  addMarkdownParserTokens() {
    return { hr: { node: "horizontalRule" } };
  },

  addMarkdownSerializerRules() {
    return {
      nodes: {
        horizontalRule(state, node) {
          state.write("---");
          state.closeBlock(node);
        },
      },
    };
  },

  addMarkdownRules() {
    return [
      {
        // "---" (or more dashes) on its own line → horizontal rule (legacy paste fallback)
        pattern: /^-{3,}$/,
        createNode(_match, schema) {
          return schema.nodes["horizontalRule"]?.create() ?? null;
        },
      },
    ];
  },

  addInputRules() {
    const hr = this.schema.nodes["horizontalRule"];
    const paragraph = this.schema.nodes["paragraph"];
    if (!hr) return [];

    // Typing "--- " (three dashes + space) in an empty paragraph inserts an HR
    return [
      new InputRule(/^---\s$/, (state, _match, start) => {
        const $from = state.doc.resolve(start);
        const blockStart = $from.before($from.depth);
        const blockEnd = $from.after($from.depth);
        const replacement = paragraph
          ? [hr.create(), paragraph.create()]
          : [hr.create()];
        return state.tr.replaceWith(blockStart, blockEnd, replacement);
      }),
    ];
  },
});
