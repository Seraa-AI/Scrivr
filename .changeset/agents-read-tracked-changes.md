---
"@scrivr/core": patch
"@scrivr/export-semantic": patch
"@scrivr/plugins": patch
"@scrivr/ai": patch
---

Agents read pending tracked changes and can review them.

- `SemanticChange` gains `suggestedInsert` and `suggestedAttrs`, and the fields
  `at`, `length`, `moveId` and `oldAttrs`. Each change is placed by offset into
  the text it belongs to: `unit.text`, `part.text` or `cell.text`.
- `SemanticPart` gains `changes`. `SemanticHandlers` gains `nodeChanges`, for
  review records written on a node rather than on its text.
- TrackChanges reports every pending record: insertions, block insertions and
  deletions, paragraph joins and splits, heading and list changes, table rows
  and moves. The pieces of one act read as one change.
- `getRichBlocks` keeps a block proposed for deletion, which reads `text: ""`
  with its deletion. A move's shadow stays out.
- `ai.reviewChanges(decisions)` accepts or rejects changes by the ids an agent
  read. It is a pass-through to `reviewChanges`, so the host's
  `canAcceptReject` still decides whether an agent may review.

One-time changes to watch for:

- **Hashes change for units that carry review changes.** `unitRichHash` and
  `semanticPartRichHash` now cover `changes` when there are any. A unit with
  none hashes exactly as before. A unit that already carried a
  `suggestedDelete` gets a new hash after this release, so an
  `expectedContentHash` pinned before the upgrade reads `stale` once.
- **`markdown` is omitted on units with pending insertions,** as it already was
  on units with pending deletions.
