import type { DocxDiagnostic } from "./handlers";

/**
 * Thrown when the DOCX exporter cannot produce a package.
 *
 * Carries the diagnostics list collected up to the point of failure so
 * callers can surface the warnings that preceded the fatal error (and the
 * fatal itself, recorded as a `level: "error"` entry).
 *
 * Contract:
 *   - Recoverable fidelity loss → `DocxExportResult.diagnostics` (warnings).
 *   - Fatal failure → `throw new DocxExportError(...)` (warnings + final error).
 *   - `options.unsupported === "throw"` upgrades the first unsupported-node
 *     diagnostic into a thrown `DocxExportError`.
 */
export class DocxExportError extends Error {
  readonly diagnostics: ReadonlyArray<DocxDiagnostic>;

  constructor(message: string, diagnostics: DocxDiagnostic[]) {
    super(message);
    this.name = "DocxExportError";
    this.diagnostics = diagnostics;
  }
}
