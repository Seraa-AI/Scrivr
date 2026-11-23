---
"@scrivr/core": patch
"@scrivr/export-semantic": patch
"@scrivr/plugins": patch
---

A semantic unit with pending review changes keeps its `markdown`, which reads as the proposal would. Before, it was dropped, so an agent read a line with a pending change without its bold, italics or links.

- The markdown is rendered from the document with every pending change accepted. Track Changes supplies that document through a new `semantic` contribution hook, `proposedDocument`, using the engine's own Accept on a copy, as the original view uses its Reject.
- `text`, `spans` and `changes` are unchanged, so the changes still say what is proposed and where.
- A unit gets this markdown only where the accepted document holds its blocks reading exactly as its `text`, rendered through its own node handler. So it never carries another unit's words. It has none in these cases:
  - a block proposed for deletion;
  - a move's old place;
  - a block a pending deletion joins to the next;
  - a block with no stored id;
  - a table with merged cells, as before.
- Without a contribution that supplies the accepted document, or if supplying it fails, a unit with changes has no markdown, rather than redlines. The export never fails because of it.
- The unit hash does not cover `markdown`, so pinned hashes stay valid.
