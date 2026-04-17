/**
 * DOCX export entry point (type-only — no implementation yet).
 *
 * Pipeline when implemented:
 *   1. Collect handlers from extensions via addExports().docx
 *   2. Build DocxContext (styles, numbering, rels, shared)
 *   3. Run onBeforeExport hooks
 *   4. Walk ProseMirror tree → handlers produce XmlNode trees
 *   5. Run onBuildTreeComplete hooks (bookmarks, cross-refs)
 *   6. Run onFinalize (or default packager) → DocxPackage
 *   7. Serialize DocxPackage to ZIP → Uint8Array (.docx file)
 *
 * Note: DOCX does NOT call ensureLayout() — it walks the ProseMirror
 * node tree directly. requiresLayout = false.
 */

import type { Editor } from "@scrivr/core";
import type { DocxHandlers } from "./handlers";

export interface DocxExportOptions {
  /** Override or supplement extension-contributed handlers. */
  overrides?: DocxHandlers;
}

/**
 * Export the editor's current document to DOCX format.
 *
 * @returns A Uint8Array containing the .docx file (OPC ZIP archive).
 */
export async function exportDocx(
  _editor: Editor,
  _options: DocxExportOptions = {},
): Promise<Uint8Array> {
  throw new Error(
    "[export-docx] Not implemented yet — this is a type-only skeleton. " +
    "See docs/docx-export-plan.md for the design.",
  );
}
