---
"@scrivr/core": patch
"@scrivr/docx": patch
---

`importDocx` can report the Word XML it never read, and stops warning about properties it drops on purpose.

- **`importDocx(editor, bytes, { trackUnread: true })`** adds `report.unread`: what the import did not read in the body, every header and footer the document references (whether or not an extension walks them), footnotes, endnotes, comments, styles, numbering and settings. Each entry is a `DocxUnreadElement` with its `part`, its `path` from the part's root (`w:document/w:body/w:p/w:pPr/w:ind`), an `outcome` and a `count`:
  - `unread`: never looked at.
  - `examined`: its name was seen, but nothing in it was read. An element whose name is all it says, such as `<w:noBreakHyphen/>`, is examined unless the import handles it.
  - `ignored`: dropped on purpose, on the import's reviewed list.

  Only the top of a skipped subtree is listed. It is an inventory of the XML, so it also lists what `report.entries` already drops. Off by default, because every element is watched while it is on; with it off, the report has no `unread`. The imported document, and whether the import succeeds, are the same either way: a part opened only to list it that is cut short is a `docx-part-unreadable` warning, and a header or footer that cannot be parsed is reported unreadable rather than failing the import.
- **One reviewed list decides what is dropped on purpose**, each entry with its reason. A run property on it raises no `unsupported-mark` warning, a body element on it is skipped without an `unsupported-docx-element` warning, and the page-break and rule detectors look past it. It adds `w:szCs` (the size of complex-script text), the largest source of noise. Bookmarks and comment ranges are on it as known gaps; `w:spacing`, `w:position`, `w:vertAlign` and `w:w` are marked as known gaps rather than intended drops. Dropped run properties are still counted in `report.counts`.
- `@scrivr/core` and `@scrivr/docx` export the `DocxUnreadElement` type.
