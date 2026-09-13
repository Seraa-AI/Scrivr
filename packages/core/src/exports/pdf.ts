/**
 * The PDF mark lane's contract.
 *
 * It lives in core, as the DOCX handler types do, so an extension can describe
 * what its mark looks like in an export without depending on
 * `@scrivr/export-pdf` — which would be a cycle — and so the shape is checked
 * rather than accepted blindly. `@scrivr/export-pdf` augments the `pdf` key to
 * point here and owns the drawing.
 *
 * Nothing in here names pdf-lib. A mark says what it *means*; where the ink
 * goes is the renderer's, so two marks asking for an underline land on the
 * same line rather than each inventing its own geometry.
 */

import type { ResolvedTheme } from "../model/theme";
import type { Rgb } from "../model/cssColor";

/**
 * What a mark on a span is asking for. Colours must be supported CSS literals
 * (named, hex, RGB or HSL). Unsupported/invalid declarations are ignored;
 * they do not override earlier valid colours or theme defaults. CSS variables
 * must be resolved by the extension before returning a style.
 */
export interface PdfSpanStyle {
  /** A colour the author chose. Beats any `defaultColor` on the same span. */
  color?: string;
  /**
   * The colour this mark gives a span for being what it is — a link's blue.
   * Loses to an authored `color` whatever order the marks arrive in, which is
   * the cascade OOXML applies and what the canvas resolves to.
   */
  defaultColor?: string;
  underline?: boolean;
  /** Underline in this colour instead of following the text. */
  underlineColor?: string;
  strikethrough?: boolean;
  /**
   * Painted behind the glyphs, so an opaque colour still leaves its text
   * readable. Omit `opacity` to let the colour's own alpha carry it. An explicit
   * opacity replaces that alpha and must be finite and in [0, 1]; otherwise
   * this background is ignored. An unsupported colour also skips the background.
   */
  backgroundColor?: { color: string; opacity?: number };
  /**
   * Where this mark points. The span becomes clickable in the exported file.
   *
   * A reader following it has no base URL, so a target that only resolves
   * against one — a fragment, a relative path — is dropped rather than turned
   * into a hit area that does nothing. Targets are re-checked at the boundary
   * whatever the extension supplies.
   */
  link?: string;
}

/** One mark as it reaches an export, already flattened onto a span. */
export interface PdfSpanMark {
  name: string;
  attrs: Record<string, unknown>;
}

/**
 * What a mark handler is given. Drawing and document resources are confined to
 * node/chrome handlers and lifecycle hooks; mark handlers return style data.
 */
export interface PdfMarkContext {
  theme: ResolvedTheme;
}

/**
 * What this mark does to a span. Called once per mark, per span.
 *
 * A mark with no handler contributes nothing, silently — unlike an unclaimed
 * block, which warns. Weight, slant, size and family already travel in the
 * span's font string, so `bold` and its kin legitimately have no lane to
 * declare, and warning about them would bury the case that matters.
 */
export type PdfMarkHandler = (
  mark: PdfSpanMark,
  ctx: PdfMarkContext,
) => PdfSpanStyle;

// ── Drawing ─────────────────────────────────────────────────────────────────

/**
 * A font the exporter has already resolved. Opaque on purpose: a handler names
 * the font layout measured against and never learns what the format made of it.
 */
export interface PdfFontHandle {
  readonly cssFont: string;
}

/** An image the exporter has already embedded. Opaque for the same reason. */
export interface PdfImageHandle {
  readonly src: string;
}

/** A point in layout pixels, measured from the page's top-left. */
export interface PdfPoint {
  x: number;
  y: number;
}

/** A box in layout pixels, measured from the page's top-left. */
export interface PdfBox extends PdfPoint {
  width: number;
  height: number;
}

export interface PdfTextOp {
  text: string;
  /** Left edge of the run. */
  x: number;
  /**
   * The text's baseline, not its top — the line a reader would rule under it.
   * Layout gives a block's top and its ascent; the baseline is their sum.
   */
  baselineY: number;
  /** Font size in layout pixels. */
  sizePx: number;
  font: PdfFontHandle;
  color: Rgb;
  /** 0–1. Omit for opaque. */
  opacity?: number;
}

export interface PdfLineOp {
  from: PdfPoint;
  to: PdfPoint;
  /** Stroke width in layout pixels. */
  thicknessPx: number;
  color: Rgb;
  opacity?: number;
}

export interface PdfRectOp extends PdfBox {
  /** Omit for an unfilled rectangle. */
  color?: Rgb;
  opacity?: number;
}

export interface PdfImageOp extends PdfBox {
  image: PdfImageHandle;
  opacity?: number;
}

/**
 * The primitives a handler draws with. Every coordinate is layout pixels,
 * top-down; the implementation owns the conversion to PDF points and the flip
 * to a bottom-left origin, so a handler never performs either.
 */
export interface PdfDrawSurface {
  text(op: PdfTextOp): void;
  line(op: PdfLineOp): void;
  rect(op: PdfRectOp): void;
  image(op: PdfImageOp): void;
  /** The box drawn in place of an image that could not be resolved. */
  imagePlaceholder(box: PdfBox): void;
}
