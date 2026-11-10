/**
 * Where an image is placed: its raw attrs, legacy ones included, resolved into
 * the `AnchoredPlacement` the engine reads through `anchoredOf`. The image's
 * `anchored` declaration; no other code reads these attrs for placement.
 */
import type { Node } from "prosemirror-model";
import {
  ANCHORED_OBJECT_MARGIN,
  isWrapModeValue,
  isXAlignValue,
  type AnchoredPlacement,
  type PlacementPatch,
  type WrapMode,
  type XAlign,
} from "../../layout/AnchoredObjects";

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
 * Resolves an image node's raw attrs into its `AnchoredPlacement`: the
 * image's `anchored` declaration. Read-side mapping — the PM document is
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
export function imagePlacementOf(node: Node): AnchoredPlacement {
  const a: RawImageAttrs = node.attrs;

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
 * Read `floatOffset.y` from a legacy image node.
 * Returns 0 if the attribute is absent or malformed. Used as the fallback
 * source for `yOffset` so documents written before Phase 1 keep their
 * vertical placement.
 */
function getLegacyFloatOffsetY(a: RawImageAttrs): number {
  const fo = a.floatOffset;
  if (fo === null || typeof fo !== "object") return 0;
  if (!("y" in fo)) return 0;
  const y: unknown = fo.y;
  return typeof y === "number" && Number.isFinite(y) ? y : 0;
}

function resolveWrapMode(a: RawImageAttrs): WrapMode {
  if (isWrapModeValue(a.wrapMode) && a.wrapMode !== "inline") return a.wrapMode;
  switch (a.wrappingMode) {
    case "square-left":
    case "square-right":
      return "square";
    case "top-bottom":
    case "behind":
    case "front":
      return a.wrappingMode;
    default:
      return isWrapModeValue(a.wrapMode) ? a.wrapMode : "inline";
  }
}

function resolveXAlign(a: RawImageAttrs): XAlign {
  // Hard precedence: an explicit non-default xAlign always wins. Drag and
  // toolbar commits set `xAlign` directly (e.g. "custom" + a numeric `x`);
  // the legacy `wrappingMode: "square-right"` branch below would otherwise
  // shadow that and pin the image at the page's right edge after every drag.
  // Schema-default "left" stays ambiguous (could be explicit or default), so
  // it falls through to the legacy/default branches below.
  if (isXAlignValue(a.xAlign) && a.xAlign !== "left") {
    return a.xAlign;
  }
  // wrapMode-explicit nodes use their xAlign as-is (default-or-explicit "left").
  if (isWrapModeValue(a.wrapMode) && a.wrapMode !== "inline") {
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

/**
 * The image attrs that store a placement patch. A new wrap mode retires the
 * legacy `wrappingMode`, and a return to the line clears the legacy
 * `floatOffset` too, so the placement written is the one that shows.
 */
export function imagePlacementAttrs(patch: PlacementPatch): Record<string, unknown> {
  return {
    ...patch,
    ...(patch.wrapMode !== undefined ? { wrappingMode: "inline" } : {}),
    ...(patch.wrapMode === "inline" ? { floatOffset: { x: 0, y: 0 } } : {}),
  };
}
