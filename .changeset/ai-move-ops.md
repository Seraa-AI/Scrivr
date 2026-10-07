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
ghost text, streamed insertion, and citation reveal. Writing into a shadow used
to succeed, report success, and then evaporate when the deletion was accepted.

A node is a shadow when a pending deletion covers its whole range, which is how
an empty node and the children of a deleted container are recognised — neither
carries a tracked mark of its own. The ranges are memoised on the document node,
so a batch resolving many ids walks it once, and a document whose schema has no
`trackedDelete` mark skips the walk entirely.

`findNodeById` in `@scrivr/core` gained an optional `accept` predicate and now
returns the first match that satisfies it, stopping there — previously it
returned the *last* match regardless, despite a comment claiming it stopped at
the first. Core still knows nothing about tracking; the predicate is what lets
the plugins layer own that rule.

Three tracking replay defects the moves surfaced:

- reverse replay mapped from the wrong document, counting only removed pending
  inserts, so retained insertions before a position were lost. It now composes a
  bridge from each step's forward map, the prior bridge, and the replay steps.
- the inverse step's end boundary swallowed a later insertion at the same
  position, so moving a block and inserting beside it lost the second edit. A
  collapsed range stays collapsed.
- a tracked node insertion put inline tracking marks inside parents whose schema
  forbids them, such as a code block, producing an invalid document. Child marks
  are now filtered through the parent's `allowedMarks`; the node-level change
  stays reviewable.
