/**
 * TableLayoutEngine — canvas-native layout for `table` rows.
 *
 * Each `tableRow` becomes one `kind: "tableRow"` LayoutBlock whose `cells`
 * carry per-cell rectangles and the laid-out child blocks of each cell. The
 * engine:
 *   1. Derives column x-offsets from the table's `grid` widths.
 *   2. Lays out every cell's child blocks (paragraphs, headings, wrapped blocks, …)
 *      inside the cell's content box (column width minus padding), collected
 *      and measured as the page body's are, markers and indents included.
 *   3. Sizes the row to its tallest cell; every cell fills that height.
 *
 * Position model (matches the line model so the measure cache can reuse a row
 * at any page y): cell `x` is absolute (horizontal position never changes with
 * pagination), but cell `y` and the child blocks' `y` are RELATIVE to the row
 * block's top. The renderer and CharacterMap add the row block's final `y` at
 * paint time.
 *
 * vMerge note (v1): vertically merged cells are laid out per row — a "restart"
 * cell's content lives in its own row; "continue" cells are empty placeholders.
 * Cross-row content flow is not modelled yet; the merge is a render-time border
 * concern handled by `TableRowStrategy`.
 */
import type { Node } from "prosemirror-model";
import { cellBackground, cellGridSpan, cellVMerge } from "../table/attrs";
import type { LayoutBlock, CellSubBlock, CellFloat } from "./BlockLayout";
import { ANCHORED_OBJECT_MARGIN, anchorsInLines, clearOfEarlier } from "./AnchoredObjects";
import { ExclusionManager } from "./ExclusionManager";
import type { LineSpaceProvider } from "./LineBreaker";
import type { TextMeasurerLike } from "./TextMeasurer";
import { defaultFontConfig, type FontConfig } from "./FontConfig";
import type { FontModifier } from "../extensions/types";
import type { InlineRegistry } from "./BlockRegistry";
import type { LayoutFontResolver } from "../fonts/layoutResolver";
import { collectChildItems, layoutItem } from "./layoutItems";

/** Horizontal cell padding (left + right) in CSS px. */
export const CELL_PADDING_H = 6;
/** Vertical cell padding (top + bottom) in CSS px. */
export const CELL_PADDING_V = 4;
/** Fallback width for a grid column the `grid` attr doesn't cover. */
const DEFAULT_COLUMN_WIDTH = 100;

export interface TableRowLayoutContext {
  /** Absolute x of the row's left edge (page left margin / indent). */
  x: number;
  /** Column widths in CSS px, from the table's `grid` attr. */
  columns: number[];
  /** Content width the row must fit within — columns scale to fill it. */
  availableWidth: number;
  /** Page this row sits on. */
  page: number;
  /** Absolute document position of the row node. */
  rowNodePos: number;
  measurer: TextMeasurerLike;
  fontConfig?: FontConfig;
  fontModifiers?: Map<string, FontModifier>;
  inlineRegistry?: InlineRegistry;
  /** Cell text is document text: it resolves its faces like any other block. */
  fonts?: LayoutFontResolver;
}

function columnWidth(columns: number[], index: number): number {
  return columns[index] ?? DEFAULT_COLUMN_WIDTH;
}

/**
 * Lay out one table row's cells. Returns the cell sub-blocks (with `y` relative
 * to the row top) and the row's content-driven height.
 */
export function layoutTableRowCells(
  rowNode: Node,
  ctx: TableRowLayoutContext,
): { cells: CellSubBlock[]; height: number } {
  // Scale the grid to fill the available content width (Word/Docs fit a table
  // to the page, never letting a wide grid overflow the margin). Proportions
  // from `grid` are preserved.
  const colCount = Math.max(ctx.columns.length, 1);
  let rawTotal = 0;
  for (let c = 0; c < colCount; c++) rawTotal += columnWidth(ctx.columns, c);
  const scale = ctx.availableWidth > 0 && rawTotal > 0 ? ctx.availableWidth / rawTotal : 1;
  const widthOf = (c: number): number => columnWidth(ctx.columns, c) * scale;

  // Cumulative x offset of each grid column from the row's left edge.
  const columnX: number[] = [];
  let acc = 0;
  for (let c = 0; c < colCount; c++) {
    columnX.push(acc);
    acc += widthOf(c);
  }

  const cells: CellSubBlock[] = [];
  let col = 0;

  rowNode.forEach((cellNode, offsetInRow) => {
    const span = cellGridSpan(cellNode);
    const cellX = ctx.x + (columnX[col] ?? col * DEFAULT_COLUMN_WIDTH);

    let cellWidth = 0;
    for (let c = col; c < col + span; c++) cellWidth += widthOf(c);

    const contentX = cellX + CELL_PADDING_H;
    const contentWidth = Math.max(0, cellWidth - 2 * CELL_PADDING_H);
    const cellPos = ctx.rowNodePos + 1 + offsetInRow;

    const box: CellBox = { cellPos, contentX, contentWidth };
    const { blocks, contentBottom, floats } = layoutCellContent(cellNode, box, ctx);
    const cellHeight = Math.max(contentBottom, ...floats.filter(wrapsText).map((f) => f.y + f.height)) + CELL_PADDING_V;

    cells.push({
      cellPos,
      x: cellX,
      y: 0, // cell top aligns with the row top
      width: cellWidth,
      height: cellHeight,
      vMerge: cellVMerge(cellNode),
      background: cellBackground(cellNode),
      blocks,
      ...(floats.length > 0 ? { floats } : {}),
    });

    col += span;
  });

  const rowHeight = cells.reduce((max, c) => Math.max(max, c.height), 0);
  // Every cell fills the row height (top-aligned content in v1).
  for (const cell of cells) cell.height = rowHeight;

  return { cells, height: rowHeight };
}

interface CellBox {
  cellPos: number;
  contentX: number;
  contentWidth: number;
}

/** Text in a cell wraps around square and top-and-bottom images; behind and front wrap nothing. */
function wrapsText(f: CellFloat): boolean {
  return f.wrapMode === "square" || f.wrapMode === "top-bottom";
}

/**
 * Passes allowed for a cell whose images move their own anchors: an image
 * placed from its paragraph can wrap the text above that paragraph and so
 * move it. Word re-places until it settles; a cell keeps the last placement.
 */
const MAX_CELL_PASSES = 3;

/**
 * Lay out a cell's blocks and the images anchored in them, as Word does with
 * `layoutInCell`: each image is placed in the cell from its paragraph's top
 * and the cell's text wraps around it. Every `y` is relative to the row top.
 */
function layoutCellContent(
  cellNode: Node,
  box: CellBox,
  ctx: TableRowLayoutContext,
): { blocks: LayoutBlock[]; contentBottom: number; floats: CellFloat[] } {
  let laid = layoutCellBlocks(cellNode, box, ctx);
  let floats = placeCellFloats(laid.blocks, box);
  // The images the laid-out text wraps around. Returned with it, so text and
  // image never disagree: an image that keeps moving its own anchor stays
  // where the text last wrapped it, as the body locks one.
  let wrapped = floats;
  for (let pass = 0; pass < MAX_CELL_PASSES && floats.some(wrapsText); pass++) {
    laid = layoutCellBlocks(cellNode, box, ctx, wrapAround(floats, box));
    wrapped = floats;
    const replaced = placeCellFloats(laid.blocks, box);
    const settled = replaced.every((f, i) => f.x === floats[i]?.x && f.y === floats[i]?.y);
    floats = replaced;
    if (settled) break;
  }
  return { ...laid, floats: wrapped };
}

function layoutCellBlocks(
  cellNode: Node,
  box: CellBox,
  ctx: TableRowLayoutContext,
  lineSpaceIn?: (x: number, width: number) => LineSpaceProvider,
): { blocks: LayoutBlock[]; contentBottom: number } {
  // Each block is resolved as the page body resolves it. A page break has no
  // meaning inside a cell.
  const blocks: LayoutBlock[] = [];
  let relY = CELL_PADDING_V;
  for (const item of collectChildItems(cellNode, box.cellPos + 1)) {
    if (item.isPageBreak) continue;
    const childBlock = layoutItem(item, { x: box.contentX, width: box.contentWidth }, {
      y: relY,
      page: ctx.page,
      measurer: ctx.measurer,
      // No `map`: the CharacterMap is populated at paint time (TableRowStrategy),
      // matching the convention for cached, position-independent layouts.
      fontConfig: ctx.fontConfig ?? defaultFontConfig,
      ...(ctx.fontModifiers ? { fontModifiers: ctx.fontModifiers } : {}),
      ...(ctx.inlineRegistry ? { inlineRegistry: ctx.inlineRegistry } : {}),
      ...(ctx.fonts ? { fonts: ctx.fonts } : {}),
    }, lineSpaceIn);
    blocks.push(childBlock);
    relY += childBlock.spaceBefore + childBlock.height + childBlock.spaceAfter;
  }
  return { blocks, contentBottom: relY };
}

/**
 * Place each image anchored in the cell's blocks: `yOffset` from its
 * paragraph's top, never above the cell's content top, and kept inside the
 * cell horizontally. A square image that would overlap one placed before it
 * moves clear of it, as in the body.
 */
function placeCellFloats(blocks: readonly LayoutBlock[], box: CellBox): CellFloat[] {
  const floats: CellFloat[] = [];
  for (const block of blocks) {
    for (const anchor of anchorsInLines(block.lines)) {
      const { attrs } = anchor;
      // An image wider than its cell is scaled down whole, never squashed.
      const scale = Math.min(1, box.contentWidth / attrs.width);
      const width = attrs.width * scale;
      const height = attrs.height * scale;
      const maxX = box.contentX + box.contentWidth - width;
      const x = attrs.xAlign === "custom"
        ? Math.min(Math.max(box.contentX + (attrs.x ?? 0), box.contentX), maxX)
        : attrs.xAlign === "center" ? box.contentX + (box.contentWidth - width) / 2
        : attrs.xAlign === "right" ? maxX
        : box.contentX;
      const atOffset = Math.max(CELL_PADDING_V, block.y + attrs.yOffset);
      const float: CellFloat = {
        docPos: anchor.docPos,
        node: anchor.node,
        x,
        y: atOffset,
        width,
        height,
        wrapMode: attrs.wrapMode,
        zIndex: attrs.zIndex,
        margin: attrs.margin,
        anchorY: block.y,
        ...(atOffset !== block.y + attrs.yOffset ? { clamped: true } : {}),
      };
      if (wrapsText(float)) {
        // A top-and-bottom image takes the whole width, so it can only move below.
        const contentRight = box.contentX + box.contentWidth;
        const reach = (f: CellFloat) => f.wrapMode === "top-bottom" ? { ...f, x: box.contentX, width: box.contentWidth } : f;
        const spot = clearOfEarlier(reach(float), floats.filter(wrapsText).map(reach), box.contentX, contentRight, ANCHORED_OBJECT_MARGIN);
        if (float.wrapMode === "square") float.x = spot.x;
        if (spot.y > float.y) float.stackOffset = spot.y - float.y;
        float.y = spot.y;
      }
      floats.push(float);
    }
  }
  return floats;
}

/**
 * The cell's lines asked against its wrapping images, answered for the box a
 * block lays its text in (an indented block's is narrower than the cell).
 */
function wrapAround(floats: readonly CellFloat[], box: CellBox): (x: number, width: number) => LineSpaceProvider {
  const exclusions = new ExclusionManager();
  for (const f of floats) {
    // As in the body, the margin band never reaches above the image's own
    // paragraph: the blocks above fix where that paragraph starts, so letting
    // the band move them makes the image chase its own anchor.
    const top = Math.max(CELL_PADDING_V, f.y - f.margin, Math.min(f.y, f.anchorY));
    const bottom = f.y + f.height + f.margin;
    if (f.wrapMode === "square") {
      exclusions.addRect({ page: 1, x: f.x - f.margin, right: f.x + f.width + f.margin, y: top, bottom, side: "left", docPos: f.docPos });
    } else if (f.wrapMode === "top-bottom") {
      exclusions.addFullWidthRect({ page: 1, y: top, bottom, contentX: box.contentX, contentWidth: box.contentWidth, docPos: f.docPos });
    }
  }
  return (x, width) => (lineY, lineHeight = 1) => {
    const space = exclusions.getAvailableSegments(1, lineY, lineHeight, x, width);
    const segments = space.segments.map((seg) => ({ x: seg.x - x, width: seg.width }));
    if (segments.length === 0 && space.skipToY === undefined) {
      return { segments, skipToY: exclusions.getNextFreeY(1, lineY, lineHeight, x, width) };
    }
    return space.skipToY !== undefined ? { segments, skipToY: space.skipToY } : { segments };
  };
}
