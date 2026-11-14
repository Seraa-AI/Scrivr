import {
  Editor,
  hashArtifact,
  isFieldAnswered,
  listSignerFields,
  setFieldValue,
  verifySnapshot,
  type EditorOptions,
  type FieldValue,
  type SealedSnapshot,
  type SignerFieldDescriptor,
} from "@scrivr/core";
import { exportToPdf, type PdfExportOptions } from "./index";

export interface ExecutedPdfOptions extends PdfExportOptions {
  /**
   * The editor the signers saw, less its content: the same extensions — `Field`
   * with the same kinds — fonts and page setup, so the record is laid out as
   * they signed it.
   */
  editor: Omit<EditorOptions, "content" | "sealed">;
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
 * longer matches its hash, or a required field still unanswered. The fields
 * are read from the verified content, not from what was stored beside it.
 * Values are printed, never written: the snapshot and its hash are unchanged.
 */
export async function exportExecutedPdf(
  snapshot: Pick<SealedSnapshot, "content" | "contentHash">,
  values: Readonly<Record<string, FieldValue>>,
  options: ExecutedPdfOptions,
): Promise<ExecutedPdfResult> {
  if (!(await verifySnapshot(snapshot.content, snapshot.contentHash))) {
    return { ok: false, refusal: { reason: "snapshot-altered" } };
  }
  const { editor: editorOptions, ...pdfOptions } = options;
  const editor = new Editor({ ...editorOptions, content: JSON.parse(snapshot.content), sealed: true });
  try {
    const missing = listSignerFields(editor.getState().doc).filter((f) => f.required && !isFieldAnswered(f, values[f.id]));
    if (missing.length > 0) return { ok: false, refusal: { reason: "unanswered-fields", missing } };
    for (const [id, value] of Object.entries(values)) {
      if (!setFieldValue(editor, id, value)) throw new Error("exportExecutedPdf needs Field among the editor's extensions to print values");
    }
    const pdf = await exportToPdf(editor, pdfOptions);
    return { ok: true, pdf, artifactHash: await hashArtifact(pdf) };
  } finally {
    editor.destroy();
  }
}
