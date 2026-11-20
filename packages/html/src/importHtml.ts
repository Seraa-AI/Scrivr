/**
 * Reads HTML into a document with the editor's schema.
 *
 * The rules are the schema's own `parseDOM`, the ones paste runs, so a tag
 * means the same thing whether it arrives pasted or imported. What differs is
 * intent: pasted HTML is another editor's page and gets cleaned of its
 * artefacts; imported HTML is what the author wrote, and nothing is cleaned.
 *
 * Use `new ServerEditor()` on the server — the editor supplies the schema.
 *
 * Which parser reads the HTML is the package entry's choice: the page's
 * `DOMParser` under the `browser` export condition, happy-dom otherwise. A
 * browser bundle never sees happy-dom.
 */

import type { IBaseEditor } from "@scrivr/core";
import { assignBlockIds, planDuplicateIdAssignments } from "@scrivr/core";
import { Mapping, Transform, type Node as PmNode } from "@scrivr/core/pm";
import { watchedParser, type HtmlImportDiagnostic } from "./diagnostics";
import type { WithHtmlBody } from "./dom";
import { applyStylesheets } from "./stylesheet";
import { cascadeInherited } from "./cascade";

export type { HtmlImportDiagnostic };

export interface HtmlImportResult {
  doc: PmNode;
  /** What the HTML said that the document could not carry. */
  diagnostics: HtmlImportDiagnostic[];
}

/** The signature of `importHtml`. */
export type ImportHtml = (editor: IBaseEditor, html: string) => Promise<HtmlImportResult>;

/** `importHtml`, reading HTML with `withHtmlBody`. */
export function htmlImporter(withHtmlBody: WithHtmlBody): ImportHtml {
  return async (editor, html) => {
    const { parser, report } = watchedParser(editor.schema);
    const parsed = await withHtmlBody(html, (body) => {
      const unsupportedSelectors = applyStylesheets(body);
      const uninheritedProperties = cascadeInherited(body);
      return { doc: parser.parse(body), diagnostics: report(body, { unsupportedSelectors, uninheritedProperties }) };
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
