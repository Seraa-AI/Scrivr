/**
 * Layout items: the blocks a flow lays out, one after another, with the list
 * marker and indent each carries. The page body and every table cell collect
 * their blocks here and measure them through `layoutBlockWithMarker`, so a
 * list draws the same wherever it sits.
 */
import type { Node } from "prosemirror-model";
import { coerceSectionSettings, isSectionBreak, type SectionBreakType } from "../model/sections";
import {
  bulletBox,
  bulletShape,
  DEFAULT_TAB_STOP,
  LIST_MARKER_HANGING,
  listKind,
  listLevel,
  listMarker,
  listStart,
} from "../model/lists";
import { layoutBlock, ownFirstLineIndent, type BlockLayoutOptions, type LayoutBlock } from "./BlockLayout";
import { nodeLayout } from "./BlockRegistry";
import { getBlockStyle, type BlockStyle, type FontConfig } from "./FontConfig";
import type { LayoutLine } from "./LineBreaker";
import type { TextMeasurerLike } from "./TextMeasurer";
import { listMarkerFont } from "./listMarkers";

/** A single item ready for layout — either a plain block or an expanded list item. */
export interface LayoutItem {
  isPageBreak?: true;
  pageBreakType?: Exclude<SectionBreakType, "continuous">;
  node: Node;
  nodePos: number;
  /** Extra left indent in px: a list level's text indent, plus the block's own `indent`. */
  indentLeft: number;
  /** Bullet or number, e.g. "•" or "1.", on the first block of a list item only. */
  listMarker?: string;
  /**
   * Override the FontConfig key used for block-style lookup.
   * A paragraph in a list item takes the `list_item` spacing defined in
   * addBlockStyles(), not the paragraph style.
   */
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

/** Where a block sits in a list. */
interface ListPlace {
  depth: number;
  /** The item's marker, on its first block only. */
  marker?: string;
}

/**
 * The blocks under `parent`, in order, as layout items. `base` is the
 * document position of `parent`'s first child.
 *
 * Each node contributes according to the layout participation its spec
 * declares (see `NodeLayout`): a `block` node contributes one item, a
 * `transparent` node contributes none of its own and its children are
 * collected in its place — which, by `nodeLayout`'s default, includes any
 * undeclared node whose content is blocks.
 *
 * Lists and tables are expanded ahead of that, because their expansion is not
 * merely transparent — they carry markers, indents and column widths down to
 * the items they produce. Every block of a list item is laid out at its
 * level's indent, and only the item's first block carries the marker.
 */
export function collectChildItems(parent: Node, base: number): LayoutItem[] {
  const items: LayoutItem[] = [];

  // Children laid out in their parent's place: the first takes the parent's
  // list place, marker included; the rest take only its depth.
  const walk = (container: Node, start: number, list: ListPlace | null): void => {
    container.forEach((node, relOffset, index) => {
      walkOne(node, start + relOffset, index === 0 || !list ? list : { depth: list.depth });
    });
  };

  const walkOne = (node: Node, offset: number, list: ListPlace | null): void => {
    if (node.type.name === "pageBreak") {
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

    const kind = listKind(node);
    if (kind) {
      const depth = list ? list.depth + 1 : 0;
      let n = kind === "ordered" ? listStart(node) : 1;
      node.forEach((listItem, itemOffset) => {
        walk(listItem, offset + 1 + itemOffset + 1, { depth, marker: listMarker(kind, depth, n++) });
      });
      return;
    }

    if (node.type.name === "table") {
      // One item per row: a row moves to the next page whole, so it is the
      // unit pagination places.
      const gridAttr = node.attrs["grid"];
      const tableColumns = Array.isArray(gridAttr)
        ? gridAttr.filter((w): w is number => typeof w === "number" && Number.isFinite(w))
        : [];
      const lastRowIndex = node.childCount - 1;
      node.forEach((rowNode, rowOffset, rowIndex) => {
        const rowNodePos = offset + 1 + rowOffset;
        items.push({
          node: rowNode,
          nodePos: rowNodePos,
          indentLeft: list ? listLevel(list.depth).textIndent : 0,
          tableColumns,
          isLastRow: rowIndex === lastRowIndex,
        });
      });
      return;
    }

    // A node laid out in place that holds nothing still takes its line, so an
    // empty container does not vanish from the page.
    if (nodeLayout(node.type).kind === "transparent" && node.childCount > 0) {
      walk(node, offset + 1, list);
      return;
    }

    if (!list) {
      items.push({ node, nodePos: offset, indentLeft: blockIndentOf(node) });
      return;
    }
    items.push({
      node,
      nodePos: offset,
      indentLeft: listLevel(list.depth).textIndent + blockIndentOf(node),
      ...(list.marker !== undefined ? { listMarker: list.marker } : {}),
      // A heading or code block in an item keeps its own style.
      ...(node.type.name === "paragraph" ? { styleKey: "list_item" } : {}),
    });
  };

  walk(parent, base, null);
  return items;
}

/** The document's blocks, in order, as layout items. */
export function collectLayoutItems(doc: Node): LayoutItem[] {
  return collectChildItems(doc, 0);
}

/** However deep a block is indented, an inch of the line is left for its text. */
const MIN_TEXT_WIDTH = 96;
/** The least of the line a tab stop must leave for the text after a list number: the same inch. */
const MIN_TEXT_AFTER_NUMBER = MIN_TEXT_WIDTH;

/** A list marker to measure a block against: its text, how far in the block's text is, and how far the marker hangs before it. */
export interface MarkerPlacement {
  text: string;
  indentLeft: number;
  /**
   * How far the marker's left edge sits before the text: a quarter inch, or
   * less where the content box leaves less, so the number never leaves it.
   */
  hanging: number;
}

/** The marker's left edge, for text that starts at `textX`. */
export function listMarkerXOf(textX: number, marker: MarkerPlacement): number {
  return textX - marker.hanging;
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
 * or a table cell — so both lay a list out by the same rules: the indent fits
 * the box, the marker stays inside it, and a list paragraph takes the list's
 * spacing (`styleKey`) rather than a paragraph's.
 */
export function resolveItem(item: LayoutItem, box: { x: number; width: number }, fontConfig: FontConfig): ResolvedItem {
  const indentLeft = Math.min(item.indentLeft, Math.max(0, box.width - MIN_TEXT_WIDTH));
  const level = item.node.attrs["level"];
  const style = getBlockStyle(fontConfig, item.styleKey ?? item.node.type.name, typeof level === "number" ? level : undefined);
  return {
    indentLeft,
    x: box.x + indentLeft,
    width: box.width - indentLeft,
    ...(item.listMarker !== undefined
      ? { marker: { text: item.listMarker, indentLeft, hanging: Math.min(LIST_MARKER_HANGING, indentLeft) } }
      : {}),
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
 * How far a list number pushes the item's first line of text. Word follows the
 * number with a tab (`w:suff`, a tab when omitted) that follows the normal tab
 * stop rules: the text stays where it is unless the number reaches it, and
 * then moves to the next default stop past the number. When that stop would
 * leave less than `MIN_TEXT_AFTER_NUMBER` of the line, the text follows the
 * number after a space instead, as Word's `w:suff="space"` places it; what
 * Word does with a tab past the line's last usable stop is not documented.
 */
function markerFirstLineOffset(
  marker: MarkerPlacement,
  lines: readonly LayoutLine[],
  measurer: TextMeasurerLike,
  ownIndent: number,
  blockWidth: number,
): number {
  const { font, size } = listMarkerFont(lines);
  const width = bulletShape(marker.text)
    ? bulletBox(size).size
    : measurer.measureWidth(marker.text, font);
  const textStart = marker.indentLeft + ownIndent;
  const markerEnd = marker.indentLeft - marker.hanging + width;
  if (markerEnd < textStart) return 0;
  const nextStop = (Math.floor(markerEnd / DEFAULT_TAB_STOP) + 1) * DEFAULT_TAB_STOP;
  const lineEnd = marker.indentLeft + blockWidth;
  const target = lineEnd - nextStop >= MIN_TEXT_AFTER_NUMBER
    ? nextStop
    : markerEnd + measurer.measureWidth(" ", font);
  return Math.max(0, target - textStart);
}

/**
 * The first-line settings a list marker resolves to. Every re-layout of the
 * block (around a float, on another page) reuses them, so its first line
 * keeps clear of the number and keeps a line for it.
 */
export type FirstLineSettings = Pick<BlockLayoutOptions, "firstLineOffset" | "keepAnchorLine">;

/**
 * Lays a block out with its list marker. The marker is sized by the first
 * line's font, which only measuring tells, so a number too wide for its
 * hanging re-breaks the lines past it; a list item's first block keeps a line
 * for its number even when it holds only a floating image's anchor, as Word
 * draws it.
 */
export function measureWithMarker(
  node: Node,
  options: BlockLayoutOptions,
  marker: MarkerPlacement | undefined,
): { block: LayoutBlock; firstLine?: FirstLineSettings } {
  if (!marker) return { block: layoutBlock(node, options) };
  const settingsFor = (firstLineOffset: number): FirstLineSettings =>
    firstLineOffset > 0 ? { keepAnchorLine: true, firstLineOffset } : { keepAnchorLine: true };
  const first = layoutBlock(node, { ...options, ...settingsFor(0) });
  const offset = markerFirstLineOffset(marker, first.lines, options.measurer, ownFirstLineIndent(node), options.availableWidth);
  const firstLine = settingsFor(offset);
  const measured = offset > 0 ? layoutBlock(node, { ...options, ...firstLine }) : first;
  return {
    block: { ...measured, listMarker: marker.text, listMarkerX: listMarkerXOf(options.x, marker) },
    firstLine,
  };
}

export function layoutBlockWithMarker(
  node: Node,
  options: BlockLayoutOptions,
  marker: MarkerPlacement | undefined,
): LayoutBlock {
  return measureWithMarker(node, options, marker).block;
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
): LayoutBlock {
  const resolved = resolveItem(item, box, options.fontConfig);
  const block = layoutBlockWithMarker(item.node, {
    ...options,
    nodePos: item.nodePos,
    x: resolved.x,
    availableWidth: resolved.width,
    ...(item.tableColumns ? { tableColumns: item.tableColumns } : {}),
  }, resolved.marker);
  return {
    ...block,
    ...itemSpacing(resolved, block),
    ...(item.isLastRow ? { isLastRow: true } : {}),
  };
}
