---
"@scrivr/ai": patch
"@scrivr/plugins": patch
"@scrivr/react": patch
---

Two things the AI review surface could not express.

**A marker that proposes no edit.** A finding can be a Pass, or a decision a
person has to make. `computeAiSuggestion` drops a block whose proposed text
matches what is already there, which is correct — a diff overlay is not where a
finding with no change belongs — and there was no other layer, so such a
finding existed in the panel and nowhere the reader was looking.

`BlockMarkers` is that layer. `setBlockMarkers(editor, source, markers)` hangs
`{ nodeId, kind, summary }` on a block, `getBlockMarkers` reads them,
`activeBlockMarkers` answers the ones on the innermost marked block holding the
cursor, and `createBlockMarkerOverlay` — with `useBlockMarkerOverlay` in
`@scrivr/react` — gives them the show / move / hide lifecycle the suggestion
popover has.

Every call names its writer, which is what makes the layer additive: several
bridges write to the same surface and none owns it, so a writer replaces and
clears its own markers without erasing what the others say. Nothing is written
to the document and nothing enters history. A marker whose block has left the
document is dropped on read, and markers resolve in one pass over the document
rather than one walk each. `BLOCK_MARKERS_SET` is public, so a payload whose
markers are not markers is refused whole rather than half-applied.

**Accepting a span rather than a block.** `accept(blockId)` applied every op the
block carried, so a finding scoped to one sentence rewrote the clause around it.
`applyAiSuggestion` now takes `range`, and `actions.acceptRange(blockId, range,
mode?)` exposes it. It returns whether it wrote, so a refusal is visible instead
of silent — including through `AiToolkit.apply`.

`range` carries the accepted text its offsets were measured against, and is
refused unless the block still holds that text. This is the part that makes a
scoped accept safe: settling rewrites a block's `acceptedText`, so comparing the
document against it proves nothing, and a caller still holding offsets from
before an earlier accept would edit whichever words now sit at those numbers.
Also refused: a span that is inverted, collapsed, or reaches outside the block.

Only groups the span covers are applied; one it merely clips is left pending. A
pure insertion is zero-width, so it belongs to the single span that starts at or
before its point and ends strictly after — otherwise both neighbouring sentences
claimed it. Every covered group is applied in one pass and settled as one set:
`rebaseAfterSettle` now takes the set of settled groups, because told one at a
time it read the pass's own writes as reader drift and discarded the groups the
span deliberately left pending.

**`docRangeToAcceptedRange`** (`@scrivr/plugins`) converts a document range to
the accepted-text offsets `range` wants. Only the forward direction existed, and
accepted text omits runs pending deletion, so arithmetic on document positions
was wrong in exactly the tracked-changes documents this serves — and wrong
silently.

**Drift has one owner, and it is no longer silent.** `staleBlockIds` had two
production readers — the card's `isStale` and the canvas overlay, which dims a
stale block — and no writer at all, so both read false for every block forever.
The plugin now computes it whenever the answer can change: a new suggestion (a
host can hand over one that was already out of date), a settled one (the rebase
refreshes each surviving block against the document the settlement left), or an
edit. Identical answers return the previous state unchanged, so the card
subscription's identity skip still holds.

Every accept path reads it and refuses a block the reader has edited since the
proposal was computed — the unscoped block accept, a group accept, and accept-all
as well as the new span accept. Previously only the span accept checked, so one
card had a button that refused and a button that wrote the model's words into
text that had moved: `"The quick fox"` edited to `"!The quick fox"` and then
accepted produced `"!Theslowk fox"`. Accept-all still applies the blocks that do
match and leaves the drifted ones pending, because an edit in one block says
nothing about the rest.

`AiSuggestionCardActions` gains a required `acceptRange`, so a hand-written
implementation of that interface needs the new member. `applyAiSuggestion` and
`AiToolkit.apply` returning `boolean` instead of `void` is a widening and breaks
no caller.
