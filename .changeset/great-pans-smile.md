---
"@scrivr/export-pdf": patch
---

Exported PDFs now describe themselves, and carry bookmarks.

An exported file said nothing about what it was: no title, no author, and
`Creator` naming pdf-lib rather than the application the document was written
in. A viewer's title bar, a desktop search and a document management system all
read that dictionary, so a contract was known to every one of them by its
filename alone.

`PdfExportOptions.metadata` writes title, author, subject, keywords and date.
`PdfExport` passes the filename it is saving under as the title; nothing
guesses one from the content, because a wrong title is worse than none — a
document whose first heading is "1. Definitions" is not called that.

Headings also become PDF bookmarks, on by default and nested by heading level,
so a long agreement opens with a way through it instead of only a scrollbar.
Pass `outline: false` to leave them out.
