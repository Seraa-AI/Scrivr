import { htmlImporter, type ImportHtml } from "./importHtml";
import { withServerBody } from "./domServer";

/**
 * Import an HTML document using the editor's schema. Parsed with happy-dom:
 * this is the entry Node resolves.
 *
 * Returns the document and `diagnostics`: every style, element and selector
 * the HTML used that the document could not carry. One bad piece never fails
 * the import; it is reported and the rest is read.
 *
 * Blocks keep the `data-node-id` the HTML gives them, so an agent can refer
 * back to what it wrote. Where two blocks share one, the first keeps it and
 * the rest get fresh ids; a block with none gets one when the editor has
 * `UniqueId`, as a session typing it would.
 *
 * @example
 *   const editor = new ServerEditor();
 *   const { doc, diagnostics } = await importHtml(editor, html);
 *   applyImportedDocument(editor, doc);
 */
export const importHtml: ImportHtml = htmlImporter(withServerBody);

export * from "./shared";
