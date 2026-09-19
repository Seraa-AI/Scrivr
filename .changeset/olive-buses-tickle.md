---
"@scrivr/docx": patch
"@scrivr/plugins": patch
---

Importing a DOCX into a document with track changes on no longer rewrites it as one giant edit.

A load is not an authored edit, but nothing said so. Track changes saw the
whole outgoing document deleted and the whole incoming one inserted, marked
both, and produced content a `doc` node cannot hold. `applyImportedDocument`
now marks the transaction as a load, on both the generic `initialContent` key
and Track Changes' own skip action.

Track changes also reads that marker off a transaction a plugin appended in
response to the load — pagination and collaboration bookkeeping both append
one. It was looking for ProseMirror's original under `appendTransaction`;
the key is `appendedTransaction`, so it had never found one, and four
conditions that consult it had never fired.
