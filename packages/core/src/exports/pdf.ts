import type { DocumentLayout, LayoutPage } from "../layout/PageLayout";
import type { LayoutBlock } from "../layout/BlockLayout";
import type { Rgb, Rgba } from "../model/cssColor";
import type { ResolvedTheme } from "../model/theme";
import type { IBaseEditor } from "../extensions/types";

/**
 * What an extension is allowed to see when it draws itself into a PDF.
 *
 * Core owns this vocabulary and `@scrivr/export-pdf` implements it, the same
 * way core owns `DocxNodeHandler` and `@scrivr/docx` implements that. The
 * difference is only what the capability is — drawing rather than XML.
 *
 * The point of the split is that nothing here is pdf-lib. A handler that
 * receives a `PDFPage` ends up hand-applying the coordinate flip, hand-copying
 * the colour shape and holding a font object it cannot describe — which is what
 * the two `PdfContextLike` interfaces in this repo already do, differently from
 * each other. So this surface speaks the vocabulary the rest of the editor
 * speaks:
 *
 * - **Coordinates** are layout pixels, top-down, exactly as `LayoutBlock` gives
 *   them. The exporter converts to points and flips the axis.
 * - **Colours** are `Rgb`, the same type the canvas, DOCX and PDF lanes already
 *   resolve to via `model/cssColor`. A drawing op names `opacity` separately
 *   from its colour because PDF carries alpha as graphics state rather than in
 *   the fill itself; a mark contribution, which states intent rather than an
 *   operation, uses `Rgba`.
 * - **Fonts and images** are opaque handles. A handler asks for one by the CSS
 *   font string layout already resolved, or by `src`, and passes it back. It
 *   never holds the backend's object.
 *
 * Nothing in here is especially PDF-shaped, and it is still named for PDF on
 * purpose: a `DrawingSurface` would promise the canvas renderer uses it too,
 * which is a promise nobody has decided to make.
 */

/**
 * A font the exporter has resolved and embedded. Opaque by construction — the
 * moment it exposes the backend's object, the dependency it exists to prevent
 * is back with extra steps.
 */
export interface PdfFontHandle {
  /** Identifies the font in an operation log; never parsed for meaning. */
  readonly id: string;
}

/** An image the exporter has embedded, addressed by the `src` that produced it. */
export interface PdfImageHandle {
  readonly id: string;
  /** Natural size in pixels, for a handler that wants to preserve aspect. */
  readonly width: number;
  readonly height: number;
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
  /** Omit for an unfilled rectangle — a border-only box, or nothing at all. */
  color?: Rgb;
  opacity?: number;
  border?: { color: Rgb; widthPx: number };
}

export interface PdfImageOp extends PdfBox {
  image: PdfImageHandle;
  opacity?: number;
}

/**
 * The primitives a handler draws with. Every coordinate is layout pixels,
 * top-down; the implementation owns the conversion to PDF points and the flip
 * to a bottom-left origin.
 */
export interface PdfDrawSurface {
  text(op: PdfTextOp): void;
  line(op: PdfLineOp): void;
  rect(op: PdfRectOp): void;
  image(op: PdfImageOp): void;
  /** The box drawn in place of an image that could not be resolved. */
  imagePlaceholder(box: PdfBox): void;
  /**
   * Draw a block through the same dispatch the page used, so a handler that
   * owns a container renders its children without knowing who owns them.
   *
   * This is the capability that makes ownership real rather than a file
   * location: a table cell's paragraphs belong to the Paragraph extension, and
   * the table should not be deciding what a paragraph looks like.
   */
  block(block: LayoutBlock): void;
}

/** Everything a PDF handler is given. */
export interface PdfHandlerContext {
  readonly draw: PdfDrawSurface;
  /** The whole document, for a handler that needs page counts or metrics. */
  readonly layout: DocumentLayout;
  /** The page being drawn. */
  readonly page: LayoutPage;
  /** Colours resolved for print — never the canvas theme unless asked for. */
  readonly theme: ResolvedTheme;
  readonly fonts: {
    /** Resolve the CSS font string layout already measured against. */
    resolve(cssFont: string): PdfFontHandle;
    fallback: PdfFontHandle;
  };
  readonly images: {
    /** The embedded image for a `src`, or null when it did not resolve. */
    get(src: string): PdfImageHandle | null;
  };
  readonly editor: IBaseEditor;
}

/**
 * Draw one block, or one inline atom, onto the page.
 *
 * Not yet dispatched. The exporter still collects `PdfNodeHandler` from
 * `@scrivr/export-pdf`, which hands a handler pdf-lib's context; this is the
 * core-owned shape those handlers move to. Write `PdfNodeHandler` today.
 */
export type PdfBlockHandler = (block: LayoutBlock, ctx: PdfHandlerContext) => void;

/**
 * The mark a style came from, by mark name.
 *
 * The painter arbitrates on it: an explicit `color` beats a link's text fill,
 * while the link still owns the colour of its own underline. It is a name and
 * not a priority number because a number lets two extensions escalate against
 * each other and leaves the arbitration living nowhere. A name the painter's
 * rule does not know contributes at the lowest precedence.
 */
export type PdfMarkSource = string;

/**
 * The style a mark contributes to a span. Declarative on purpose: the painter
 * owns baselines, thickness and span width, so a highlight extension never
 * computes geometry.
 *
 * Contributions are a list rather than one merged object because merging
 * destroys what is observable today — an explicit colour beats a link's text
 * fill but not its underline, and a span with two decorations draws two lines.
 */
export interface PdfMarkContribution {
  /** Text fill. `source` decides precedence when two marks both claim it. */
  foreground?: { color: Rgb; source: PdfMarkSource };
  backgrounds?: Array<{ color: Rgba; phase: PdfPaintPhase }>;
  decorations?: Array<{
    kind: "underline" | "strikethrough";
    /** A colour, or `"text"` to follow whatever the span's fill resolved to. */
    color: Rgb | "text";
    source: PdfMarkSource;
  }>;
}

/**
 * When a background paints relative to the text it covers. Named for what it
 * orders against rather than `under`/`over`, because the list will grow.
 */
export type PdfPaintPhase = "beforeText" | "afterText";

/** Contribute a mark's styling. Called once per mark on a span. */
export type PdfMarkStyler = (
  mark: { name: string; attrs: Record<string, unknown> },
  ctx: PdfHandlerContext,
) => PdfMarkContribution;
