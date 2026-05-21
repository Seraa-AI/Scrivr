import type { DocxDiagnostic } from "@scrivr/core";

/**
 * Thrown when the DOCX importer cannot produce a document.
 *
 * Carries the diagnostics collected up to the point of failure so callers
 * can surface the warnings that preceded the fatal error.
 */
export class DocxImportError extends Error {
  readonly diagnostics: ReadonlyArray<DocxDiagnostic>;

  constructor(message: string, diagnostics: DocxDiagnostic[]) {
    super(message);
    this.name = "DocxImportError";
    this.diagnostics = diagnostics;
  }
}
