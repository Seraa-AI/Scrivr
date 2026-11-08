---
"@scrivr/core": patch
"@scrivr/plugins": patch
"@scrivr/ai": patch
---

Semantic move ops, and the tracking defects they exposed.

`moveBlock` and `moveListItem` join `StructuralSemanticEditSchema`, so an agent
can reorder a document by naming a node and an anchor. They apply as
delete-at-old plus insert-at-new in one transaction and the track-changes engine
pairs them into a single `CHANGE_OPERATION.move` on its own — accepting or
rejecting it is one decision that resolves the shadow with it. No new tracked
representation was needed. `moveListItem` takes an item id or a leaf inside it,
and refuses a cross-list move before writing any steps.

A pending move leaves a deleted shadow and a live copy carrying the same
`nodeId`, so neither "first match" nor "last match" is a correct rule: document
order puts the shadow first for a move down the document and last for a move up
it. `findLiveNodeById` in `@scrivr/plugins` is the one place that decides, and
every consumer that resolves an id against a tracked document now uses it —
rich edits, structural edits, drift detection, suggestion overlays and popovers,
ghost text, streamed insertion, block markers, and citation reveal. Citation
reveal still reaches a block proposed for deletion, since it is on screen until
decided. Writing into a shadow used to succeed, report success, and then
evaporate when the deletion was accepted.

A node is a shadow when a pending deletion covers its whole range, which is how
an empty node and the children of a deleted container are recognised — neither
carries a tracked mark of its own. `shadowRanges`, `isShadowNode` and the
`ShadowRange` type are exported for a host resolving ids itself, and
`@scrivr/ai` re-exports `findLiveNodeById` beside `findNodeById`. The ranges are
memoised on the document node, so a structural batch resolving many ids walks
it once, and a document whose schema has no `trackedDelete` mark skips the walk
entirely. An agent reading rich blocks sees one unit per id — the live copy —
and a rich edit to a block held only by a pending deletion is rejected, not
reported as both changed and missing.

`findNodeById` in `@scrivr/core` gained an optional `accept` predicate and now
returns the first match that satisfies it, stopping there — previously it
returned the *last* match regardless, despite a comment claiming it stopped at
the first. Core still knows nothing about tracking; the predicate is what lets
the plugins layer own that rule.

A batch touches content once. A move or delete overlapping content the batch
already moved or added to — the same node by another of its ids, something
inside it, or something holding it — is refused, and so is adding an item or
row inside content the batch moved; tracking replays a batch as one gesture, so
overlapping work would duplicate a block or cancel the batch. A list or table op
named by a node that holds several of what it acts on, such as a nested list, is
refused too.

Tracking pairs a deletion with an insertion as a move only when they match, and
a deleted block carrying an id only with a copy carrying the same id. An
insertion earlier in a batch no longer claims a move's deletion; a new block,
or another, that only reads the same as a deleted one — two empty paragraphs, a
`deleteBlock` beside an `insertBlock` of the same text — is a deletion and an
insertion, not a move. Block markers stay on a block proposed for deletion,
which is on screen until decided.

Two review defects the move work surfaced in the tracking engine: rejecting a
block added right after a list or table, together with a move made since, no
longer deletes the list's text and fails; and deleting a paragraph while typing
its words elsewhere in one transaction is a deletion and an insertion rather
than an error.
