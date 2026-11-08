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
 * collected in its place. A block that holds blocks but is neither a list nor
 * a table has no lines of its own either, so its blocks are laid out in its
 * place too.
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

    const holdsBlocks = !node.isTextblock && node.firstChild !== null && node.firstChild.isBlock;
    if (nodeLayout(node.type).kind === "transparent" || holdsBlocks) {
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

/** A block's indent within `contentWidth`, bounded so an inch is left for its text. */
export function fitIndent(indentLeft: number, contentWidth: number): number {
  return Math.min(indentLeft, Math.max(0, contentWidth - MIN_TEXT_WIDTH));
}

/** A list marker to measure a block against, and how far in its text is. */
export interface MarkerPlacement {
  text: string;
  indentLeft: number;
}

/**
 * How far a list number pushes the item's first line of text. Word follows the
 * number with a tab (`w:suff`, a tab when omitted) that follows the normal tab
 * stop rules: the text stays where it is unless the number reaches it, and
 * then moves to the next default stop past the number. With no stop left on
 * the line, the text follows the number after a space, as Word's
 * `w:suff="space"` places it; what Word does with a tab past the line's last
 * stop is not documented.
 */
function markerFirstLineOffset(
  marker: MarkerPlacement,
  firstLine: LayoutLine | undefined,
  measurer: TextMeasurerLike,
  ownIndent: number,
  blockWidth: number,
): number {
  const { font, size } = listMarkerFont(firstLine);
  const width = bulletShape(marker.text)
    ? bulletBox(size).size
    : measurer.measureWidth(marker.text, font);
  const textStart = marker.indentLeft + ownIndent;
  const markerEnd = marker.indentLeft - LIST_MARKER_HANGING + width;
  if (markerEnd < textStart) return 0;
  const nextStop = (Math.floor(markerEnd / DEFAULT_TAB_STOP) + 1) * DEFAULT_TAB_STOP;
  const lastTextStart = marker.indentLeft + blockWidth - LIST_MARKER_HANGING;
  const target = nextStop <= lastTextStart ? nextStop : markerEnd + measurer.measureWidth(" ", font);
  return Math.max(0, target - textStart);
}

/**
 * Lays a block out with its list marker. The marker is sized by the first
 * line's font, which only measuring tells, so a number too wide for its
 * hanging re-breaks the lines past it; a list item's first block keeps a line
 * for its number even when it holds only a floating image's anchor, as Word
 * draws it. The marker's left edge hangs a quarter inch before the text.
 */
export function layoutBlockWithMarker(
  node: Node,
  options: BlockLayoutOptions,
  marker: MarkerPlacement | undefined,
): LayoutBlock {
  if (!marker) return layoutBlock(node, options);
  const measure = (firstLineOffset: number) => layoutBlock(node, {
    ...options,
    keepAnchorLine: true,
    ...(firstLineOffset > 0 ? { firstLineOffset } : {}),
  });
  const first = measure(0);
  const offset = markerFirstLineOffset(marker, first.lines[0], options.measurer, ownFirstLineIndent(node), options.availableWidth);
  const measured = offset > 0 ? measure(offset) : first;
  return { ...measured, listMarker: marker.text, listMarkerX: options.x - LIST_MARKER_HANGING };
}
