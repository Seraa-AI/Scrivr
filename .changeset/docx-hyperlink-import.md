---
"@scrivr/core": patch
---

Import hyperlinks from DOCX.

`Link` declared how a link is written to a .docx but not how one is read back,
so the `hyperlink` mark the parser produced reached Stage 2 unclaimed. Every
link in an imported document arrived as ordinary text, and the only trace was
an `unsupported-mark` diagnostic no UI surfaces — a round-trip through Word
silently flattened every link in the file.

`Link.addImports()` now claims it, resolving the relationship id through the
part's rels (so links inside headers and footers resolve against their own
part, not the document's). `w:anchor` — a link to a bookmark inside the
document — becomes a fragment target, the nearest thing the schema holds.

Targets pass `safeUrl`. A .docx is untrusted input and its rels are an
ingestion path like paste or programmatic insert, so a hostile target is
dropped rather than stored.
