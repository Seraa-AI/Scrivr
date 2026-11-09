/**
 * Layout items: the blocks a flow lays out, one after another, with the
 * indent, style and marker the wrappers around each give it. The page body and
 * every table cell collect their blocks here and measure them through
 * `layoutBlockWithMarker`, so a wrapped block draws the same wherever it sits.
 */
import type { Node } from "prosemirror-model";
import { coerceSectionSettings, isSectionBreak, type SectionBreakType } from "../model/sections";
import { layoutBlock, ownFirstLineIndent, type BlockLayoutOptions, type LayoutBlock, type MarkerLine } from "./BlockLayout";
import { breakOf, nodeLayout, type WrapperLayout, type WrapScope } from "./BlockRegistry";
import { getBlockStyle, type BlockStyle, type FontConfig } from "./FontConfig";
import type { LayoutLine, LineSpaceProvider } from "./LineBreaker";
import type { TextMeasurerLike } from "./TextMeasurer";
import { markerFaceOf, type BlockMarker, type LaidMarker, type MarkerFace } from "./markers";

/** A single item ready for layout: a block, or a page break between blocks. */
export interface LayoutItem {
  isPageBreak?: true;
  pageBreakType?: Exclude<SectionBreakType, "continuous">;
  node: Node;
  nodePos: number;
  /** Extra left indent in px: what the wrappers around the block add, plus its own `indent`. */
  indentLeft: number;
  /** Hung before the block's first line by a wrapper around it. */
  marker?: BlockMarker;
  /** Overrides the FontConfig key the block's style is looked up by: a wrapper's restyle. */
  styleKey?: string;
  /** Column widths (from the parent table's `grid`) — set on table row items. */
  tableColumns?: number[];
  /** True for a table's last row — drives table bottom-border ownership. */
  isLastRow?: boolean;
}

/** Width of one step of a block's own `indent` attr. */
const BLOCK_INDENT_STEP = 24;

const blockIndentOf = (node: Node): number => {
  const indent = node.attrs["indent"];
  return typeof indent === "number" && Number.isFinite(indent) && indent > 0 ? indent * BLOCK_INDENT_STEP : 0;
};

/** A wrapper the walk is inside: its layout, what it handed down, and how many blocks it has placed. */
interface WrapFrame {
  wrap: WrapperLayout;
  scope: WrapScope;
  placed: number;
}

/**
 * The blocks under `parent`, in order, as layout items. `base` is the
 * document position of `parent`'s first child.
 *
 * Each node contributes according to the layout participation its spec
 * declares (see `NodeLayout`): a `block` node contributes one item, a
 * `transparent` node contributes none of its own and its children are
 * collected in its place — which, by `nodeLayout`'s default, includes any
 * undeclared node whose content is blocks. A transparent node with `wrap`
 * shapes every block collected inside it: their indents add up, and the
 * innermost wrapper's marker and style win.
 *
 * A table is expanded into its rows, the unit pagination places.
 */
export function collectChildItems(parent: Node, base: number): LayoutItem[] {
  const items: LayoutItem[] = [];
  const frames: WrapFrame[] = [];

  const placeInWrappers = (node: Node): Pick<LayoutItem, "indentLeft" | "marker" | "styleKey"> => {
    let indentLeft = 0;
    let marker: BlockMarker | undefined;
    let styleKey: string | undefined;
    for (const frame of frames) {
      const placement = frame.wrap.place(node, frame.placed++, frame.scope);
      indentLeft += placement.indent;
      marker = placement.marker ?? marker;
      styleKey = placement.styleKey ?? styleKey;
    }
    return { indentLeft, ...(marker ? { marker } : {}), ...(styleKey !== undefined ? { styleKey } : {}) };
  };

  const walk = (container: Node, start: number, scope: WrapScope): void => {
    container.forEach((node, relOffset) => walkOne(node, start + relOffset, scope));
  };

  const walkOne = (node: Node, offset: number, scope: WrapScope): void => {
    if (breakOf(node.type) === "page") {
      items.push({ isPageBreak: true, node, nodePos: offset, indentLeft: 0 });
      return;
    }

    // A section boundary affects the flow only when the next section must
    // start on a fresh page. A continuous break is a pure model marker, and
    // column geometry is read from the derived sections, not from here.
    if (isSectionBreak(node)) {
      const breakType = coerceSectionSettings(node.attrs["settings"]).breakType;
      if (breakType !== "continuous") {
        items.push({
          isPageBreak: true,
          pageBreakType: breakType,
          node,
          nodePos: offset,
          indentLeft: 0,
        });
      }
      return;
    }

    if (node.type.name === "table") {
      // One item per row: a row moves to the next page whole, so it is the
      // unit pagination places. A row takes its wrappers' indent only: it has
      // no first line to hang a marker on, and its cells style their own text.
      const gridAttr = node.attrs["grid"];
      const tableColumns = Array.isArray(gridAttr)
        ? gridAttr.filter((w): w is number => typeof w === "number" && Number.isFinite(w))
        : [];
      const lastRowIndex = node.childCount - 1;
      node.forEach((rowNode, rowOffset, rowIndex) => {
        items.push({
          node: rowNode,
          nodePos: offset + 1 + rowOffset,
          indentLeft: placeInWrappers(rowNode).indentLeft,
          tableColumns,
          isLastRow: rowIndex === lastRowIndex,
        });
      });
      return;
    }

    // A node laid out in place that holds nothing still takes its line, so an
    // empty container does not vanish from the page.
    const layout = nodeLayout(node.type);
    if (layout.kind === "transparent" && node.childCount > 0) {
      if (!layout.wrap) {
        walk(node, offset + 1, scope);
        return;
      }
      const inner = layout.wrap.enter(node, scope);
      frames.push({ wrap: layout.wrap, scope: inner, placed: 0 });
      walk(node, offset + 1, inner);
      frames.pop();
      return;
    }

    const placed = placeInWrappers(node);
    items.push({ node, nodePos: offset, ...placed, indentLeft: placed.indentLeft + blockIndentOf(node) });
  };

  walk(parent, base, {});
  return items;
}

/** The document's blocks, in order, as layout items. */
export function collectLayoutItems(doc: Node): LayoutItem[] {
  return collectChildItems(doc, 0);
}

/** However deep a block is indented, an inch of the line is left for its text. */
const MIN_TEXT_WIDTH = 96;
/** The least of the line a tab stop must leave for the text after a marker: the same inch. */
const MIN_TEXT_AFTER_MARKER = MIN_TEXT_WIDTH;
/** Word's default tab stops: every half inch from the content edge. */
const DEFAULT_TAB_STOP = 48;

/** A marker to measure a block against: the marker, how far in the block's text is, and how far the marker hangs before it. */
export interface MarkerPlacement {
  marker: BlockMarker;
  indentLeft: number;
  /**
   * How far the marker's left edge sits before the text: its own hanging, or
   * less where the content box leaves less, so the marker never leaves it.
   */
  hanging: number;
}

/** The marker as layout leaves it on a block whose text starts at `textX`. */
export function laidMarkerOf(placement: MarkerPlacement, textX: number, face?: MarkerFace): LaidMarker {
  return {
    painter: placement.marker.painter,
    data: placement.marker.data,
    x: textX - placement.hanging,
    ...(face ? { face } : {}),
  };
}

/**
 * Where the marker starts, from the block's content-box edge: at its hang, or
 * at the line's start on a first line a float moves `lineStart` in past the
 * text's edge, and so past the hang.
 */
function markerStartOf(placement: MarkerPlacement, lineStart: number): number {
  return lineStart > 0 ? placement.indentLeft + lineStart : placement.indentLeft - placement.hanging;
}

/** An item placed in a content box: where its text goes, its marker, and the style it is spaced by. */
export interface ResolvedItem {
  /** The item's indent, bounded so an inch of the box is left for its text. */
  indentLeft: number;
  /** Absolute x of the item's text. */
  x: number;
  width: number;
  marker?: MarkerPlacement;
  style: BlockStyle;
}

/**
 * Resolves an item against the content box it is laid out in — the page body
 * or a table cell — so both lay a wrapped block out by the same rules: the
 * indent fits the box, the marker stays inside it, and the block takes the
 * style its wrapper names (`styleKey`) rather than its own.
 */
export function resolveItem(item: LayoutItem, box: { x: number; width: number }, fontConfig: FontConfig): ResolvedItem {
  const indentLeft = Math.min(item.indentLeft, Math.max(0, box.width - MIN_TEXT_WIDTH));
  const level = item.node.attrs["level"];
  const style = getBlockStyle(fontConfig, item.styleKey ?? item.node.type.name, typeof level === "number" ? level : undefined);
  return {
    indentLeft,
    x: box.x + indentLeft,
    width: box.width - indentLeft,
    ...(item.marker ? { marker: { marker: item.marker, indentLeft, hanging: Math.min(item.marker.hanging, indentLeft) } } : {}),
    style,
  };
}

/**
 * Whether a measured block holds only floating images' anchors: a text block
 * with no height whose every line is a hidden anchor line. Leaf blocks never
 * qualify, even when their height happens to be zero.
 */
export function isAnchorOnly(block: Pick<LayoutBlock, "kind" | "height" | "lines">): boolean {
  if (block.kind !== "text" || block.height !== 0) return false;
  return block.lines.every((line) =>
    line.lineHeight === 0 &&
    line.cursorHeight === 0 &&
    line.spans.length > 0 &&
    line.spans.every((span) => span.kind === "object" && span.width === 0 && span.height === 0),
  );
}

/** The space an item keeps above and below: its style's, or none for a block that holds only anchors. */
export function itemSpacing(
  resolved: ResolvedItem,
  measured: Pick<LayoutBlock, "kind" | "height" | "lines">,
): { spaceBefore: number; spaceAfter: number } {
  return isAnchorOnly(measured)
    ? { spaceBefore: 0, spaceAfter: 0 }
    : { spaceBefore: resolved.style.spaceBefore, spaceAfter: resolved.style.spaceAfter };
}

/**
 * How far a marker pushes the block's first line of text. Word follows a
 * number with a tab (`w:suff`, a tab when omitted) that follows the normal tab
 * stop rules: the text stays where it is unless the marker reaches it, and
 * then moves to the next default stop past the marker. When that stop would
 * leave less than `MIN_TEXT_AFTER_MARKER` of the line, the text follows the
 * marker after a space instead, as Word's `w:suff="space"` places it; what
 * Word does with a tab past the line's last usable stop is not documented.
 * A float that moves the line `lineStart` in moves the marker with it.
 */
function markerFirstLineOffset(
  placement: MarkerPlacement,
  lines: readonly LayoutLine[],
  measurer: TextMeasurerLike,
  ownIndent: number,
  blockWidth: number,
  lineStart: number,
): number {
  const face = markerFaceOf(lines);
  const textStart = placement.indentLeft + lineStart + ownIndent;
  const markerEnd = markerStartOf(placement, lineStart) + placement.marker.width(face, measurer);
  if (markerEnd < textStart) return 0;
  const nextStop = (Math.floor(markerEnd / DEFAULT_TAB_STOP) + 1) * DEFAULT_TAB_STOP;
  const lineEnd = placement.indentLeft + blockWidth;
  const target = lineEnd - nextStop >= MIN_TEXT_AFTER_MARKER
    ? nextStop
    : markerEnd + measurer.measureWidth(" ", face.font);
  return Math.max(0, target - textStart);
}

/**
 * Lays a block out with its marker. The marker is sized by the first line's
 * font, which only measuring tells, so a marker too wide for its hanging
 * re-breaks the lines past it. The block keeps a line for its marker even when
 * it holds only a floating image's anchor, as Word draws a number there. The
 * returned `markerLine` is what every re-layout of the block (around a float,
 * on another page) reuses, so its first line keeps clear of the marker.
 */
export function measureWithMarker(
  node: Node,
  options: BlockLayoutOptions,
  placement: MarkerPlacement | undefined,
): { block: LayoutBlock; markerLine?: MarkerLine } {
  if (!placement) return { block: layoutBlock(node, options) };
  const first = layoutBlock(node, { ...options, marker: {} });
  const offsetAt = (lineStart: number) =>
    markerFirstLineOffset(placement, first.lines, options.measurer, ownFirstLineIndent(node), options.availableWidth, lineStart);
  const offset = offsetAt(0);
  const markerLine: MarkerLine = { offsetAt, ...(offset > 0 ? { offset } : {}) };
  // A float beside the block can move its first line, and the push with it.
  const measured = offset > 0 || options.lineSpaceProvider ? layoutBlock(node, { ...options, marker: markerLine }) : first;
  return {
    block: { ...measured, marker: laidMarkerOf(placement, options.x, markerFaceOf(measured.lines)) },
    markerLine,
  };
}

export function layoutBlockWithMarker(
  node: Node,
  options: BlockLayoutOptions,
  placement: MarkerPlacement | undefined,
): LayoutBlock {
  return measureWithMarker(node, options, placement).block;
}

/**
 * Lays an item out in a content box that has no pagination of its own — a
 * table cell — fully resolved: indent, marker, the item's spacing, and a
 * table row's columns and last-row edge, as the page body resolves them.
 */
export function layoutItem(
  item: LayoutItem,
  box: { x: number; width: number },
  options: Omit<BlockLayoutOptions, "x" | "availableWidth" | "nodePos" | "fontConfig"> & { fontConfig: FontConfig },
  /** The line space for the box the item's text resolves to, when something wraps it. */
  lineSpaceIn?: (x: number, width: number) => LineSpaceProvider,
): LayoutBlock {
  const resolved = resolveItem(item, box, options.fontConfig);
  const block = layoutBlockWithMarker(item.node, {
    ...options,
    nodePos: item.nodePos,
    x: resolved.x,
    availableWidth: resolved.width,
    ...(lineSpaceIn ? { lineSpaceProvider: lineSpaceIn(resolved.x, resolved.width) } : {}),
    ...(item.tableColumns ? { tableColumns: item.tableColumns } : {}),
  }, resolved.marker);
  return {
    ...block,
    ...itemSpacing(resolved, block),
    ...(item.isLastRow ? { isLastRow: true } : {}),
  };
}
