import type { BlockStrategy, BlockRenderContext } from "./BlockRegistry";
import type { LayoutBlock } from "./BlockLayout";
import type { CharacterMap } from "./CharacterMap";

/**
 * Phase 1 placeholder renderer for `kind: "tableRow"` blocks. Paints a
 * single bordered rectangle covering the row bounds — no cells, no text.
 * Phase 4 replaces this with full cell painting (backgrounds, borders,
 * nested cell content) consuming `block.cells`.
 */
const TABLE_ROW_BORDER_COLOR = "#9ca3af"; // neutral gray; theme colors land in Phase 4
const TABLE_ROW_BORDER_WIDTH = 1;

export const TableRowStrategy: BlockStrategy = {
  render(block: LayoutBlock, renderCtx: BlockRenderContext, _map: CharacterMap): number {
    const { ctx } = renderCtx;

    ctx.save();
    ctx.strokeStyle = TABLE_ROW_BORDER_COLOR;
    ctx.lineWidth = TABLE_ROW_BORDER_WIDTH;
    // Inset by half the stroke width so the border draws crisp on integer pixels.
    const inset = TABLE_ROW_BORDER_WIDTH / 2;
    ctx.strokeRect(
      block.x + inset,
      block.y + inset,
      block.availableWidth - TABLE_ROW_BORDER_WIDTH,
      block.height - TABLE_ROW_BORDER_WIDTH,
    );
    ctx.restore();

    // No lines or glyphs to register in Phase 1 — cells are empty. Cursor
    // hit-testing inside cells lands in Phase 4 alongside cell content.
    return renderCtx.lineIndexOffset;
  },
};
