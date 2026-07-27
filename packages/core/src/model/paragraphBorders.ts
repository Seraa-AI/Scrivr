/**
 * Paragraph borders & shading — the semantic model.
 *
 * A paragraph border is formatting on the paragraph node (OOXML `w:pBdr`), not
 * an independent line or box. This module owns the value types plus the runtime
 * guards that keep untrusted input (paste, DOCX import, collab) shaped —
 * layout/render/export all consume the normalized values, never raw attrs.
 *
 * Units are CSS pixels to match the layout engine; OOXML eighths-of-point /
 * whole-point conversion happens only at the DOCX seam. See
 * `docs/paragraph-borders-rfc.md`.
 */

export type BorderLineStyle =
  | "none"
  | "single"
  | "double"
  | "dotted"
  | "dashed"
  | "dashSmallGap"
  | "dotDash"
  | "dotDotDash";

const BORDER_LINE_STYLES: readonly BorderLineStyle[] = [
  "none",
  "single",
  "double",
  "dotted",
  "dashed",
  "dashSmallGap",
  "dotDash",
  "dotDotDash",
];

export function isBorderLineStyle(value: unknown): value is BorderLineStyle {
  return (
    typeof value === "string" &&
    (BORDER_LINE_STYLES as readonly string[]).includes(value)
  );
}

export interface ParagraphBorderSide {
  style: BorderLineStyle;
  /** Stroke width in px. */
  width: number;
  /** Resolved CSS color. */
  color: string;
  /** Inner-edge → content padding in px. Ignored by layout for `between`. */
  space: number;
  shadow?: boolean;
  /**
   * OOXML distinguishes `none` and `nil` — both render as absent but carry
   * different override intent. Preserved so an untouched side round-trips.
   */
  sourceStyle?: "none" | "nil";
}

/** The four physical box edges, plus the two special borders. */
export type ParagraphBorderEdge = keyof ParagraphBorders;

export interface ParagraphBorders {
  top?: ParagraphBorderSide;
  right?: ParagraphBorderSide;
  bottom?: ParagraphBorderSide;
  left?: ParagraphBorderSide;
  /**
   * Between consecutive same-bordered paragraphs. Its *presence* is the
   * grouping signal (even when `style` is `none`/`nil`); its `space` is
   * preserved for round-trip but ignored by layout. Grouping ships in Phase 2.
   */
  between?: ParagraphBorderSide;
  /** Vertical bar outside the paragraph. Rendering ships in Phase 3. */
  bar?: ParagraphBorderSide;
}

const BORDER_EDGES: readonly ParagraphBorderEdge[] = [
  "top",
  "right",
  "bottom",
  "left",
  "between",
  "bar",
];

export interface ParagraphShading {
  fill: string;
}

/**
 * Validate an unknown value into a `ParagraphBorderSide`, or `undefined` if it
 * is not a usable side. The single `as` is after a `typeof`/null guard.
 */
export function normalizeBorderSide(
  value: unknown,
): ParagraphBorderSide | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const o = value as Record<string, unknown>;

  const style = o["style"];
  if (!isBorderLineStyle(style)) return undefined;

  const width =
    typeof o["width"] === "number" && Number.isFinite(o["width"])
      ? Math.max(0, o["width"])
      : 0;
  const space =
    typeof o["space"] === "number" && Number.isFinite(o["space"])
      ? Math.max(0, o["space"])
      : 0;
  const color = typeof o["color"] === "string" ? o["color"] : "#000000";

  const side: ParagraphBorderSide = { style, width, color, space };
  if (o["shadow"] === true) side.shadow = true;
  if (o["sourceStyle"] === "none" || o["sourceStyle"] === "nil")
    side.sourceStyle = o["sourceStyle"];
  return side;
}

/** True if any edge carries a border. */
export function hasAnyBorders(borders: ParagraphBorders): boolean {
  return BORDER_EDGES.some((edge) => borders[edge] !== undefined);
}

/**
 * Validate an unknown value into `ParagraphBorders`, dropping invalid edges.
 * Returns `null` when nothing valid remains so the attr collapses cleanly.
 */
export function normalizeParagraphBorders(
  value: unknown,
): ParagraphBorders | null {
  if (value === null || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;

  const out: ParagraphBorders = {};
  for (const edge of BORDER_EDGES) {
    const side = normalizeBorderSide(o[edge]);
    if (side) out[edge] = side;
  }
  return hasAnyBorders(out) ? out : null;
}

export function normalizeShading(value: unknown): ParagraphShading | null {
  if (value === null || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  return typeof o["fill"] === "string" && o["fill"] ? { fill: o["fill"] } : null;
}

/**
 * Set or clear one edge without disturbing the others. Toggling a single side
 * must never replace the whole object. Collapses to `null` when empty.
 */
export function mergeBorderSide(
  current: ParagraphBorders | null,
  edge: ParagraphBorderEdge,
  side: ParagraphBorderSide | undefined,
): ParagraphBorders | null {
  const next: ParagraphBorders = { ...(current ?? {}) };
  if (side) next[edge] = side;
  else delete next[edge];
  return hasAnyBorders(next) ? next : null;
}

// ── DOM serialization (clipboard / HTML / a11y only) ─────────────────────────

export function serializeParagraphBorders(
  borders: ParagraphBorders | null,
): string | undefined {
  return borders ? JSON.stringify(borders) : undefined;
}

export function parseParagraphBordersAttr(
  raw: string | null,
): ParagraphBorders | null {
  if (!raw) return null;
  try {
    return normalizeParagraphBorders(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function serializeParagraphShading(
  shading: ParagraphShading | null,
): string | undefined {
  return shading ? JSON.stringify(shading) : undefined;
}

export function parseParagraphShadingAttr(
  raw: string | null,
): ParagraphShading | null {
  if (!raw) return null;
  try {
    return normalizeShading(JSON.parse(raw));
  } catch {
    return null;
  }
}

// ── Presets ──────────────────────────────────────────────────────────────────

/** Word's default direct-formatting border: a thin single black line. */
export const DEFAULT_PARAGRAPH_BORDER: ParagraphBorderSide = {
  style: "single",
  width: 1,
  color: "#000000",
  space: 4,
};

/** All four outer edges with the given side (default: the standard border). */
export function outsideBorders(
  side: ParagraphBorderSide = DEFAULT_PARAGRAPH_BORDER,
): ParagraphBorders {
  return { top: side, right: side, bottom: side, left: side };
}
