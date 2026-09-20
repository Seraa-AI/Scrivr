import type { PDFDocument } from "pdf-lib";

/**
 * What the file says about itself.
 *
 * A PDF's Info dictionary is what a viewer puts in its title bar, what a
 * desktop search indexes, and what a document management system files it
 * under. Without one, a contract is known to all of them by its filename alone.
 */
export interface PdfMetadata {
  /**
   * What the document is called. `PdfExport` passes the filename it is saving
   * under; nothing else guesses one, because a wrong title is worse than an
   * absent one — it is what a search index and a document system file the
   * record under.
   */
  title?: string;
  author?: string;
  subject?: string;
  keywords?: readonly string[];
  /**
   * Stamped as both creation and modification date. Defaults to the moment of
   * export; pass a fixed date when the bytes have to be reproducible.
   */
  date?: Date;
}

/** The authoring application, as `Creator` reports it. */
const CREATOR = "Scrivr";

export function applyMetadata(pdfDoc: PDFDocument, metadata: PdfMetadata | undefined): void {
  if (metadata?.title) pdfDoc.setTitle(metadata.title);
  if (metadata?.author) pdfDoc.setAuthor(metadata.author);
  if (metadata?.subject) pdfDoc.setSubject(metadata.subject);
  if (metadata?.keywords?.length) pdfDoc.setKeywords([...metadata.keywords]);

  // `Creator` is the application a document was authored in; `Producer` is
  // what turned it into a PDF. pdf-lib stamps itself as the producer during
  // `save()` regardless, and that is the true answer, so only the creator is
  // set here.
  pdfDoc.setCreator(CREATOR);

  const date = metadata?.date ?? new Date();
  pdfDoc.setCreationDate(date);
  pdfDoc.setModificationDate(date);
}
