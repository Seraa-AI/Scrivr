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
- `SemanticPart` gains `changes`. `SemanticHandlers` gains `nodeChanges`, for
  review records written on a node rather than on its text; it returns the new
  `SemanticNodeChange` type. `UnitCtx` gains `doc`, the document being read.
  `semanticImage(node)` is exported from `@scrivr/core`.
- TrackChanges reports pending insertions, deletions (including line breaks),
  block insertions and deletions, paragraph joins and splits, heading, list and
  formatting changes, wrapped and structurally moved nodes, table rows and
  moves. The pieces of one act read as one change.
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
- **A block proposed for deletion now appears in `getRichBlocks`,** reading
  `text: ""` with its deletion in `changes`. A move's shadow stays out.
- **A deleted hard break leaves `text`,** where it used to read as `"\n"`.
- **`markdown` is omitted on units with any pending change,** not only those
  with pending deletions.
