---
"@scrivr/export-pdf": patch
---

An extension can now style its own mark in the PDF.

`PdfHandlers.marks` was declared and read by nobody: the export collected
`nodes` and `chrome` from each contribution and skipped `marks`, and
`createDrawHelpers` took the table as a parameter it never used. Mark rendering
was hardcoded in the shared context instead, so a mark from outside the
built-in set — a tracked change, a citation, anything a plugin defines — could
not appear in an export at all.

Marks are collected and dispatched now. Handlers say what a mark *means*;
thickness and offsets stay with the renderer, so every mark's underline lands
on the same line.

`PdfSpanStyle` changes shape: colours are CSS strings rather than pdf-lib
triples, so an extension can describe its mark without depending on pdf-lib or
on how a colour is composited for print. It gains `defaultColor` for a colour a
mark supplies by being what it is (a link's blue), which loses to an authored
`color` whatever order the marks arrive in. Nothing implemented the old shape —
the lane was inert — so no consumer moves.

Exported output is unchanged; the op-log baseline covers every built-in mark
and did not move.
