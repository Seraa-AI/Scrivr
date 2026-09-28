---
"@scrivr/ai": patch
---

A formatting proposal is now something the reader can see, point at and accept.

Proposing formatting computed and applied correctly and showed nothing. Its
words do not change, so it produces no delete strike and no insert caret, and
the overlay skipped `keep` ops entirely — the card offered a change that had no
mark on the page and no position to anchor to.

`marks` on a `keep` now means one thing: the formatting *here* changes. A run the
proposal restates unchanged carries none, so a single field answers what the
overlay draws, what the apply writes, and what a card counts. That also removes
the second derivation of "did the formatting change" — it is read off the ops
themselves now, so the preview and the result cannot disagree about it.

Each such run gets its own `groupId`, so formatting is accepted the way a word
swap is: one run at a time, scoped to the text that run spoke about. Accepting a
word swap still touches no formatting, because it is a different group.

New: a `format` render instruction and `renderFormatHighlight`, drawn as a solid
underline beneath the run — distinct from the dashed red of a deletion, because
this text is staying and only its appearance is in question. A wrapped run draws
one stroke per line rather than a rule across the gap between them.
`SuggestionGroupInfo` gains `formattedText`, so a popover rendering
`replacedText → insertedText` can tell that a group proposes appearance rather
than wording and describe it accordingly.
