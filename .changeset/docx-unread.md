---
"@scrivr/core": patch
"@scrivr/docx": patch
---

`importDocx` can report the Word XML it never read, and stops warning about properties it drops on purpose.

- **`importDocx(editor, bytes, { trackUnread: true })`** adds `report.unread`: each element of the body, headers, footers, styles, numbering and settings that the import never read, as a `DocxUnreadElement` with its `part`, its `path` from the part's root (`w:document/w:body/w:p/w:pPr/w:ind`) and a `count`. An element whose name was matched but nothing in it read is listed as `examined`. Only the top of a skipped subtree is listed. Off by default, because every element is watched while it is on; with it off, the result is unchanged. The import itself is the same either way.
- **A reviewed list of properties dropped on purpose** decides which run properties raise no `unsupported-mark` warning, and which elements are never reported unread. Each entry says why. It adds `w:szCs` (the size of complex-script text), the largest source of noise: it alone produced 128 warnings across 25 real Word documents. `w:proofErr`, `w:lastRenderedPageBreak`, `w:rsids` and `w:rsid` are never reported unread. The run properties that were already quiet stay quiet; `w:spacing`, `w:position`, `w:vertAlign` and `w:w` are marked on the list as known gaps rather than intended drops. Dropped properties are still counted in `report.counts`.
- `@scrivr/core` and `@scrivr/docx` export the `DocxUnreadElement` type.
