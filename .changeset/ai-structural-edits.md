---
"@scrivr/core": patch
"@scrivr/ai": patch
---

The AI edit protocol can now change a document's shape, and every node can say
what happened to it.

`applySemanticEdits` handles the six structural ops — `insertBlock`,
`deleteBlock`, `insertListItem`, `deleteListItem`, `insertTableRow`,
`deleteTableRow` — alongside the inline `richText` edits it already took. Each
addresses the document through a `nodeId` the agent was shown plus a side:
"an item after this one", never an index or a document position. An id may name
a container or the leaf inside it, and ops that act on a container climb to it,
because the agent sees leaves.

Nothing in the adapter marks a change as tracked. The engine already tracks the
transactions it sees, so an op's whole job is to resolve an anchor and build a
node; a structural batch is one transaction, and so one undo step and one review
unit.

**Every node now declares `dataTracked`.** It was on paragraphs, headings, code
blocks and lists, and missing from tables, images, horizontal rules, page breaks,
section breaks and hard breaks. A node without it is not rejected by the
engine — it is skipped, and the change is either attributed to a neighbour or
lost outright. Two consequences were live: inserting an image recorded no change
at all, and accepting a suggested table-row deletion left the row behind, empty,
because only the text inside it had been marked. A schema test now fails if a
node is added without it.

`deleteTableRow` names its target `nodeId`, matching `deleteBlock` and
`deleteListItem`. It was `anchorNodeId`, and everywhere else in this protocol an
anchor is a neighbour you position against rather than the thing being acted on —
an agent reading the three delete ops together would reasonably have concluded it
deleted the row beside the one it named.

**Breaking:** `parseRichEdits` is `parseSemanticEdits` and validates the whole
protocol rather than the inline half — a structural edit fed to the old name was
rejected as malformed. `applySemanticEdits` no longer returns `unsupported`. The
field could never be populated: the union it guarded had one member, and now the
schema itself refuses an op it does not define, by name, at parse time. A caller
reads `rejected` from the parse instead.
