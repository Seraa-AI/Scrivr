---
"@scrivr/core": patch
"@scrivr/plugins": patch
"@scrivr/ai": patch
---

Agent-proposed formatting is held to the document's own rules.

`resolveInlineMark` is the one place that decides what an agent's mark may be,
and it now refuses review marks and strips `dataTracked` from the ones it
allows. Proposed formatting said how text should read; it could also say who
reviewed it and when, which let agent output sign a change as another author.

Marks are also resolved against the textblock that will hold them. A bold run
proposed for a code block — which allows no marks — used to survive until
dispatch and then throw, taking the whole batch with it; the words land
unstyled instead, which is what the proposal meant.

Formatting comparison runs on one canonical description (`describeInlineMark`),
so bookkeeping a document carries and a proposal does not can no longer read as
a difference. Restating a block's existing formatting is not a suggestion.

Tracked formatting is applied with explicit suggestion intent rather than by
relying on the engine's ambient status. `mode: "tracked"` on an editor whose
tracking is switched off — the default — wrote formatting permanently, with no
review record to reject.

Table row inserts derive width from the grid and the row's spans rather than
counting physical cells, so a row anchored to a merged cell no longer drops the
content past the first column. Deleting the last child of a list or table
removes the container instead of leaving an empty one behind.
