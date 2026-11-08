---
"@scrivr/core": patch
"@scrivr/export-semantic": patch
"@scrivr/plugins": patch
"@scrivr/ai": patch
---

Agents read pending tracked changes and can review them.

- `SemanticChange` gains `at`, `length`, `moveId`, `oldAttrs` and `image`.
  Each change is placed by offset into the text it belongs to: `unit.text`,
  `part.text` or `cell.text`. Its `id` is the act's id, the one to pass to
  `reviewChanges`, shared by every piece of the act.
- `SemanticPart` gains `changes`. `UnitRichInput.changes` and
  `SemanticPartRichInput.changes` carry them into the rich hashes.
- `SemanticUnit` and `SemanticPart` gain `proposedForDeletion: true` when the
  block itself — not only its text — is proposed for deletion. Such a unit
  cannot be edited (`applyRichEdit` rejects it) or placed after.
- `@scrivr/export-semantic` re-exports `SemanticImage` and `SemanticPart`.
- `SemanticHandlers` gains `nodeChanges`, which runs for every node, text
  included: it reports records on a block's own attrs and on a text node's
  formatting marks, returning `SemanticNodeChange[]` (exported from
  `@scrivr/core` and `@scrivr/export-semantic`). It also gains
  `isMarkRemoved`, so a formatting mark proposed for removal is left off the
  proposed spans.
- `UnitCtx` gains `doc`, the document being read. **It is required:** code
  that builds a `UnitCtx` itself, such as a mock in a handler test, must now
  supply it.
- `semanticImage(node)` is exported from `@scrivr/core`; `moveShadowRanges(doc)`
  from `@scrivr/plugins`.
- TrackChanges reports pending insertions, deletions (including line breaks),
  block insertions and deletions, paragraph joins and splits, heading, list and
  formatting changes, wrapped and structurally moved nodes, table rows and
  moves. An act reads as one change per type: a replacement or a move is its
  two halves under one id, a formatting change over text with different
  prior marks is one change per run, and each image an act adds or removes is
  a change of its own — all under the act's id. An insertion reads what
  remains of it in the proposed text. Text whose deletion is already decided
  stays in the proposed text, as `proposedForDeletion` reads it.
- A tracked record naming an operation the engine does not know — including
  one like `"toString"` from a synced document — is read as an unknown
  operation instead of breaking `findChanges`.
- `ai.reviewChanges(decisions)` accepts or rejects changes by the ids an agent
  read, returning the `ReviewOutcome` type from `@scrivr/plugins`. It is a
  pass-through to `reviewChanges`, so the host's `canAcceptReject` still
  decides whether an agent may review.

**`SemanticChange.type` gains two members**, `suggestedInsert` and
`suggestedAttrs`. An exhaustive `switch` on it, or code that assumed every
change is a deletion, must handle both.

One-time changes to watch for:

- **Hashes change once for any unit with a pending change.** `unitRichHash` and
  `semanticPartRichHash` now cover `changes` when there are any. A unit with
  none hashes exactly as before. An `expectedContentHash` pinned before the
  upgrade on a unit with any pending change reads `stale` once.
- **Change ids stored before the upgrade can change.** `SemanticChange.id` is
  now the act's id: both halves of a replacement or a move, and every piece of
  a block act, report one id.
- **A block proposed for deletion now appears in `getRichBlocks`,** reading
  `text: ""` with its deletion in `changes`. Only the copy a pending move
  leaves behind stays out.
- **A deleted hard break, and a formatting mark proposed for removal, leave the
  proposed view,** where they used to read as present.
- **`markdown` is omitted on units with any pending change,** not only those
  with pending deletions.
