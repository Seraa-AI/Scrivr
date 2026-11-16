---
"@scrivr/core": patch
"@scrivr/docx": patch
---

`importDocx` can report the Word XML it never read, and stops warning about properties it drops on purpose.

- **`importDocx(editor, bytes, { trackUnread: true })`** adds `report.unread`: what the import did not read in the body, every header and footer the document references (whether or not an extension walks them), footnotes, endnotes, comments, styles, numbering and settings. Each entry is a `DocxUnreadElement` with its `part`, its `path` from the part's root (`w:document/w:body/w:p/w:pPr/w:ind`), an `outcome` and a `count`:
  - `unread`: never looked at.
  - `examined`: its name was seen, but nothing in it was read. An element whose name is all it says, such as `<w:noBreakHyphen/>`, is examined unless the import handles it.
  - `ignored`: dropped on purpose, on the import's reviewed list.

  Only the top of a skipped subtree is listed. Off by default, because every element is watched while it is on; with it off, the report has no `unread`. The imported document is the same either way.
- **One reviewed list decides what is dropped on purpose**, each entry with its reason. A run property on it raises no `unsupported-mark` warning, a body element on it is skipped without an `unsupported-docx-element` warning, and the page-break and rule detectors look past it. It adds `w:szCs` (the size of complex-script text), the largest source of noise: it alone produced 128 warnings across 25 real Word documents. Bookmarks, comment ranges and smart tags are on it as known gaps, since they were already skipped. The run properties that were already quiet stay quiet; `w:spacing`, `w:position`, `w:vertAlign` and `w:w` are marked on it as known gaps rather than intended drops. Dropped run properties are still counted in `report.counts`.
- `@scrivr/core` and `@scrivr/docx` export the `DocxUnreadElement` type.
