---
"@scrivr/core": patch
"@scrivr/docx": patch
---

The List extension reads the lists it writes.

OOXML has no list element — a list is a run of paragraphs sharing a `<w:numPr>`
— and reassembling that nesting lived in `@scrivr/docx` rather than on the
extension that declares `bulletList`, `orderedList` and `listItem`. The walker
went further than not moving it: a registered `list` handler was skipped
outright, so the extension could not have owned this even by declaring it.

`List.addImports()` owns it now, reading each item's children through
`ctx.walkBlocks` so whatever owns a paragraph or a table inside a list item
still renders it. Lists were the last node handler living outside its
extension.

**Behaviour change for a kit without lists.** Such a document lost its list
content before and still does, but the diagnostic changes from
`schema-missing-list` to `unsupported-block`, which is in the fatal set — so
`importDocx(…, { unsupported: "throw" })` now rejects a file whose lists cannot
be modelled instead of accepting it with the content quietly gone.
