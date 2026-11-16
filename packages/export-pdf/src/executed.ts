import {
  Editor,
  Field,
  fieldKindsOf,
  flattenExtensions,
  hashArtifact,
  isFieldAnswered,
  listSignerFields,
  safeDrawingUrl,
  replaceFieldValues,
  valuesOnRecordOf,
  verifySnapshot,
  type EditorOptions,
  type FieldValue,
  type SealedSnapshot,
  type SignerFieldDescriptor,
} from "@scrivr/core";
import { PDFDocument } from "pdf-lib";
import { embedImage } from "./embedImage";
import { createDefaultImageResolver, resolveOnce, type ImageResolver } from "./fetchImage";
import { exportToPdf, type PdfExportOptions } from "./index";

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

export type ExecutedPdfResult =
  | { ok: true; pdf: Uint8Array; artifactHash: string }
  | { ok: false; refusal: ExecutedPdfRefusal };

/**
 * The executed document: the sealed snapshot with every party's values
 * printed in their fields — the signed record — and `artifactHash`, the hash
 * of exactly the bytes returned, to keep beside it.
 *
 * Refuses rather than print a record of something else: a snapshot that no
 * longer matches its hash, or a required field the record would show blank.
 * The fields are read from the verified content, not from what was stored
 * beside it, and are checked against the values as the printing editor holds
 * them, as the record `Field` prints (`valuesOnRecordOf`: its kinds, its
 * `formatSignedDate`) — what it prints is what was checked. Throws when `Field` is not among `editorOptions.extensions`,
 * or a plugin refuses the value set. The supplied values replace any configured
 * initial values in Field. Values are printed, never written: the
 * snapshot and its hash are unchanged.
 */
export async function exportExecutedPdf(
  snapshot: Pick<SealedSnapshot, "content" | "contentHash">,
  values: Readonly<Record<string, FieldValue>>,
  options: ExecutedPdfOptions,
): Promise<ExecutedPdfResult> {
  if (!(await verifySnapshot(snapshot.content, snapshot.contentHash))) {
    return { ok: false, refusal: { reason: "snapshot-altered" } };
  }
  const { editorOptions, ...pdfOptions } = options;
  // Matched by name, as the extension manager identifies extensions: a Field under another name is not Field.
  if (!flattenExtensions(editorOptions.extensions ?? []).some((extension) => extension.name === Field.name)) {
    throw new Error("exportExecutedPdf needs Field among editorOptions.extensions: only Field reads a field or holds its value");
  }
  const editor = new Editor({ ...editorOptions, content: documentJson(snapshot.content), sealed: true });
  try {
    // So the drawing checked is the drawing printed.
    const resolveImage = resolveOnce(pdfOptions.resolveImage ?? createDefaultImageResolver(pdfOptions.onImageRefused));
    const scratch = await PDFDocument.create();
    const printable: Record<string, FieldValue> = {};
    for (const [id, value] of Object.entries(values)) {
      // A drawing the PDF cannot embed is no value: the record would print it blank, and it dates no one.
      if (value.kind === "image" && !(await embedsAsDrawing(scratch, resolveImage, value.src))) continue;
      printable[id] = value;
    }
    // One authoritative record, including an empty one: configured values
    // cannot fill omissions or stand in for drawings that could not embed.
    if (!replaceFieldValues(editor, printable)) throw new Error("exportExecutedPdf could not hold the field values: a plugin refused them");
    const kinds = fieldKindsOf(editor);
    const fields = listSignerFields(editor.getState().doc);
    // The record Field prints — its kinds, its date format — so what is checked is what prints.
    const onRecord = valuesOnRecordOf(editor);
    const missing = fields.filter((f) => f.required && !isFieldAnswered(f, onRecord[f.id], kinds));
    if (missing.length > 0) return { ok: false, refusal: { reason: "unanswered-fields", missing } };
    const pdf = await exportToPdf(editor, { ...pdfOptions, resolveImage });
    return { ok: true, pdf, artifactHash: await hashArtifact(pdf) };
  } finally {
    editor.destroy();
  }
}

/** Whether a drawing embeds as this PDF will embed it: through `safeDrawingUrl`, then the PDF's own embedding. */
async function embedsAsDrawing(scratch: PDFDocument, resolveImage: ImageResolver, src: string): Promise<boolean> {
  const drawing = safeDrawingUrl(src);
  return drawing !== null && (await embedImage(scratch, resolveImage, drawing)) !== null;
}

/** The snapshot's document object: copied, not cast — content is untrusted until parsed. */
function documentJson(content: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(content);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("A snapshot's content is a document object");
  return Object.fromEntries(Object.entries(parsed));
}
