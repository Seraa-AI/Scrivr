/**
 * What an extension declares about PDF output: how its marks look, the
 * primitives its node handlers draw with, and the context they are handed.
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
import type { FontResolutionId } from "../fonts/layoutResolver";
import type { LayoutBlock } from "../layout/BlockLayout";
import type { DocumentLayout, LayoutPage } from "../layout/PageLayout";
import type { IBaseEditor } from "../extensions/types";

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
 * Names a font by the CSS shorthand layout measured with. The exporter resolves
 * it, falling back to a standard face when it has no bytes for that family.
 */
export interface PdfFontHandle {
  readonly cssFont: string;
  /**
   * Which face the layout measured this text in, when it is text the layout
   * measured. A handler that was handed a font by the context passes this
   * through untouched; naming a family without it makes the exporter guess,
   * and a guess is how a document measured in one face comes to be painted in
   * another.
   */
  readonly resolution?: FontResolutionId;
}

/**
 * Names an image by its `src`. A `src` the exporter never embedded draws the
 * placeholder rather than nothing, so a broken image still occupies its space.
 */
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
  /** Baseline, not top: a line's y plus its ascent. */
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
  /** Opacity of the stroke. Omit for opaque. */
  opacity?: number;
}

export interface PdfRectOp extends PdfBox {
  /** Omit to leave the box unfilled. With no border either, nothing is drawn. */
  color?: Rgb;
  /** Opacity of both the fill and border. Omit for opaque. */
  opacity?: number;
  border?: { color: Rgb; widthPx: number };
}

export interface PdfImageOp extends PdfBox {
  image: PdfImageHandle;
  /** Opacity of the image, or the entire placeholder when it cannot be resolved. */
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

/** The primitives, plus the one helper that paints a whole block's text. */
export interface PdfBlockDrawSurface extends PdfDrawSurface {
  /**
   * Draw every line of a block — its list marker, each text span with its mark
   * decorations, and the inline atoms sitting in the line.
   */
  lines(block: LayoutBlock, ctx: PdfNodeContext): void;
}

/** Draw a block (or inline atom) onto a PDF page. */
export type PdfNodeHandler = (block: LayoutBlock, ctx: PdfNodeContext) => void;

/**
 * What a node handler is typed against: it paints through `draw` and renders
 * children through `blocks`.
 *
 * Nothing here names pdf-lib, which is what lets an extension declare a
 * handler without depending on the exporter. The isolation is the type's, not
 * the runtime's — the pipeline hands over its own context, which carries the
 * backend values too. This says what a handler may rely on, not what it can
 * reach.
 */
export interface PdfNodeContext {
  layout: DocumentLayout;
  /**
   * The page being painted. Not yet assigned while a pre-export hook runs, so
   * a handler reached by dispatching from one sees it absent — read it only
   * from the page walk, which is where every ordinary handler is called.
   */
  layoutPage: LayoutPage;
  /** Top-left of the current block in page coordinates (top-down). */
  x: number;
  y: number;
  width: number;
  draw: PdfBlockDrawSurface;
  /**
   * Render blocks through their owning extension's handler.
   *
   * The one place a block becomes paint. The body loop, a container rendering
   * its children and a chrome band drawing its slot all call this, so a node is
   * drawn by whoever owns it no matter where it appears. An inline atom is the
   * one exception — it needs its host line's font on the context, so it shares
   * the handler lookup rather than coming through here.
   *
   * Sets `x`/`y`/`width` from each block before handing it over, and restores
   * the caller's box on return, including when a handler throws.
   */
  blocks(blocks: readonly LayoutBlock[]): void;
  /**
   * The face the layout measured this block in, present when the block is an
   * inline atom. A handler drawing its own text should use it rather than
   * naming a family: the box around it was reserved against this face, and on
   * canvas the atom is painted in it.
   */
  font?: PdfFontHandle;
  /** The editor whose export contributions were collected. */
  editor: IBaseEditor;
  /** Resolved colours every handler paints from. */
  theme: ResolvedTheme;
}
