/**
 * Word XML the import drops on purpose, each with the reason. Something on
 * this list raises no warning, is skipped without a diagnostic where the
 * parser meets it, and is reported `ignored` rather than unread. It is still
 * counted in the report where a handler would have been asked for it.
 *
 * Adding an entry is a reviewed decision: it hides a loss from the
 * diagnostics, so the reason has to say why the loss does not matter, or that
 * it is a known gap kept quiet on purpose.
 *
 * Keys are an element name, which matches it anywhere, or `parent/name`,
 * which matches it only there — `w:spacing` is run spacing under `w:rPr` and
 * paragraph spacing under `w:pPr`, and only one of them is noise.
 */
const IGNORED: Readonly<Record<string, string>> = {
  "w:proofErr": "Where Word's spell and grammar check flagged text: proofing state, not content.",
  "w:lastRenderedPageBreak": "Where Word's pages broke when the file was saved: Word's layout, not the document's.",
  "w:rsids": "Word's edit-session ids, which identify sessions and change nothing visible.",
  "w:rsid": "The edit session a style was last changed in. Changes nothing visible.",
  "w:permStart": "Where a range editable by named people starts. Scrivr has no per-range permissions.",
  "w:permEnd": "Where a range editable by named people ends. Scrivr has no per-range permissions.",
  "w:bookmarkStart": "Known gap: bookmarks are not imported, so a link to one has nowhere to go.",
  "w:bookmarkEnd": "Known gap: bookmarks are not imported, so a link to one has nowhere to go.",
  "w:commentRangeStart": "Known gap: comments are not imported.",
  "w:commentRangeEnd": "Known gap: comments are not imported.",
  "w:commentReference": "Known gap: comments are not imported.",
  "w:annotationRef": "Known gap: comments are not imported.",
  "w:smartTag/w:smartTagPr": "A smart tag's recognised type and data; its text is imported.",
  "w:rPr/w:szCs": "The size of complex-script text (Arabic, Hebrew, Thai). Scrivr sizes every run by w:sz.",
  "w:rPr/w:lang": "The proofing language of a run. It changes neither the text nor how it is laid out.",
  "w:rPr/w:noProof": "Turns spell check off for a run. Not formatting.",
  "w:rPr/w:webHidden": "Hides a run in Word's web layout only; Scrivr lays out the printed page.",
  "w:rPr/w:snapToGrid": "Snaps a run to the document grid, which Scrivr does not lay out by.",
  "w:rPr/w:kern": "The size above which Word kerns a font. Scrivr kerns text at every size.",
  "w:rPr/w:spacing": "Known gap: character spacing is not imported yet. Its warning was silenced before this list existed.",
  "w:rPr/w:position": "Known gap: raised and lowered text is not imported yet. Its warning was silenced before this list existed.",
  "w:rPr/w:vertAlign": "Known gap: superscript and subscript are not imported yet. Its warning was silenced before this list existed.",
  "w:rPr/w:w": "Known gap: horizontally scaled text is not imported yet. Its warning was silenced before this list existed.",
};

/** Whether `name`, inside an element named `parent`, is dropped on purpose. */
export function isIgnored(parent: string | undefined, name: string): boolean {
  return Object.hasOwn(IGNORED, name) || (parent !== undefined && Object.hasOwn(IGNORED, `${parent}/${name}`));
}
