import { TextSelection, NodeSelection, AllSelection, type Selection } from "prosemirror-state";
import type { CharacterMap } from "../layout/CharacterMap";
import { getHandles } from "../renderer/ResizeController";
import type {
  SelectionBehavior,
  SelectionDescribeContext,
  SelectionGeometryContext,
  SelectionPrimitive,
  SelectionRect,
} from "./types";

/**
 * Core built-in selection behaviors: text, node (image), whole-document, and a
 * default fallback. Extensions register their own before these; the registry
 * tries them in order, so an extension's behavior wins for its own kind.
 *
 * Each behavior reproduces the exact chrome the renderer painted before the
 * seam: text → glyph/empty-line fills + caret; image → border + 8 handles.
 * Behaviors stay theme-agnostic — primitives name a `role`, the renderer colors.
 */

/** Fill rects for a text range on one page — glyph rects plus empty-line marks. */
function rangeFillRects(
  from: number,
  to: number,
  page: number,
  charMap: CharacterMap,
): SelectionRect[] {
  const glyphs = charMap.glyphsInRange(from, to).filter((g) => g.page === page);
  const rects: SelectionRect[] = [];
  for (const g of glyphs) {
    if (g.height > 0) rects.push({ x: g.x, y: g.y, width: g.width, height: g.height });
  }
  // Empty paragraphs have a line but no glyphs — a line-height square marks them.
  const linesWithGlyphs = new Set(glyphs.map((g) => g.lineIndex));
  for (const l of charMap.linesInRange(from, to).filter((l) => l.page === page)) {
    if (l.height > 0 && !linesWithGlyphs.has(l.lineIndex)) {
      rects.push({ x: l.x, y: l.y, width: l.height, height: l.height });
    }
  }
  return rects;
}

/** A caret primitive at `head`, or null when head is off this page. */
function caretPrimitive(
  head: number,
  ctx: SelectionGeometryContext,
): SelectionPrimitive | null {
  const coords = ctx.charMap.coordsAtPos(head, ctx.page);
  return coords ? { type: "caret", x: coords.x, y: coords.y, height: coords.height } : null;
}

/** Fill geometry shared by text, all-document, and the fallback. */
function fillGeometry(
  from: number,
  to: number,
  ctx: SelectionGeometryContext,
): SelectionPrimitive[] {
  const rects = rangeFillRects(from, to, ctx.page, ctx.charMap);
  return rects.length ? [{ type: "fill", rects, role: "selection" }] : [];
}

export const textSelectionBehavior: SelectionBehavior<TextSelection> = {
  kind: "text",
  matches: (s): s is TextSelection => s instanceof TextSelection,
  describe: (s, ctx: SelectionDescribeContext) => ({
    kind: "text",
    surfaceId: ctx.surfaceId,
    empty: s.empty,
    capabilities: {
      copy: !s.empty,
      cut: !s.empty,
      delete: !s.empty,
      formatText: true,
      drag: false,
      resize: false,
    },
    anchor: s.anchor,
    head: s.head,
    from: s.from,
    to: s.to,
  }),
  geometry: (s, ctx) => {
    const out = s.empty ? [] : fillGeometry(s.from, s.to, ctx);
    const caret = caretPrimitive(s.head, ctx);
    if (caret) out.push(caret);
    return out;
  },
};

export const nodeSelectionBehavior: SelectionBehavior<NodeSelection> = {
  kind: "node",
  matches: (s): s is NodeSelection => s instanceof NodeSelection,
  describe: (s, ctx: SelectionDescribeContext) => {
    const isImage = s.node.type.name === "image";
    return {
      kind: "node",
      surfaceId: ctx.surfaceId,
      empty: false,
      capabilities: {
        copy: true,
        cut: true,
        delete: true,
        formatText: false,
        drag: isImage,
        resize: isImage,
      },
      anchor: s.anchor,
      head: s.head,
      from: s.from,
      to: s.to,
    };
  },
  geometry: (s, ctx) => {
    // Only images draw selection chrome today. The resize ghost during a drag is
    // transient pointer state and stays in TileManager, not here.
    if (s.node.type.name !== "image") return [];
    const r = ctx.nodeRectAt(s.from);
    if (!r || r.page !== ctx.page) return [];
    const rect = { x: r.x, y: r.y, width: r.width, height: r.height };
    return [
      { type: "outline", rect, width: 1.5, role: "affordance" },
      {
        type: "handles",
        handles: getHandles(r.x, r.y, r.width, r.height).map((h) => ({
          x: h.hx,
          y: h.hy,
          cursor: h.cursor,
        })),
        role: "affordance",
      },
    ];
  },
};

export const allSelectionBehavior: SelectionBehavior<AllSelection> = {
  kind: "all",
  matches: (s): s is AllSelection => s instanceof AllSelection,
  describe: (s, ctx: SelectionDescribeContext) => ({
    kind: "all",
    surfaceId: ctx.surfaceId,
    empty: false,
    capabilities: {
      copy: true,
      cut: true,
      delete: true,
      formatText: true,
      drag: false,
      resize: false,
    },
    anchor: s.anchor,
    head: s.head,
    from: s.from,
    to: s.to,
  }),
  geometry: (s, ctx) => fillGeometry(s.from, s.to, ctx),
};

/**
 * Fallback for any selection kind no behavior matched (e.g. a Seraa custom
 * node's selection). Describes generically and paints a best-effort text-style
 * fill so the selection is at least visible and copyable — never invisible or
 * a thrown error.
 */
export const defaultSelectionBehavior: SelectionBehavior = {
  kind: "custom",
  matches: (_s): _s is Selection => true,
  describe: (s, ctx: SelectionDescribeContext) => ({
    kind: "custom",
    surfaceId: ctx.surfaceId,
    empty: s.empty,
    capabilities: {
      copy: !s.empty,
      cut: !s.empty,
      delete: !s.empty,
      formatText: false,
      drag: false,
      resize: false,
    },
    anchor: s.anchor,
    head: s.head,
    from: s.from,
    to: s.to,
  }),
  geometry: (s, ctx) => fillGeometry(s.from, s.to, ctx),
};

/** Core built-ins, in resolution order (extensions are prepended by the Editor). */
export const builtinSelectionBehaviors: SelectionBehavior[] = [
  textSelectionBehavior,
  nodeSelectionBehavior,
  allSelectionBehavior,
];
