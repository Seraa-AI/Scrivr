import type { PDFDocument, PDFImage } from "pdf-lib";
import type { ImageResolver } from "./fetchImage";

/** One image as the PDF embeds it, or `null` when it cannot be — the page then shows none. */
export async function embedImage(pdfDoc: PDFDocument, resolveImage: ImageResolver, src: string): Promise<PDFImage | null> {
  try {
    const fetched = await resolveImage(src);
    if (!fetched) return null;
    return fetched.format === "png" ? await pdfDoc.embedPng(fetched.bytes) : await pdfDoc.embedJpg(fetched.bytes);
  } catch {
    return null;
  }
}
