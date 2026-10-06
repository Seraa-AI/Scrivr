---
"@scrivr/ai": patch
---

The op walkers stop re-deriving the same two rules.

`_applyDirect`, `_applyTracked`, `rejectAiSuggestion` and `applyKeepFormatting`
each resolved a suggestion's blocks in reverse document order and each advanced
its own accepted-text offset, with the same three-branch bookkeeping. Both rules are
easy to get subtly wrong and invisible when you do: reverse order only matters
when two blocks settle in one pass, and the offset rule only shows up as a
change landing a few characters off.

`resolveBlocksInReverse` states the ordering once. The offset rule was already
stated once — `withAcceptedOffsets`, added for the slash-command work — so the
walkers read from it rather than keeping a counter each, and the keep and
out-of-scope branches lose their bookkeeping entirely.

`rejectAiSuggestion` also carried a fourth copy of the scope predicate, written
inline as a single-group comparison. It uses `inScope` like the other two:
rejecting one group and applying one group ask the same question of an op, and
the odd one out is the site that gets missed when a ranged reject lands.

`applyKeepFormatting` reads both shared rules too, though its ordering is
immaterial — it writes marks only, so no position moves. It reads the shared
resolve anyway, so a later change to either rule reaches every walker.

What is left in each walker is only what genuinely differs — how a delete and
an insert are written, and how much the text has shifted so far, which is why
`insertedChars` stays local: a tracked delete marks text instead of removing
it, so it shifts nothing.

No behaviour changes; the suite is unchanged at 208.
