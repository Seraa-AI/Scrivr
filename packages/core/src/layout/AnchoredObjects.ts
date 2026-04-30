import type { Node } from "prosemirror-model";

export const ANCHORED_OBJECT_MARGIN = 8;

/**
 * Wrap behaviour for an anchored object — Word's five wrap styles.
 * The current product set; v1 fully supports all five.
 *
 *   inline      — image is part of normal line layout (no anchor)
 *   square      — rectangular wrap zone at the image's painted rect;
 *                 text wraps around the image's actual position
 *   top-bottom  — full-width clearance; following content starts below
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
 * Per-image override of which side text wraps on around a `square`
 * image. `largest` (the v1 default) is wider-side wrap; `left` and
 * `right` force wrap on a specific side. `bothSides` is reserved for
 * F7 (deferred — single line straddling the image).
 */
export type WrapText = "largest" | "left" | "right" | "bothSides";

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
  wrapText: WrapText;
  margin: number;
}

interface RawImageAttrs {
  width?: unknown;
  height?: unknown;
  wrapMode?: unknown;
  positionMode?: unknown;
  xAlign?: unknown;
  x?: unknown;
  wrapText?: unknown;
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
 * `floatOffset` is intentionally discarded — `04-edit-ux.md` § Rule 4
 * retired the paint-only offset attribute. Position changes go through
 * `xAlign` / `x`. Legacy values written by older versions are silently
 * dropped on read; PM round-trip preserves them in the doc but layout
 * ignores them.
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
    wrapText: resolveWrapText(a.wrapText),
    margin: numberOrDefault(a.margin, ANCHORED_OBJECT_MARGIN),
  };
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
  // New attrs are authoritative only when `wrapMode` is explicitly
  // non-default. Otherwise the schema-default `xAlign: "left"` would
  // hide the legacy `wrappingMode: "square-right"` mapping. Keep the
  // resolution rule symmetric with `resolveWrapMode`.
  if (isWrapMode(a.wrapMode) && a.wrapMode !== "inline") {
    return isXAlign(a.xAlign) ? a.xAlign : "left";
  }
  if (a.wrappingMode === "square-right") return "right";
  return isXAlign(a.xAlign) ? a.xAlign : "left";
}

function resolveCustomX(a: RawImageAttrs): number | null {
  if (typeof a.x === "number" && Number.isFinite(a.x)) return a.x;
  return null;
}

function resolveWrapText(value: unknown): WrapText {
  if (
    value === "largest" ||
    value === "left" ||
    value === "right" ||
    value === "bothSides"
  ) {
    return value;
  }
  return "largest";
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
 * Clamped so the image stays entirely inside the content area
 * regardless of `xAlign` or `x` value.
 */
export function resolveImageX(
  attrs: Pick<NormalizedImageAttrs, "width" | "xAlign" | "x">,
  contentX: number,
  contentWidth: number,
): number {
  const maxX = contentX + Math.max(0, contentWidth - attrs.width);

  let x: number;
  switch (attrs.xAlign) {
    case "left":
      x = contentX;
      break;
    case "center":
      x = contentX + Math.max(0, (contentWidth - attrs.width) / 2);
      break;
    case "right":
      x = maxX;
      break;
    case "custom":
      x = attrs.x ?? contentX;
      break;
  }
  return clamp(x, contentX, maxX);
}

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

// ── Solver / layout types ───────────────────────────────────────────────────

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
  node: Node;
  anchorGlobalY: number;
  anchorPage: number;
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
  wrapText: WrapText;
  anchorDocPos: number;
}

export interface FlowClearance {
  afterFlowIndex: number;
  y: number;
  anchorDocPos: number;
}

export interface AnchoredObjectSolverResult {
  placements: AnchoredObjectPlacement[];
  wrapZones: WrapZone[];
  clearances: FlowClearance[];
  status: "stable" | "exhausted";
  iterations: number;
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
