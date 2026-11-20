import type { IBaseEditor } from "@scrivr/core";
import { assignBlockIds, planDuplicateIdAssignments } from "@scrivr/core";
import { Mapping, Transform, type Node as PmNode } from "@scrivr/core/pm";
import { watchedParser, type HtmlImportDiagnostic } from "./diagnostics";
import type { WithHtmlBody } from "./dom";
import { applyStylesheets } from "./stylesheet";
import { cascadeInherited } from "./cascade";

export type { HtmlImportDiagnostic };

/** What an HTML import produced, and what it could not carry. */
export interface HtmlImportResult {
  doc: PmNode;
  /** What the HTML said that the document could not carry. */
  diagnostics: HtmlImportDiagnostic[];
}

/**
 * Import an HTML document using the editor's schema.
 *
 * The rules are the schema's own `parseDOM`, the ones paste runs, so a tag
 * means the same thing pasted or imported. Pasted HTML is another editor's
 * page and is cleaned of its artefacts; imported HTML is what the author
 * wrote, and nothing is cleaned. On the server, `new ServerEditor()` supplies
 * the schema.
 *
 * Returns the document and `diagnostics`: the styles, elements and selectors
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
export type ImportHtml = (editor: IBaseEditor, html: string) => Promise<HtmlImportResult>;

/**
 * `importHtml` reading through `withHtmlBody` — the page's `DOMParser` in the
 * browser entry, happy-dom in the Node one — so a browser bundle never sees
 * happy-dom.
 */
export function htmlImporter(withHtmlBody: WithHtmlBody): ImportHtml {
  return async (editor, html) => {
    const { parser, report } = watchedParser(editor.schema);
    const parsed = await withHtmlBody(html, (body) => {
      const unsupportedSelectors = applyStylesheets(body);
      const cascaded = cascadeInherited(body);
      const doc = parser.parse(body);
      return { doc, diagnostics: report(body, { unsupportedSelectors, ...cascaded }) };
    });
    let doc = rekeyRepeatedIds(parsed.doc);
    if (editor.findExtension("uniqueId")) doc = assignBlockIds(doc);
    return { doc, diagnostics: parsed.diagnostics };
  };
}

/** `doc`, with each block that repeats an earlier block's id given a fresh one. */
function rekeyRepeatedIds(doc: PmNode): PmNode {
  // Measured against a document with no blocks, every block is new to it —
  // so of the copies sharing an id, the first written keeps it.
  const nothingBefore = doc.type.create();
  const tr = new Transform(doc);
  for (const { pos, attrs } of planDuplicateIdAssignments(nothingBefore, doc, new Mapping())) {
    tr.setNodeMarkup(pos, undefined, attrs);
  }
  return tr.doc;
}
