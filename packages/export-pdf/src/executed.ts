import {
  Editor,
  fieldKindsOf,
  fieldValues,
  hashArtifact,
  isFieldAnswered,
  listSignerFields,
  setFieldValue,
  valuesOnRecord,
  verifySnapshot,
  type EditorOptions,
  type FieldValue,
  type SealedSnapshot,
  type SignerFieldDescriptor,
} from "@scrivr/core";
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
  /** Required fields nobody has answered — an executed record would show them blank. */
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
 * them, as a record shows them (`valuesOnRecord`) — what it prints is what
 * was checked. Throws when the editor cannot hold values: `Field` is missing
 * from `editorOptions`. Values are printed, never written: the snapshot and
 * its hash are unchanged.
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
  const editor = new Editor({ ...editorOptions, content: documentJson(snapshot.content), sealed: true });
  try {
    for (const [id, value] of Object.entries(values)) {
      if (!setFieldValue(editor, id, value)) throw new Error("exportExecutedPdf needs Field among editorOptions.extensions to hold values");
    }
    const kinds = fieldKindsOf(editor);
    const fields = listSignerFields(editor.getState().doc);
    // What the record shows: a date signed with no signature beside it is dropped.
    const held = fieldValues(editor.getState());
    const onRecord = valuesOnRecord(fields, held, kinds);
    for (const id of Object.keys(held)) if (!(id in onRecord)) setFieldValue(editor, id, null);
    const missing = fields.filter((f) => f.required && !isFieldAnswered(f, onRecord[f.id], kinds));
    if (missing.length > 0) return { ok: false, refusal: { reason: "unanswered-fields", missing } };
    const pdf = await exportToPdf(editor, pdfOptions);
    return { ok: true, pdf, artifactHash: await hashArtifact(pdf) };
  } finally {
    editor.destroy();
  }
}

/** A verified snapshot's document object, rebuilt as a typed record rather than cast. */
function documentJson(content: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(content);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("A snapshot's content is a document object");
  return Object.fromEntries(Object.entries(parsed));
}
