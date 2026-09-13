---
"@scrivr/export-pdf": patch
---

An extension can style its own mark in a PDF.

`PdfHandlers.marks` was declared but never collected or dispatched, so a mark
from outside the built-in set could not appear in an export at all. Marks are
now dispatched once per mark, per span.

`PdfSpanStyle` changes shape: colours are CSS strings rather than pdf-lib
triples, and it gains `defaultColor` for a colour a mark supplies by being what
it is, which loses to an authored `color`. Although the old lane was inert,
consumer code may already use its published types and needs migration. See
`docs/export-extensibility.md` for the type and context changes. This is a
patch release under the beta release policy.

No built-in mark's rendering changes here. The highlight default changes in the
sibling note below.
