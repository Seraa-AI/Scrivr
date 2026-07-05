---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
"@scrivr/docx": patch
---

`@scrivr/core` — DOCX export: tables now fill the page width.

A table exported to DOCX previously used its raw grid pixel widths, so Word
rendered it much smaller than the page even though the canvas fits the table to
the content area. Tables now export at 100% of the text area (`<w:tblW>` percent
width, with the grid preserved as column proportions), matching what you see in
the editor.
