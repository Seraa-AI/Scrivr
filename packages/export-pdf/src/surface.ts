import { rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type {
  LayoutBlock,
  PdfBox,
  PdfDrawSurface,
  PdfFontHandle,
  PdfImageHandle,
  PdfImageOp,
  PdfLineOp,
  PdfRectOp,
  PdfTextOp,
  Rgb,
} from "@scrivr/core";
import { PT_PER_PX, parseCssColor } from "./context";

/**
 * The pdf-lib implementation of core's drawing surface.
 *
 * Everything the surface exists to keep out of core lives here: the unit
 * conversion, the axis flip, pdf-lib's colour type, and the font and image
 * objects a handle stands for. A handler upstream works in layout pixels with
 * `Rgb`, and never learns any of it.
 */

/** Flip from top-left (layout) to bottom-left (PDF) coordinate space. */
function flipY(yPx: number, pageHeightPt: number): number {
  return pageHeightPt - yPx * PT_PER_PX;
}

function toPdfColor(color: Rgb): ReturnType<typeof rgb> {
  return rgb(color.r / 255, color.g / 255, color.b / 255);
}

/**
 * The resources a handle names. Handles carry an id and nothing else, so the
 * mapping back to a backend object stays on this side of the boundary.
 */
export interface PdfResourceTable {
  font(handle: PdfFontHandle): PDFFont;
  image(handle: PdfImageHandle): PDFImage | null;
}

export interface SurfaceDeps {
  /** The page being drawn. Read per call — the page changes as export walks. */
  getPage(): PDFPage;
  pageHeightPt: number;
  resources: PdfResourceTable;
  theme: { imagePlaceholderBg: string; imagePlaceholderBorder: string };
  /** Draw a block through the export's own dispatch. */
  drawBlock(block: LayoutBlock): void;
}

export function createPdfDrawSurface(deps: SurfaceDeps): PdfDrawSurface {
  const { getPage, pageHeightPt, resources, theme, drawBlock } = deps;

  /** pdf-lib omits an opacity of 1 rather than writing a redundant ExtGState. */
  const alpha = (opacity: number | undefined): { opacity?: number } =>
    opacity === undefined || opacity === 1 ? {} : { opacity };

  return {
    text(op: PdfTextOp): void {
      getPage().drawText(op.text, {
        x: op.x * PT_PER_PX,
        y: flipY(op.baselineY, pageHeightPt),
        size: op.sizePx * PT_PER_PX,
        font: resources.font(op.font),
        color: toPdfColor(op.color),
        ...alpha(op.opacity),
      });
    },

    line(op: PdfLineOp): void {
      getPage().drawLine({
        start: { x: op.from.x * PT_PER_PX, y: flipY(op.from.y, pageHeightPt) },
        end: { x: op.to.x * PT_PER_PX, y: flipY(op.to.y, pageHeightPt) },
        thickness: op.thicknessPx * PT_PER_PX,
        color: toPdfColor(op.color),
        ...alpha(op.opacity),
      });
    },

    rect(op: PdfRectOp): void {
      // An unfilled, unbordered rectangle is invisible, and pdf-lib fills one
      // black when neither `color` nor `borderColor` is a key on the options
      // bag. So it never reaches pdf-lib.
      if (!op.color && !op.border) return;
      getPage().drawRectangle({
        x: op.x * PT_PER_PX,
        // A rectangle is measured from its lower-left corner once flipped.
        y: flipY(op.y + op.height, pageHeightPt),
        width: op.width * PT_PER_PX,
        height: op.height * PT_PER_PX,
        ...(op.color ? { color: toPdfColor(op.color) } : {}),
        ...alpha(op.opacity),
        ...(op.border
          ? {
              borderColor: toPdfColor(op.border.color),
              borderWidth: op.border.widthPx * PT_PER_PX,
            }
          : {}),
      });
    },

    image(op: PdfImageOp): void {
      const image = resources.image(op.image);
      if (!image) return;
      getPage().drawImage(image, {
        x: op.x * PT_PER_PX,
        y: flipY(op.y + op.height, pageHeightPt),
        width: op.width * PT_PER_PX,
        height: op.height * PT_PER_PX,
        ...alpha(op.opacity),
      });
    },

    imagePlaceholder(box: PdfBox): void {
      getPage().drawRectangle({
        x: box.x * PT_PER_PX,
        y: flipY(box.y + box.height, pageHeightPt),
        width: box.width * PT_PER_PX,
        height: box.height * PT_PER_PX,
        color: parseCssColor(theme.imagePlaceholderBg),
        borderColor: parseCssColor(theme.imagePlaceholderBorder),
        // A hairline in points, matching what the exporter draws today. Note
        // it is not `1 * PT_PER_PX` like every other width here, so a caller
        // spelling this box as `rect` would get a thinner border.
        borderWidth: 1,
      });
    },

    block(block: LayoutBlock): void {
      drawBlock(block);
    },
  };
}
