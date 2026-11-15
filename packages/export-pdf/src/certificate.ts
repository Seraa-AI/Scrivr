import { Editor, StarterKit, hashArtifact, type CompletionCertificate, type EditorOptions } from "@scrivr/core";
import { PDFDocument } from "pdf-lib";
import { exportToPdf, type PdfExportOptions } from "./index";

export interface CertificatePdfOptions extends PdfExportOptions {
  /** The setup to print in — fonts, page setup — less its content. Default: `StarterKit` alone. */
  editorOptions?: Omit<EditorOptions, "content" | "sealed">;
}

/**
 * A certificate of completion as its own PDF, and `certificateHash`, the
 * hash of exactly the bytes returned. Printed by the exporter that printed
 * the executed record: pass that record's `editorOptions` and the two share
 * their fonts and page setup.
 */
export async function exportCompletionCertificate(
  certificate: CompletionCertificate,
  options: CertificatePdfOptions = {},
): Promise<{ pdf: Uint8Array; certificateHash: string }> {
  const { editorOptions, ...pdfOptions } = options;
  const editor = new Editor({ extensions: [StarterKit], ...editorOptions, content: certificate.content, sealed: true });
  try {
    const pdf = await exportToPdf(editor, pdfOptions);
    return { pdf, certificateHash: await hashArtifact(pdf) };
  } finally {
    editor.destroy();
  }
}

/**
 * One file: the executed record's pages, then the certificate's, under a
 * `bundleHash` of their own. The certificate inside still names the executed
 * record's `artifactHash` — the hash of that record alone, as it was issued.
 */
export async function bundleCertificate(executed: Uint8Array, certificate: Uint8Array): Promise<{ pdf: Uint8Array; bundleHash: string }> {
  const bundle = await PDFDocument.create();
  for (const bytes of [executed, certificate]) {
    const source = await PDFDocument.load(bytes);
    for (const page of await bundle.copyPages(source, source.getPageIndices())) bundle.addPage(page);
  }
  const pdf = await bundle.save();
  return { pdf, bundleHash: await hashArtifact(pdf) };
}
