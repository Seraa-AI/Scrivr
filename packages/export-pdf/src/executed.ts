import {
  Editor,
  Field,
  fieldKindsOf,
  flattenExtensions,
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
 * was checked. Throws when `Field` is not among `editorOptions.extensions`,
 * or a plugin refuses a value. Values are printed, never written: the
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
  if (!flattenExtensions(editorOptions.extensions ?? []).some((extension) => extension.name === Field.name)) {
    throw new Error("exportExecutedPdf needs Field among editorOptions.extensions: only Field reads a field or holds its value");
  }
  const editor = new Editor({ ...editorOptions, content: documentJson(snapshot.content), sealed: true });
  try {
    for (const [id, value] of Object.entries(values)) {
      // Field is present, so only another plugin filtering the change refuses a value.
      if (!setFieldValue(editor, id, value)) throw new Error(`exportExecutedPdf could not hold the value of field "${id}": a plugin refused it`);
    }
    const kinds = fieldKindsOf(editor);
    const fields = listSignerFields(editor.getState().doc);
    // Field prints by this same rule: a date signed shows only beside its party's signature.
    const onRecord = valuesOnRecord(fields, fieldValues(editor.getState()), kinds);
    const missing = fields.filter((f) => f.required && !isFieldAnswered(f, onRecord[f.id], kinds));
    if (missing.length > 0) return { ok: false, refusal: { reason: "unanswered-fields", missing } };
    const pdf = await exportToPdf(editor, pdfOptions);
    return { ok: true, pdf, artifactHash: await hashArtifact(pdf) };
  } finally {
    editor.destroy();
  }
}

/** The snapshot's document object: copied, not cast — content is untrusted until parsed. */
function documentJson(content: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(content);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("A snapshot's content is a document object");
  return Object.fromEntries(Object.entries(parsed));
}
