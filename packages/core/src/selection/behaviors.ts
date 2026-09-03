import { TextSelection, NodeSelection, AllSelection, type Selection } from "prosemirror-state";
import type { Node } from "prosemirror-model";
import type { GlyphEntry, LineEntry } from "../layout/CharacterMap";

declare module "prosemirror-model" {
  interface NodeSpec {
    /**
     * The node paints its own selection wash (e.g. a table washing its cells),
     * so a text/range selection that fully contains it should NOT draw per-glyph
     * bands over its interior — its owner fills it instead. Opt-in: a plain
     * isolating node without this keeps normal text bands (no visual hole).
     */
    selectionWash?: boolean;
  }
}
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

/**
 * One full-height band rect per selected line (Word/Docs style), not per glyph:
 *   - first line   → from the selection start x to the right margin,
 *   - middle lines → the whole content width,
 *   - last line    → from the left margin to the selection end x.
 * Bands are line-height tall, so they read as continuous columns and cover
 * inline atoms and block atoms (image, HR, page break — lines with no glyphs but
 * real height) instead of leaving ragged glyph-only fills.
 */
export function rangeBandRects(
  from: number,
  to: number,
  glyphs: readonly GlyphEntry[],
  lines: readonly LineEntry[],
): SelectionRect[] {
  const byLine = new Map<number, GlyphEntry[]>();
  for (const g of glyphs) {
    const arr = byLine.get(g.lineIndex);
    if (arr) arr.push(g);
    else byLine.set(g.lineIndex, [g]);
  }

  const rects: SelectionRect[] = [];
  for (const line of lines) {
    if (line.height <= 0) continue;
    const startsBefore = from <= line.startDocPos; // selection began on an earlier line
    const endsAfter = to > line.endDocPos; // selection continues to a later line
    const rightMargin = line.x + line.contentWidth;

    const glyphs = byLine.get(line.lineIndex);
    let left: number;
    let right: number;
    if (glyphs && glyphs.length) {
      glyphs.sort((a, b) => a.x - b.x);
      const last = glyphs[glyphs.length - 1]!;
      left = startsBefore ? line.x : glyphs[0]!.x;
      right = endsAfter ? rightMargin : last.x + last.width;
    } else {
      // A line with no selected glyphs (empty paragraph, or a block atom like an
      // HR / block image). Fully covered → full-width band, so a block atom that
      // the selection ends exactly at still fills. Otherwise (an empty paragraph
      // the selection only just touches) → a line-height square.
      const fullyInside = from <= line.startDocPos && to >= line.endDocPos;
      left = line.x;
      right = fullyInside ? rightMargin : line.x + line.height;
    }

    if (right > left) rects.push({ x: left, y: line.y, width: right - left, height: line.height });
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

/**
 * Content ranges of self-washing nodes (`selectionWash: true`, e.g. tables) that
 * the selection fully contains. A text selection defers the *inside* of such a
 * node to its owner's wash, so per-glyph text bands don't paint over (and double
 * up on) it. Deferral is opt-in per node — a plain isolating node without the
 * flag keeps its text bands rather than becoming a visual hole.
 */
function fullyContainedSelfWashedRanges(
  doc: Node,
  from: number,
  to: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.spec.selectionWash && from <= pos && to >= pos + node.nodeSize) {
      out.push([pos, pos + node.nodeSize]);
      return false; // don't descend — the whole node is deferred
    }
    return true;
  });
  return out;
}

/** Fill geometry shared by text, all-document, and the fallback. */
function fillGeometry(
  from: number,
  to: number,
  ctx: SelectionGeometryContext,
): SelectionPrimitive[] {
  const deferred = fullyContainedSelfWashedRanges(ctx.state.doc, from, to);
  const inside = (pos: number): boolean => deferred.some(([a, b]) => pos >= a && pos < b);
  const glyphs = ctx.charMap
    .glyphsInRange(from, to)
    .filter((g) => g.page === ctx.page && !inside(g.docPos));
  const lines = ctx.charMap
    .linesInRange(from, to)
    .filter((l) => l.page === ctx.page && !inside(l.startDocPos));
  const rects = rangeBandRects(from, to, glyphs, lines);
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
      cut: !ctx.readOnly && !s.empty,
      delete: !ctx.readOnly && !s.empty,
      formatText: !ctx.readOnly,
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

/**
 * Generic fallback for a `NodeSelection` no extension claimed. Outlines the node
 * so the selection is visible; it is not draggable/resizable by default. An
 * extension whose node supports those (e.g. Image) registers its own behavior,
 * which resolves first and adds handles + the `resize`/`drag` capabilities.
 */
export const nodeSelectionBehavior: SelectionBehavior<NodeSelection> = {
  kind: "node",
  matches: (s): s is NodeSelection => s instanceof NodeSelection,
  describe: (s, ctx: SelectionDescribeContext) => ({
    kind: "node",
    surfaceId: ctx.surfaceId,
    empty: false,
    capabilities: {
      copy: true,
      cut: !ctx.readOnly,
      delete: !ctx.readOnly,
      formatText: false,
      drag: false,
      resize: false,
    },
    anchor: s.anchor,
    head: s.head,
    from: s.from,
    to: s.to,
  }),
  geometry: (s, ctx) => {
    const r = ctx.nodeRectAt(s.from);
    if (!r || r.page !== ctx.page) return [];
    return [
      { type: "outline", rect: { x: r.x, y: r.y, width: r.width, height: r.height }, width: 1.5, role: "affordance" },
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
      cut: !ctx.readOnly,
      delete: !ctx.readOnly,
      formatText: !ctx.readOnly,
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
      cut: !ctx.readOnly && !s.empty,
      delete: !ctx.readOnly && !s.empty,
      formatText: false,
      drag: false,
      resize: false,
    },
    anchor: s.anchor,
    head: s.head,
    from: s.from,
    to: s.to,
  }),
  geometry: (s, ctx) => {
    // Best-effort: fill when it's a range, else a caret — never fully invisible.
    const out = s.empty ? [] : fillGeometry(s.from, s.to, ctx);
    const caret = caretPrimitive(s.head, ctx);
    if (caret) out.push(caret);
    return out;
  },
};

/** Core built-ins, in resolution order (extensions are prepended by the Editor). */
export const builtinSelectionBehaviors: SelectionBehavior[] = [
  textSelectionBehavior,
  nodeSelectionBehavior,
  allSelectionBehavior,
];
