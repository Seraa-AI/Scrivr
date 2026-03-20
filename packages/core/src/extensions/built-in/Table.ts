import { TextSelection } from "prosemirror-state";
import type { Command } from "prosemirror-state";
import type { Node, NodeType } from "prosemirror-model";
import { Extension } from "../Extension";
import type { BlockStrategy, BlockRenderContext } from "../../layout/BlockRegistry";
import type { CharacterMap } from "../../layout/CharacterMap";
import type { LayoutBlock } from "../../layout/BlockLayout";
import { TextBlockStrategy } from "../../layout/TextBlockStrategy";

const BORDER = 1;
const BORDER_COLOR = "#cbd5e1";

// ── Render strategy ───────────────────────────────────────────────────────────

export const TableBlockStrategy: BlockStrategy = {
  render(block: LayoutBlock, renderCtx: BlockRenderContext, map: CharacterMap): number {
    const { tableData } = block;
    if (!tableData) return renderCtx.lineIndexOffset;

    const { ctx } = renderCtx;
    const { cells, numRows, numCols, colWidths, rowHeights } = tableData;

    ctx.save();
    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth = BORDER;

    // ── Outer border ──────────────────────────────────────────────────────────
    ctx.strokeRect(
      block.x + BORDER / 2,
      block.y + BORDER / 2,
      block.availableWidth - BORDER,
      block.height - BORDER,
    );

    // ── Internal grid lines ───────────────────────────────────────────────────
    ctx.beginPath();

    // Column separators
    let colX = block.x;
    for (let c = 0; c < numCols - 1; c++) {
      colX += BORDER + colWidths[c]!;
      ctx.moveTo(colX + BORDER / 2, block.y);
      ctx.lineTo(colX + BORDER / 2, block.y + block.height);
    }

    // Row separators
    let rowY = block.y;
    for (let r = 0; r < numRows - 1; r++) {
      rowY += BORDER + rowHeights[r]!;
      ctx.moveTo(block.x, rowY + BORDER / 2);
      ctx.lineTo(block.x + block.availableWidth, rowY + BORDER / 2);
    }

    ctx.stroke();
    ctx.restore();

    // ── Cell content ──────────────────────────────────────────────────────────
    let lineIndexOffset = renderCtx.lineIndexOffset;
    for (const cell of cells) {
      for (const contentBlock of cell.contentBlocks) {
        lineIndexOffset = TextBlockStrategy.render(
          contentBlock,
          { ...renderCtx, lineIndexOffset },
          map,
        );
      }
    }

    return lineIndexOffset;
  },
};

// ── Commands ──────────────────────────────────────────────────────────────────

/** Inserts a rows×cols table after the current block. */
function insertTable(rows: number, cols: number): Command {
  return (state, dispatch) => {
    const { schema, selection } = state;
    const tableType = schema.nodes["table"];
    const rowType = schema.nodes["tableRow"];
    const cellType = schema.nodes["tableCell"];
    const paraType = schema.nodes["paragraph"];

    if (!tableType || !rowType || !cellType || !paraType) return false;

    const makeRow = () =>
      rowType.create(
        null,
        Array.from({ length: cols }, () =>
          cellType.create(null, paraType.create()),
        ),
      );

    const table = tableType.create(
      null,
      Array.from({ length: rows }, makeRow),
    );

    const insertPos = selection.$head.after(1);
    if (dispatch) {
      const tr = state.tr.insert(insertPos, table);
      // Place cursor in first cell
      const firstCellContentPos = insertPos + 3; // table+row+cell open tokens
      tr.setSelection(TextSelection.near(tr.doc.resolve(firstCellContentPos)));
      dispatch(tr);
    }
    return true;
  };
}

/** Move to the next table cell (Tab). Creates a new row when at the last cell. */
const goToNextCell: Command = (state, dispatch) => {
  const { schema, selection } = state;
  const cellType = schema.nodes["tableCell"];
  if (!cellType) return false;

  const pos = findAdjacentCell(state.doc, selection.$head, cellType, 1);
  if (pos === null) return false;

  if (dispatch) {
    const tr = state.tr.setSelection(TextSelection.near(state.doc.resolve(pos)));
    dispatch(tr);
  }
  return true;
};

/** Move to the previous table cell (Shift-Tab). */
const goToPrevCell: Command = (state, dispatch) => {
  const { schema, selection } = state;
  const cellType = schema.nodes["tableCell"];
  if (!cellType) return false;

  const pos = findAdjacentCell(state.doc, selection.$head, cellType, -1);
  if (pos === null) return false;

  if (dispatch) {
    const tr = state.tr.setSelection(TextSelection.near(state.doc.resolve(pos)));
    dispatch(tr);
  }
  return true;
};

/**
 * Walk the document collecting all tableCell positions, then return the
 * position of the cell offset steps away from the one containing $head.
 * offset = +1 → next cell, -1 → previous cell.
 */
function findAdjacentCell(
  doc: Node,
  $head: ReturnType<typeof doc.resolve>,
  cellType: NodeType,
  offset: 1 | -1,
): number | null {
  // Check if we're inside a tableCell
  let inCell = false;
  for (let d = $head.depth; d >= 0; d--) {
    if ($head.node(d).type === cellType) {
      inCell = true;
      break;
    }
  }
  if (!inCell) return null;

  // Collect all tableCell content-start positions
  const positions: number[] = [];
  doc.descendants((node, pos) => {
    if (node.type === cellType) {
      positions.push(pos + 1); // +1 to enter cell content
      return false; // don't descend into cell content
    }
    return true;
  });

  if (positions.length === 0) return null;

  // Find which cell contains $head
  const headPos = $head.pos;
  let currentIndex = -1;
  for (let i = 0; i < positions.length; i++) {
    if (headPos >= positions[i]!) {
      currentIndex = i;
    }
  }

  if (currentIndex === -1) return null;
  const targetIndex = currentIndex + offset;
  if (targetIndex < 0 || targetIndex >= positions.length) return null;

  return positions[targetIndex]!;
}

// ── Extension ─────────────────────────────────────────────────────────────────

export const Table = Extension.create({
  name: "table",

  addNodes() {
    return {
      table: {
        content: "tableRow+",
        group: "block",
        tableRole: "table",
        isolating: true,
        parseDOM: [{ tag: "table" }],
        toDOM: () => ["table", 0],
      },
      tableRow: {
        content: "tableCell+",
        tableRole: "row",
        parseDOM: [{ tag: "tr" }],
        toDOM: () => ["tr", 0],
      },
      tableCell: {
        content: "block+",
        tableRole: "cell",
        isolating: true,
        parseDOM: [{ tag: "td" }, { tag: "th" }],
        toDOM: () => ["td", 0],
      },
    };
  },

  addKeymap() {
    return {
      Tab: goToNextCell,
      "Shift-Tab": goToPrevCell,
    };
  },

  addCommands() {
    return {
      insertTable:
        (rows = 3, cols = 3) =>
        insertTable(rows as number, cols as number),
    };
  },

  addLayoutHandlers() {
    return {
      table: TableBlockStrategy,
    };
  },

  addBlockStyles() {
    return {
      table: {
        font: "16px/1.5 Georgia, serif",
        spaceBefore: 12,
        spaceAfter: 12,
        align: "left",
      },
      tableCell: {
        font: "16px/1.5 Georgia, serif",
        spaceBefore: 0,
        spaceAfter: 0,
        align: "left",
      },
    };
  },

  addToolbarItems() {
    return [
      {
        command: "insertTable",
        args: [3, 3],
        label: "⊞",
        title: "Insert Table (3×3)",
        isActive: () => false,
      },
    ];
  },

  addMarkdownSerializerRules() {
    return {
      nodes: {
        table: (state, node) => {
          let firstRow = true;
          node.forEach((rowNode) => {
            state.write("|");
            rowNode.forEach((cellNode) => {
              state.write(" ");
              // Render each block in the cell inline (flatten to text)
              cellNode.forEach((contentNode) => {
                state.renderInline(contentNode);
              });
              state.write(" |");
            });
            state.write("\n");
            if (firstRow) {
              state.write("|");
              rowNode.forEach(() => state.write(" --- |"));
              state.write("\n");
              firstRow = false;
            }
          });
          state.write("\n");
        },
        tableRow: () => { /* handled by table */ },
        tableCell: () => { /* handled by table */ },
      },
    };
  },
});
