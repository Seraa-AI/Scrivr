---
"@scrivr/core": patch
"@scrivr/export-semantic": patch
"@scrivr/plugins": patch
"@scrivr/ai": patch
---

Agents can read the document as originally agreed, and structural edits know
when what they name has changed.

- **The original view.** `toSemanticUnits(editor, { view: "original" })` and
  `ai.getRichBlocks({ view: "original" })` read the document as it was before
  every pending proposal — what rejecting all of them would leave, computed by
  TrackChanges' own Reject on a copy. Its units say `view: "original"` and carry
  no `changes`. `SemanticTextView` is now `"proposed" | "original"`, and
  `SemanticHandlers` gains `documentIn(doc, view)`.
- **Only the proposed view is editable.** `applyRichEdit` reports a unit read in
  another view under the new `wrongView` list and writes nothing for it. A unit
  hash covers its view when it is not the proposed one; proposed hashes are
  unchanged.
- **Structural ops carry hashes.** `expectedContentHash` on an op's own block
  and `anchorContentHash` on its anchor; a mismatch is reported in `stale` and
  nothing is written. `applySemanticEdits` returns `SemanticEditResult`, which
  adds `alreadyProposed` (a delete whose block another author already proposed
  for deletion) and `anchorProposedForDeletion` (an anchor that disappears on
  Accept). Both were refused before, inside `rejected`.
