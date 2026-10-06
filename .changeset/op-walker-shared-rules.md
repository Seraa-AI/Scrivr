---
"@scrivr/ai": patch
---

The op walkers stop re-deriving the same two rules.

`_applyDirect`, `_applyTracked` and `applyKeepFormatting` each resolved a
suggestion's blocks in reverse document order and each advanced its own
accepted-text offset, with the same three-branch bookkeeping. Both rules are
easy to get subtly wrong and invisible when you do: reverse order only matters
when two blocks settle in one pass, and the offset rule only shows up as a
change landing a few characters off.

`resolveBlocksInReverse` states the ordering once. The offset rule was already
stated once — `withAcceptedOffsets`, added for the slash-command work — so the
walkers read from it rather than keeping a counter each, and the keep and
out-of-scope branches lose their bookkeeping entirely.

`rejectAiSuggestion` stops walking ops altogether, which is the one behaviour
change here. It used to remove `trackedInsert` text and `trackedDelete` marks,
reading the same offsets as the apply walkers. That body could not be reached
with marks present: applying settles the group out of the suggestion, so reject
only ever sees ops that were never applied, and re-showing an applied proposal
hands it offsets into a snapshot the document no longer matches. Reject now
discards pending ops and touches neither content nor review marks. A change that
has already been applied in tracked mode is a tracked change, and
`editor.commands.setChangeStatuses` rejects it by its id — the API that
addresses it.

`{ blockId, groupId }` together now mean what they say: a group that does not
belong to the named block is a no-op, where before the block filter was dropped
and the group settled wherever it lived.

`applyKeepFormatting` reads both shared rules too, though its ordering is
immaterial — it writes marks only, so no position moves. It reads the shared
resolve anyway, so a later change to either rule reaches every walker.

What is left in each walker is only what genuinely differs — how a delete and
an insert are written, and how much the text has shifted so far, which is why
`insertedChars` stays local: a tracked delete marks text instead of removing
it, so it shifts nothing.

The walker changes are behaviour-neutral; the reject change is not, and
`rejectBoundary.test.ts` pins what it must not disturb — a prior tracked
insertion, a human deletion inside the accepted-text range, and a sibling group
that is still applicable over tracked text — across all three reject scopes.
