---
"@scrivr/ai": patch
---

Two things the AI review surface could not express.

**A marker that proposes no edit.** A finding can be a Pass, or a decision a
person has to make. `computeAiSuggestion` drops a block whose proposed text
matches what is already there, which is correct — `ai.suggestions` is a diff
overlay and a finding with no change is not a diff. There was simply no other
layer, so such a finding existed in the panel and nowhere the reader was
looking.

`BlockMarkers` is that layer. `setBlockMarkers(editor, source, markers)` hangs
`{ nodeId, kind, summary }` on a block, `getBlockMarkers` reads them,
`activeBlockMarkers` answers the ones on the block holding the cursor, and
`createBlockMarkerOverlay` gives them the show / move / hide lifecycle the
suggestion popover has. Every call names its writer, which is what makes the
layer additive: several bridges write to the same document surface and none of
them owns it, so a writer replaces and clears its own markers without erasing
what the others are saying. Nothing is written to the document and nothing
enters history — a marker is about a block, not in it — and a marker whose
block has left the document is dropped on read.

**Accepting a span rather than a block.** `accept(blockId)` applied every op
the block carried, so a finding scoped to one sentence rewrote the clause
around it. `applyAiSuggestion` now takes `range`, offsets into the block's
accepted text, and `actions.acceptRange(blockId, range, mode?)` exposes it.

Only groups the span covers whole are applied: half a replacement is not a
smaller replacement, so a group the span merely clips is left pending. The
span is resolved against the live document at accept time — the block's
accepted text is read back and compared, and a block the reader has edited
since is refused rather than approximated, because the same offsets now
address different words than the proposal was about. `applyAiSuggestion`
returns whether it wrote, so a refusal is visible instead of silent.
