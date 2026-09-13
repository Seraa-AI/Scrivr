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

/** What a mark on a span is asking for. Colours are CSS, as on the canvas. */
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
   * readable. Omit `opacity` to let the colour's own alpha carry it.
   */
  backgroundColor?: { color: string; opacity?: number };
}

/** One mark as it reaches an export, already flattened onto a span. */
export interface PdfSpanMark {
  name: string;
  attrs: Record<string, unknown>;
}

/**
 * What a mark handler is given. The full export context satisfies this, so a
 * handler can be written against the smallest thing it actually needs.
 */
export interface PdfMarkContext {
  theme: ResolvedTheme;
}

/** What this mark does to a span. Called once per mark, per span. */
export type PdfMarkHandler = (
  mark: PdfSpanMark,
  ctx: PdfMarkContext,
) => PdfSpanStyle;
