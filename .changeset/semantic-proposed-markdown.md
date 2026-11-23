---
"@scrivr/core": patch
"@scrivr/export-semantic": patch
"@scrivr/plugins": patch
---

A semantic unit with pending review changes keeps its `markdown`, which reads as the proposal would. Before, it was dropped, so an agent read a line with a pending change without its bold, italics or links.

- The markdown is rendered from the document with every pending change accepted. Track Changes supplies that document through a new `semantic` contribution hook, `proposedDocument`, using the engine's own Accept on a copy, as the original view uses its Reject.
- `text`, `spans` and `changes` are unchanged, so the changes still say what is proposed and where.
- A block proposed for deletion has no markdown. A unit whose changes no contribution can resolve keeps having none, rather than writing redlines into it.
- The unit hash does not cover `markdown`, so pinned hashes stay valid.
