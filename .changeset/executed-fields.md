---
"@scrivr/core": patch
"@scrivr/export-pdf": patch
"@scrivr/plugins": patch
---

The executed document: with `Field.configure({ values })`, a PDF export prints each completed value in its field's box. A drawn signature keeps its proportions, a typed value prints as text, and an uncompleted field prints as the empty field. The values never enter the document. `PdfImageOp` gains `fit: "contain"`. `FieldValue` now comes from `@scrivr/core`; `@scrivr/plugins` still exports it.
