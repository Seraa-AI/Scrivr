/**
 * Layout items: the blocks a flow lays out, one after another, with the
 * indent, style and marker the wrappers around each give it. The page body and
 * every region of a composite collect their blocks here and measure them through
 * `layoutBlockWithMarker`, so a wrapped block draws the same wherever it sits.
 */
import type { Node } from "prosemirror-model";
import { coerceSectionSettings, isSectionBreak, type SectionBreakType } from "../model/sections";
import { layoutBlock, ownFirstLineIndent, type BlockLayoutOptions, type LayoutBlock, type MarkerLine } from "./BlockLayout";
import { breakOf, nodeLayout, type CompositeLayout, type CompositeUnit, type WrapperLayout, type WrapScope } from "./BlockRegistry";
import { getBlockStyle, type BlockStyle, type FontConfig } from "./FontConfig";
import type { LayoutLine, LineSpaceProvider } from "./LineBreaker";
import type { TextMeasurerLike } from "./TextMeasurer";
import { markerFaceOf, type BlockMarker, type LaidMarker, type MarkerFace } from "./markers";

/** The page the next block starts on past a boundary that moves the flow. */
export type PageStart = Exclude<SectionBreakType, "continuous">;

/**
 * Where the flow may move on: past a node that breaks the page, or past a
 * section boundary, into the next section by its transition.
 */
export type LayoutBoundary =
  | { kind: "break"; breaks: "page" }
  | { kind: "section"; transition: SectionBreakType };

/** The page the next block starts on past `boundary`, or null when it does not move the flow. */
export function pageStartPast(boundary: LayoutBoundary): PageStart | null {
  if (boundary.kind === "break") return "nextPage";
  return boundary.transition === "continuous" ? null : boundary.transition;
}

/** A single item ready for layout: a block, or a boundary between blocks. */
export interface LayoutItem {
  boundary?: LayoutBoundary;
  node: Node;
  nodePos: number;
  /** Extra left indent in px: what the wrappers around the block add, plus its own `indent`. */
  indentLeft: number;
  /** Hung before the block's first line by a wrapper around it. */
  marker?: BlockMarker;
  /** Overrides the FontConfig key the block's style is looked up by: a wrapper's restyle. */
  styleKey?: string;
  /** The composite unit this item is, laid out as its regions. */
  unit?: { composite: CompositeLayout; unit: CompositeUnit };
  /** True for the last unit of its composite. */
  lastUnit?: true;
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
 * A composite node is expanded into its units, what pagination places.
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
    container.forEach((node, relOffset) => walkOne(node, start + relOffset, scope, container));
  };

  const walkOne = (node: Node, offset: number, scope: WrapScope, container: Node): void => {
    if (breakOf(node.type) === "page") {
      items.push({ boundary: { kind: "break", breaks: "page" }, node, nodePos: offset, indentLeft: 0 });
      return;
    }

    // Every section boundary between the document's own blocks, a continuous
    // one included: it is where the next section's settings take over, though
    // only the other transitions move the flow today. One nested in a wrapper
    // ends no section (`deriveSections` reads the document's children), so it
    // takes no place in the flow.
    if (isSectionBreak(node)) {
      if (container.type !== container.type.schema.topNodeType) return;
      const transition = coerceSectionSettings(node.attrs["settings"]).breakType;
      items.push({ boundary: { kind: "section", transition }, node, nodePos: offset, indentLeft: 0 });
      return;
    }

    // A composite node gives one item per unit: a unit moves to the next page
    // whole, so it is what pagination places. A unit takes its wrappers'
    // indent only: it has no first line to hang a marker on, and its regions
    // style their own text.
    const layout = nodeLayout(node.type);
    if (layout.kind === "composite") {
      const units = layout.composite.units(node, offset);
      units.forEach((unit, index) => {
        items.push({
          node: unit.node,
          nodePos: unit.pos,
          indentLeft: placeInWrappers(unit.node).indentLeft,
          unit: { composite: layout.composite, unit },
          ...(index === units.length - 1 ? { lastUnit: true } : {}),
        });
      });
      return;
    }

    // A node laid out in place that holds nothing still takes its line, so an
    // empty container does not vanish from the page.
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
 * or a composite's region — so both lay a wrapped block out by the same rules: the
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
 * How far a marker pushes the block's first line of text: not at all unless
 * the marker reaches the text, and then to where the marker ends, as Word
 * does. A float that moves the line `lineStart` in moves the marker with it.
 */
function markerFirstLineOffset(
  placement: MarkerPlacement,
  lines: readonly LayoutLine[],
  measurer: TextMeasurerLike,
  ownIndent: number,
  lineStart: number,
): number {
  const face = markerFaceOf(lines);
  const textStart = placement.indentLeft + lineStart + ownIndent;
  const markerEnd = markerStartOf(placement, lineStart) + placement.marker.width(face, measurer);
  return Math.max(0, markerEnd - textStart);
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
    markerFirstLineOffset(placement, first.lines, options.measurer, ownFirstLineIndent(node), lineStart);
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
 * composite's region — fully resolved: indent, marker, the item's spacing, and
 * a unit's regions and last-unit edge, as the page body resolves them.
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
    ...(item.unit ? { unit: item.unit } : {}),
  }, resolved.marker);
  return {
    ...block,
    ...itemSpacing(resolved, block),
    ...(item.lastUnit ? { lastUnit: true } : {}),
  };
}
