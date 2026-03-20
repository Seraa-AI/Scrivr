import { Extension } from "../Extension";
import { TextSelection } from "prosemirror-state";
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
    const { ctx, pageNumber, lineIndexOffset } = renderCtx;
    const midY = block.y + block.height / 2;

    ctx.save();
    ctx.strokeStyle = HR_COLOR;
    ctx.lineWidth = HR_THICKNESS;
    ctx.beginPath();
    ctx.moveTo(block.x, midY);
    ctx.lineTo(block.x + block.availableWidth, midY);
    ctx.stroke();
    ctx.restore();

    // Register line in charmap (guarded) so click-to-place cursor works near the rule
    if (block.lines.length > 0 && !map.hasLine(pageNumber, lineIndexOffset)) {
      const line = block.lines[0]!;
      map.registerLine({
        page: pageNumber,
        lineIndex: lineIndexOffset,
        y: block.y,
        height: block.height,
        startDocPos: line.spans[0]?.docPos ?? 0,
        endDocPos: (line.spans[0]?.docPos ?? 0) + 1,
      });
    }

    return lineIndexOffset + block.lines.length;
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
        font: "20px Georgia, serif",   // line height determines the visual space
        spaceBefore: 10,
        spaceAfter: 10,
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
        isActive: () => false,
      },
    ];
  },

  addMarkdownRules() {
    return [
      {
        // "---" (or more dashes) on its own line → horizontal rule
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
