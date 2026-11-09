import type { Node } from "prosemirror-model";
import type { LayoutLine } from "./LineBreaker";

// Default breathing room around an anchored object's exclusion rect, in px.
// Word's "Square" / "Tight" wrap defaults are ~0.13" ≈ 12px; matching that
// gives visible space between text and image at typical reading sizes.
// 8px (the previous default) was tight enough that text appeared flush
// against the image's visible pixels.
export const ANCHORED_OBJECT_MARGIN = 12;

/**
 * Wrap behaviour for an anchored object — Word's five wrap styles.
 * The current product set; v1 fully supports all five.
 *
 *   inline      — image is part of normal line layout (no anchor)
 *   square      — rectangular wrap zone at the image's painted rect;
 *                 text wraps around the image's actual position
 *   top-bottom  — full-width flow block; following content starts below
 *   behind      — flow block, no wrap, painted behind text
 *   front       — flow block, no wrap, painted over text
 */
export type WrapMode = "inline" | "square" | "top-bottom" | "behind" | "front";

/**
 * Position behaviour. v1 supports `move-with-text` only — the image's
 * vertical position is its anchor's flow position. `fix-on-page` is
 * deferred (see `docs/anchored-objects/05-future.md` § F1 / F3).
 */
export type PositionMode = "move-with-text";

/**
 * Horizontal placement intent. `"custom"` means use the explicit `x`
 * attribute; the named values resolve via `resolveImageX` below.
 */
export type XAlign = "left" | "center" | "right" | "custom";

/**
 * The legacy single-mode attribute kept for backward compatibility
 * with documents created before the `wrapMode` + `xAlign` split.
 * Read-only — layout never branches on these directly; they are
 * mapped to the new model by `normalizeImageAttrs`.
 */
export type LegacyWrappingMode =
  | "inline"
  | "square-left"
  | "square-right"
  | "top-bottom"
  | "behind"
  | "front";

/**
 * The fully-resolved image attributes used by every layout consumer.
 * Produced by `normalizeImageAttrs` from a PM node's raw attrs;
 * legacy `wrappingMode` / `floatOffset` fields are mapped here so
 * the rest of the engine never branches on them.
 */
export interface NormalizedImageAttrs {
  width: number;
  height: number;
  wrapMode: WrapMode;
  positionMode: PositionMode;
  xAlign: XAlign;
  /** Set only when `xAlign === "custom"`. Content-area-relative px. */
  x: number | null;
  /**
   * Vertical placement delta from the anchor flow's globalY, in px.
   * `imageRect.y = anchorFlow.globalY + yOffset` is the single source of
   * truth for paint, exclusion, hit-test, and PDF. Default `0` is invisible
   * — pre-yOffset documents render identically.
   */
  yOffset: number;
  zIndex: number;
  margin: number;
}

interface RawImageAttrs {
  width?: unknown;
  height?: unknown;
  wrapMode?: unknown;
  positionMode?: unknown;
  xAlign?: unknown;
  x?: unknown;
  yOffset?: unknown;
  zIndex?: unknown;
  margin?: unknown;
  // Legacy
  wrappingMode?: unknown;
  floatOffset?: unknown;
}

/**
 * Resolves a PM image node's raw attrs into the canonical
 * NormalizedImageAttrs. Read-side mapping — the PM document is
 * never mutated by this function. Layout, hit testing, drag, and
 * exporters all read attrs through this function so legacy
 * documents continue to render correctly without rewriting the doc.
 *
 * Resolution order:
 *   1. If new attrs (`wrapMode` / `xAlign`) are set to non-default
 *      values, they are authoritative.
 *   2. Otherwise legacy `wrappingMode` is mapped:
 *        "square-left"  → wrapMode: "square", xAlign: "left"
 *        "square-right" → wrapMode: "square", xAlign: "right"
 *        anything else  → matching wrapMode, default xAlign
 *   3. Defaults if neither is set: inline, left, no x.
 *
 * Legacy `floatOffset.y` is folded into structural `yOffset` on read
 * (see `06-yoffset-redesign.md` § Phase 1). `floatOffset.x` is discarded
 * — horizontal placement goes through `xAlign` / `x`. PM round-trip
 * preserves the legacy attr in the doc but layout reads only `yOffset`.
 */
export function normalizeImageAttrs(node: Node): NormalizedImageAttrs {
  const a = node.attrs as RawImageAttrs;

  return {
    width: numberOrDefault(a.width, 200),
    height: numberOrDefault(a.height, 200),
    wrapMode: resolveWrapMode(a),
    positionMode: "move-with-text",
    xAlign: resolveXAlign(a),
    x: resolveCustomX(a),
    yOffset: resolveYOffset(a),
    zIndex: numberOrDefault(a.zIndex, 0),
    margin: numberOrDefault(a.margin, ANCHORED_OBJECT_MARGIN),
  };
}

/**
 * Resolve the structural `yOffset` from raw attrs. A non-zero `yOffset`
 * is authoritative. The schema default of `0` is ambiguous (could be
 * "unset" on a legacy doc or "user reset" on a new doc), so we fall back
 * to the legacy `floatOffset.y`. New code should always write `yOffset`
 * directly and never rely on `floatOffset` being preserved.
 */
function resolveYOffset(a: RawImageAttrs): number {
  if (typeof a.yOffset === "number" && Number.isFinite(a.yOffset) && a.yOffset !== 0) {
    return a.yOffset;
  }
  return getLegacyFloatOffsetY(a);
}

/**
 * Read `floatOffset.y` from a legacy image node without an `as` cast.
 * Returns 0 if the attribute is absent or malformed. Used as the fallback
 * source for `yOffset` so documents written before Phase 1 keep their
 * vertical placement.
 */
function getLegacyFloatOffsetY(a: RawImageAttrs): number {
  const fo = a.floatOffset;
  if (fo === null || typeof fo !== "object") return 0;
  if (!("y" in fo)) return 0;
  const y = (fo as { y: unknown }).y;
  return typeof y === "number" && Number.isFinite(y) ? y : 0;
}

function resolveWrapMode(a: RawImageAttrs): WrapMode {
  if (isWrapMode(a.wrapMode) && a.wrapMode !== "inline") return a.wrapMode;
  switch (a.wrappingMode) {
    case "square-left":
    case "square-right":
      return "square";
    case "top-bottom":
    case "behind":
    case "front":
      return a.wrappingMode;
    default:
      return isWrapMode(a.wrapMode) ? a.wrapMode : "inline";
  }
}

function resolveXAlign(a: RawImageAttrs): XAlign {
  // Hard precedence: an explicit non-default xAlign always wins. Drag and
  // toolbar commits set `xAlign` directly (e.g. "custom" + a numeric `x`);
  // the legacy `wrappingMode: "square-right"` branch below would otherwise
  // shadow that and pin the image at the page's right edge after every drag.
  // Schema-default "left" stays ambiguous (could be explicit or default), so
  // it falls through to the legacy/default branches below.
  if (isXAlign(a.xAlign) && a.xAlign !== "left") {
    return a.xAlign;
  }
  // wrapMode-explicit nodes use their xAlign as-is (default-or-explicit "left").
  if (isWrapMode(a.wrapMode) && a.wrapMode !== "inline") {
    return "left";
  }
  // Legacy fallback for documents written before the wrapMode/xAlign split.
  if (a.wrappingMode === "square-right") return "right";
  return "left";
}

function resolveCustomX(a: RawImageAttrs): number | null {
  if (typeof a.x === "number" && Number.isFinite(a.x)) return a.x;
  return null;
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isWrapMode(value: unknown): value is WrapMode {
  return (
    value === "inline" ||
    value === "square" ||
    value === "top-bottom" ||
    value === "behind" ||
    value === "front"
  );
}

function isXAlign(value: unknown): value is XAlign {
  return (
    value === "left" ||
    value === "center" ||
    value === "right" ||
    value === "custom"
  );
}

/**
 * Resolves the painted X (in page coordinates) from the normalized
 * placement attributes. Single expression for every non-inline mode.
 *
 * Named alignments (`left`/`center`/`right`) snap to content bounds —
 * the typography convention and Word's default "Margin" horizontal anchor.
 * `xAlign: "custom"` is the user's free-positioning result (drag commit),
 * measured from the content area's left edge as Word's `relativeFrom="column"`
 * is. It clamps to *page* bounds so the image can hang into the left or right
 * margin without escaping the page. Top/bottom margins are not relaxed
 * because headers and footers live there.
 */
export function resolveImageX(
  attrs: Pick<NormalizedImageAttrs, "width" | "xAlign" | "x">,
  contentX: number,
  contentWidth: number,
  pageWidth: number,
): number {
  const contentMaxX = contentX + Math.max(0, contentWidth - attrs.width);

  switch (attrs.xAlign) {
    case "left":
      return contentX;
    case "center":
      return contentX + Math.max(0, (contentWidth - attrs.width) / 2);
    case "right":
      return contentMaxX;
    case "custom": {
      const pageMaxX = Math.max(0, pageWidth - attrs.width);
      return clamp(contentX + (attrs.x ?? 0), 0, pageMaxX);
    }
  }
}

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

// ── Solver / layout types ───────────────────────────────────────────────────

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Where a square image goes when it would overlap one placed before it, as
 * Word does with `allowOverlap="0"`: beside that image while the column has
 * room, on the side it is aligned from, otherwise below it with `gap`.
 */
export function clearOfEarlier(
  image: Box,
  earlier: readonly Box[],
  contentX: number,
  contentRight: number,
  gap: number,
): { x: number; y: number } {
  let at = { ...image };
  const fromRight = image.x + image.width / 2 > (contentX + contentRight) / 2;
  for (let attempt = 0; attempt <= earlier.length * 2; attempt++) {
    const hit = earlier.find((other) => boxesOverlap(at, other));
    if (!hit) return { x: at.x, y: at.y };
    const beside = fromRight ? hit.x - at.width : hit.x + hit.width;
    const besideFits = beside >= contentX && beside + at.width <= contentRight;
    at = besideFits ? { ...at, x: beside } : { ...at, x: image.x, y: hit.y + hit.height + gap };
  }
  return { x: at.x, y: at.y };
}

/** An anchored image found where its anchor sits in the text. */
export interface AnchorRef {
  docPos: number;
  node: Node;
  attrs: NormalizedImageAttrs;
}

/** The anchored images whose anchors sit in `lines`: zero-width object spans that are not inline. */
export function anchorsInLines(lines: readonly LayoutLine[]): AnchorRef[] {
  const anchors: AnchorRef[] = [];
  for (const line of lines) {
    for (const span of line.spans) {
      if (span.kind !== "object" || span.width !== 0) continue;
      const attrs = normalizeImageAttrs(span.node);
      if (attrs.wrapMode === "inline") continue;
      anchors.push({ docPos: span.docPos, node: span.node, attrs });
    }
  }
  return anchors;
}

export interface AnchoredObjectInput {
  docPos: number;
  node: Node;
  attrs: NormalizedImageAttrs;
  anchorFlowIndex: number;
  anchorGlobalY: number;
}

export interface AnchoredObjectPlacement {
  docPos: number;
  page: number;
  /** Painted left edge in page-local coordinates. */
  x: number;
  /** Painted top edge in page-local coordinates. */
  y: number;
  width: number;
  height: number;
  wrapMode: WrapMode;
  zIndex: number;
  node: Node;
  /**
   * Anchor flow's globalY the placement was measured from (post anchor-push);
   * for a float locked with no fixed point, where it was when it locked.
   * The drag snapshot reads this; do not use for paint or exclusion.
   */
  anchorGlobalY: number;
  anchorPage: number;
  /**
   * Painted top in continuous global-Y: `anchorGlobalY + yOffset`, clamped to
   * the anchor's page, plus `stackOffset`. Single source of truth for paint
   * coords, exclusion rects, hit-testing, and PDF export.
   */
  globalY: number;
  /**
   * How far the solver moved the image down so it does not overlap a square
   * float placed before it; the user's `yOffset` does not include it. A drag
   * commits where the image was dropped, so the stack offset is absorbed
   * there and re-applies only if the image still overlaps. Absent when the
   * image is not stacked.
   */
  stackOffset?: number;
  /**
   * True if the user-set `yOffset` was clamped to keep the image on its
   * anchor's page. Drag overlay reads this to render an explicit boundary
   * indicator (Phase 2). Absent/false when no clamp was applied.
   */
  clamped?: boolean;
  /**
   * The table cell holding the image's anchor, laid out inside that cell as
   * Word's `layoutInCell` does. Absent for an image anchored in the body.
   */
  cellPos?: number;
}

/**
 * Rectangular wrap zone produced by a `square` placement. Coordinates
 * are in continuous global-Y space; LineBreaker resolves per-line
 * availability against this rectangle plus content area bounds.
 */
export interface WrapZone {
  /** zone left edge (image left - margin) */
  x: number;
  /** zone right edge (image right + margin) */
  right: number;
  /** zone top in continuous global-Y */
  top: number;
  /** zone bottom in continuous global-Y */
  bottom: number;
  anchorDocPos: number;
}

export interface AnchoredObjectSolverResult {
  placements: AnchoredObjectPlacement[];
  wrapZones: WrapZone[];
  status: "stable" | "exhausted";
  iterations: number;
}

export function compareAnchoredObjectPaintOrder(
  a: Pick<AnchoredObjectPlacement, "zIndex" | "docPos">,
  b: Pick<AnchoredObjectPlacement, "zIndex" | "docPos">,
): number {
  return a.zIndex - b.zIndex || a.docPos - b.docPos;
}

export function compareAnchoredObjectHitOrder(
  a: Pick<AnchoredObjectPlacement, "zIndex" | "docPos">,
  b: Pick<AnchoredObjectPlacement, "zIndex" | "docPos">,
): number {
  return b.zIndex - a.zIndex || b.docPos - a.docPos;
}

/** Type guard: is the value one of the v1 wrap modes? */
export function isWrapModeValue(value: unknown): value is WrapMode {
  return isWrapMode(value);
}

/** Type guard: is the value one of the legacy wrappingMode values? */
export function isLegacyWrappingMode(value: unknown): value is LegacyWrappingMode {
  return (
    value === "inline" ||
    value === "square-left" ||
    value === "square-right" ||
    value === "top-bottom" ||
    value === "behind" ||
    value === "front"
  );
}
