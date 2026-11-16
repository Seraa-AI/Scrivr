import {
  Editor,
  Field,
  fieldKindsOf,
  flattenExtensions,
  hashArtifact,
  isFieldAnswered,
  listSignerFields,
  safeDrawingUrl,
  snapshotDocument,
  replaceFieldValues,
  valuesOnRecordOf,
  verifySnapshot,
  type EditorOptions,
  type FieldKinds,
  type FieldValue,
  type SealedSnapshot,
  type SignerFieldDescriptor,
} from "@scrivr/core";
import { PDFDocument } from "pdf-lib";
import { embedImage } from "./embedImage";
import { createDefaultImageResolver, resolveOnce, type ImageResolver } from "./fetchImage";
import { exportToPdf, type PdfExportOptions } from "./pdf";

export interface ExecutedPdfOptions extends PdfExportOptions {
  /**
   * The setup the signers saw, less its content: the same extensions — `Field`
   * with the same kinds — fonts and page setup, so the record is laid out as
   * they signed it.
   */
  editorOptions: Omit<EditorOptions, "content" | "sealed">;
}

/** Why there is no executed document yet. */
export type ExecutedPdfRefusal =
  /** The stored snapshot no longer matches its hash: it is not what was agreed. */
  | { reason: "snapshot-altered" }
  /** Required fields the record would print blank: unanswered, or a drawing the PDF cannot embed. */
  | { reason: "unanswered-fields"; missing: SignerFieldDescriptor[] };

export type ExecutedPdfResult = { ok: true; pdf: Uint8Array; artifactHash: string } | { ok: false; refusal: ExecutedPdfRefusal };

/**
 * The executed document: the sealed snapshot with every party's values
 * printed in their fields — the signed record — and `artifactHash`, the hash
 * of exactly the bytes returned, to keep beside it.
 *
 * Refuses rather than print a record of something else: a snapshot that no
 * longer matches its hash, or a required field the record would show blank.
 * The fields are read from the verified content, not from what was stored
 * beside it, and are checked against the values as the printing editor
 * holds them, as the record `Field` prints (`valuesOnRecordOf`: its kinds,
 * its `formatSignedDate`) — what it prints is what was checked. A
 * `signedAt` may be a bare day here, printed as that day; a certificate of
 * completion asks for the moment. Throws when `Field` is not among
 * `editorOptions.extensions`, or a plugin refuses the value set. The
 * supplied values replace any configured initial values in Field. Values
 * are printed, never written: the snapshot and its hash are unchanged.
 */
export async function exportExecutedPdf(
  snapshot: Pick<SealedSnapshot, "content" | "contentHash">,
  values: Readonly<Record<string, FieldValue>>,
  options: ExecutedPdfOptions,
): Promise<ExecutedPdfResult> {
  const printed = await printExecuted(snapshot, values, options);
  return printed.ok ? { ok: true, pdf: printed.print.pdf, artifactHash: printed.print.artifactHash } : printed;
}

/** One printing of the executed record, and what was read to print it — all a certificate of completion describes. */
export interface ExecutedPrint {
  pdf: Uint8Array;
  artifactHash: string;
  fields: SignerFieldDescriptor[];
  kinds: FieldKinds;
  /** The values as the record printed them: a drawing as embedded, none that could not be, each date signed derived. */
  onRecord: Readonly<Record<string, FieldValue>>;
  /** Each printed drawing's own pixel size, from its embedding. */
  drawings: ReadonlyMap<string, { width: number; height: number }>;
  /** Each field's box as the document gives it — what a drawing is fitted to when printed. */
  boxes: ReadonlyMap<string, { width: number; height: number }>;
}

/** `exportExecutedPdf`'s printing, keeping what it read — so a certificate is issued from this printing and no other. */
export async function printExecuted(
  snapshot: Pick<SealedSnapshot, "content" | "contentHash">,
  values: Readonly<Record<string, FieldValue>>,
  options: ExecutedPdfOptions,
): Promise<{ ok: true; print: ExecutedPrint } | { ok: false; refusal: ExecutedPdfRefusal }> {
  if (!(await verifySnapshot(snapshot.content, snapshot.contentHash))) {
    return { ok: false, refusal: { reason: "snapshot-altered" } };
  }
  const { editorOptions, ...pdfOptions } = options;
  // Matched by name, as the extension manager identifies extensions: a Field under another name is not Field.
  if (!flattenExtensions(editorOptions.extensions ?? []).some((extension) => extension.name === Field.name)) {
    throw new Error("exportExecutedPdf needs Field among editorOptions.extensions: only Field reads a field or holds its value");
  }
  const editor = new Editor({ ...editorOptions, content: snapshotDocument(snapshot.content), sealed: true });
  try {
    // So the drawing checked is the drawing printed.
    const resolveImage = resolveOnce(pdfOptions.resolveImage ?? createDefaultImageResolver(pdfOptions.onImageRefused));
    const scratch = await PDFDocument.create();
    const printable: Record<string, FieldValue> = {};
    const drawings = new Map<string, { width: number; height: number }>();
    for (const [id, value] of Object.entries(values)) {
      if (value.kind !== "image") {
        printable[id] = value;
        continue;
      }
      // A drawing the PDF cannot embed is no value: the record would print it blank, and it dates no one.
      const drawing = await embeddedDrawing(scratch, resolveImage, value.src);
      if (drawing === null) continue;
      printable[id] = { ...value, src: drawing.src };
      drawings.set(id, { width: drawing.width, height: drawing.height });
    }
    // One authoritative record, including an empty one: configured values
    // cannot fill omissions or stand in for drawings that could not embed.
    if (!replaceFieldValues(editor, printable)) throw new Error("exportExecutedPdf could not hold the field values: a plugin refused them");
    const kinds = fieldKindsOf(editor);
    const doc = editor.getState().doc;
    const fields = listSignerFields(doc);
    const boxes = new Map<string, { width: number; height: number }>();
    doc.descendants((node) => {
      const id = node.attrs["nodeId"];
      if (node.type.name === "field" && typeof id === "string") boxes.set(id, { width: Number(node.attrs["width"]), height: Number(node.attrs["height"]) });
    });
    // The record Field prints — its kinds, its date format — so what is checked is what prints.
    const onRecord = valuesOnRecordOf(editor);
    const missing = fields.filter((f) => f.required && !isFieldAnswered(f, onRecord[f.id], kinds));
    if (missing.length > 0) return { ok: false, refusal: { reason: "unanswered-fields", missing } };
    const pdf = await exportToPdf(editor, { ...pdfOptions, resolveImage });
    return { ok: true, print: { pdf, artifactHash: await hashArtifact(pdf), fields, kinds, onRecord, drawings, boxes } };
  } finally {
    editor.destroy();
  }
}

/**
 * A drawing as this PDF embeds it — through `safeDrawingUrl`, then the PDF's
 * own embedding — with its size; `null` when it cannot embed, or has no area
 * to show (a 0-pixel side would print nothing, and fit to no box).
 */
async function embeddedDrawing(scratch: PDFDocument, resolveImage: ImageResolver, src: string): Promise<{ src: string; width: number; height: number } | null> {
  const drawing = safeDrawingUrl(src);
  if (drawing === null) return null;
  const image = await embedImage(scratch, resolveImage, drawing);
  if (!image || image.width <= 0 || image.height <= 0) return null;
  return { src: drawing, width: image.width, height: image.height };
}
