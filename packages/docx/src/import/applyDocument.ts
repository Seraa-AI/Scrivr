import type { IBaseEditor } from "@scrivr/core";
import type { Node as PmNode } from "@scrivr/core/pm";

/**
 * Put a document returned by `importDocx` into an editor.
 *
 * Content alone is not the document. An import contribution settles what it
 * reconstructs from outside the body on `doc.attrs`: the header and footer
 * policy comes from the section's references, the final section's settings
 * from its `<w:sectPr>`. A caller who replaces only the content parses all of
 * that and then drops it, so a file's headers survive every step but the last
 * — which is why this is a function rather than a line each consumer writes.
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
