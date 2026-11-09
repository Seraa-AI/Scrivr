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
 * mapped to the new model by the image's `anchored` declaration.
 */
export type LegacyWrappingMode =
  | "inline"
  | "square-left"
  | "square-right"
  | "top-bottom"
  | "behind"
  | "front";

/**
 * How an anchored object is placed: what a node spec's `anchored` declares
 * for a node, resolved. Every layout, hit-test, drag and export consumer reads
 * it through `anchoredOf`, so the engine never reads an object's raw attrs.
 */
export interface AnchoredPlacement {
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
  attrs: Pick<AnchoredPlacement, "width" | "xAlign" | "x">,
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
  attrs: AnchoredPlacement;
}

/** The anchored images whose anchors sit in `lines`: zero-width object spans that are not inline. */
export function anchorsInLines(lines: readonly LayoutLine[]): AnchorRef[] {
  const anchors: AnchorRef[] = [];
  for (const line of lines) {
    for (const span of line.spans) {
      if (span.kind !== "object" || span.width !== 0) continue;
      const attrs = anchoredOf(span.node);
      if (!attrs || attrs.wrapMode === "inline") continue;
      anchors.push({ docPos: span.docPos, node: span.node, attrs });
    }
  }
  return anchors;
}

export interface AnchoredObjectInput {
  docPos: number;
  node: Node;
  attrs: AnchoredPlacement;
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

/** Type guard: is the value one of the horizontal alignments? */
export function isXAlignValue(value: unknown): value is XAlign {
  return isXAlign(value);
}

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const isPositionMode = (value: unknown): value is PositionMode => value === "move-with-text";

function isAnchoredPlacement(value: unknown): value is AnchoredPlacement {
  return typeof value === "object" && value !== null
    && "width" in value && isFiniteNumber(value.width) && value.width > 0
    && "height" in value && isFiniteNumber(value.height) && value.height > 0
    && "wrapMode" in value && isWrapMode(value.wrapMode)
    && "positionMode" in value && isPositionMode(value.positionMode)
    && "xAlign" in value && isXAlign(value.xAlign)
    && "x" in value && (value.x === null || isFiniteNumber(value.x))
    && "yOffset" in value && isFiniteNumber(value.yOffset)
    && "zIndex" in value && isFiniteNumber(value.zIndex)
    && "margin" in value && isFiniteNumber(value.margin);
}

/** The placement fields a gesture changes: a drag, a resize, a return to the line. */
export type PlacementPatch = Partial<Pick<AnchoredPlacement, "width" | "height" | "wrapMode" | "xAlign" | "x" | "yOffset">>;

/**
 * How a node is placed as an anchored object, both ways: what a node spec's
 * `anchored` declares. `read` resolves its attrs into a placement; `write`
 * turns a placement patch into the attrs that store it. Both must be pure and
 * must not throw: layout, hit-testing and every gesture call them.
 */
export interface AnchoredSpec {
  read(node: Node): AnchoredPlacement | null;
  write(patch: PlacementPatch): Record<string, unknown>;
}

function anchoredSpecOf(node: Node): AnchoredSpec | null {
  const declared: unknown = node.type.spec["anchored"];
  if (typeof declared !== "object" || declared === null) return null;
  if (!("read" in declared) || typeof declared.read !== "function") return null;
  if (!("write" in declared) || typeof declared.write !== "function") return null;
  const { read, write } = declared;
  return {
    read: (n) => {
      const placement: unknown = read(n);
      return isAnchoredPlacement(placement) ? placement : null;
    },
    write: (patch) => {
      const attrs: unknown = write(patch);
      return typeof attrs === "object" && attrs !== null ? { ...attrs } : {};
    },
  };
}

/**
 * How a node is placed as an anchored object, as its spec's `anchored`
 * declares it; null for a node that declares none, or a placement that does
 * not hold up. A placement whose `wrapMode` is `inline` sits in its line.
 */
export function anchoredOf(node: Node): AnchoredPlacement | null {
  return anchoredSpecOf(node)?.read(node) ?? null;
}

/** The attrs that store `patch` on `node`, through its declaration; null for a node that declares none. */
export function placementAttrs(node: Node, patch: PlacementPatch): Record<string, unknown> | null {
  return anchoredSpecOf(node)?.write(patch) ?? null;
}

/** Whether a node floats: it declares a placement, and not an inline one. */
export function floats(node: Node): boolean {
  const placement = anchoredOf(node);
  return placement !== null && placement.wrapMode !== "inline";
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
