---
"@scrivr/core": patch
---

`getActiveFontFamily` can say that a selection is drawn in more than one family.

It answered from the first run, so a range covering Georgia and Arial named
Georgia — confidently, and wrongly for half the text. A reader confirming it from
the dropdown restyles everything else in the range, which is the same failure
`getActiveFontSize` had.

`ActiveFontFamily` gains `mixed: boolean`. Additive rather than a new return
shape: `requested`, `resolved` and `substituted` keep answering exactly as they
did, so a control that does not read `mixed` behaves as before, and one that does
shows nothing — the way Word and Google Docs blank a font box over a mixed
selection. The playground's family control blanks on it, as its size control
already does.

The only thing an existing consumer can notice is an exact-shape comparison:
`toEqual({ requested, resolved, substituted })` now needs the new field. Reading
properties is unaffected.
