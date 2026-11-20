/**
 * HTML import entry point — parses an HTML document against the editor's
 * schema and returns a ProseMirror `Node`.
 *
 * The rules are the schema's own `parseDOM`, the ones paste runs, so a tag
 * means the same thing whether it arrives pasted or imported. What differs is
 * intent: pasted HTML is another editor's page and gets cleaned of its
 * artefacts; imported HTML is what the author wrote, and nothing is cleaned.
 *
 * Use `new ServerEditor()` on the server — the editor supplies the schema.
 */

import type { IBaseEditor } from "@scrivr/core";
import { assignBlockIds, planDuplicateIdAssignments } from "@scrivr/core";
import { DOMParser as PMDOMParser, Mapping, Transform, type Node as PmNode } from "@scrivr/core/pm";
import { withHtmlBody } from "./parseHtml";

export interface HtmlImportResult {
  doc: PmNode;
}

/**
 * Import an HTML document using the editor's schema.
 *
 * Blocks keep the `data-node-id` the HTML gives them, so an agent can refer
 * back to what it wrote. Where two blocks share one, the first keeps it; the
 * rest, and blocks with none, get fresh ids — when the editor has `UniqueId`,
 * the same as a session typing them would.
 *
 * @example
 *   const editor = new ServerEditor();
 *   const { doc } = await importHtml(editor, html);
 *   applyImportedDocument(editor, doc);
 */
export async function importHtml(editor: IBaseEditor, html: string): Promise<HtmlImportResult> {
  let doc = await withHtmlBody(html, (body) => PMDOMParser.fromSchema(editor.schema).parse(body));
  doc = reidDuplicates(doc);
  if (editor.findExtension("uniqueId")) doc = assignBlockIds(doc);
  return { doc };
}

/** Every block after the first that carries an id an earlier one has. */
function reidDuplicates(doc: PmNode): PmNode {
  // Measured against a document with no blocks, every block is new to it —
  // so of the copies sharing an id, the first written keeps it.
  const nothingBefore = doc.type.create();
  const tr = new Transform(doc);
  for (const { pos, attrs } of planDuplicateIdAssignments(nothingBefore, doc, new Mapping())) {
    tr.setNodeMarkup(pos, undefined, attrs);
  }
  return tr.doc;
}
