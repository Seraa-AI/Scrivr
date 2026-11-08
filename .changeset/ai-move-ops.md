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
ghost text, streamed insertion, block markers, and citation reveal (which still
reveals a block proposed for deletion, since it is on screen until decided). Writing into a shadow used
to succeed, report success, and then evaporate when the deletion was accepted.

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

One batch moves a node once: a move or delete of content the batch already
moved — the same node by another of its ids, something inside it, or something
holding it — is refused, since a second overlapping delete/insert pair would
replay into a duplicated block. A list op named by a nested list, which is
neither an item nor its text, is refused too.

Tracking pairs a deletion with an insertion as a move only when they match, and
a node carrying an id only with a copy carrying the same id. An insertion
earlier in a batch no longer claims a move's deletion, and two blocks that only
read the same — two empty paragraphs — are no longer paired with each other.
