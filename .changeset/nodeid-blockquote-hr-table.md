---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
"@scrivr/docx": patch
---

`@scrivr/core` — persist block ids on the horizontal rule, page break, and
table node families.

`horizontalRule`, `pageBreak`, `table`, `tableRow`, `tableCell`, and
`tableHeader` now declare a `nodeId` attribute and round-trip it through HTML as
`data-node-id` (parse + serialize), matching the paragraph/heading/codeBlock/
list/image nodes. Previously these block families dropped their id at parse, so
a copy/paste or HTML re-import lost the stable id that comment anchors, AI block
targeting, and citation reveal rely on. `assignBlockIds` already populates any
block node whose schema declares the attr, so ids are assigned automatically —
no other wiring changed.
