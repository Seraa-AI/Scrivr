import type { Node as PmNode } from "prosemirror-model";
import type { IBaseEditor } from "../extensions/types";

/**
 * Put a document returned by an importer (`importDocx`, `importHtml`) into an
 * editor.
 *
 * Content alone is not the document. An importer settles what it rebuilds
 * from outside the body — header and footer policy, the final section's
 * settings — on `doc.attrs`. Replacing only the content would drop that, so
 * the attrs are applied here too.
 *
 * The whole document is being replaced, so its attributes win outright,
 * including where the file says a document has no chrome and the editor
 * currently shows some. One transaction, so it undoes as one action.
 */
export function applyImportedDocument(editor: IBaseEditor, doc: PmNode): void {
  const state = editor.getState();
  // Loading a document is not an authored edit. Track-changes consumes this
  // established metadata to avoid turning the old document into one giant
  // deletion and the imported document into one giant insertion.
  let tr = state.tr
    .replaceWith(0, state.doc.content.size, doc.content)
    .setMeta("initialContent", true)
    // This metadata key is Track Changes' public transaction protocol. Keep
    // it alongside the generic load marker so both the root transaction and
    // any plugin-appended bookkeeping are unambiguously non-authorial.
    .setMeta("track-changes-skip-tracking", true);
  for (const [name, value] of Object.entries(doc.attrs)) {
    if (state.doc.attrs[name] === value) continue;
    tr = tr.setDocAttribute(name, value);
  }
  editor.applyTransaction(tr);
}
