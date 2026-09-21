---
"@scrivr/core": patch
"@scrivr/export-pdf": patch
"@scrivr/plugins": patch
"@scrivr/docx": patch
---

Fit a run to its measured width only when the same face measured it

Character spacing was applied to every text span, including the path where no
`FontProvider` is supplied. There the layout was measured in whatever the
browser made of a family name and is painted in a standard face, so the width
difference is a different typeface rather than two engines disagreeing —
closing it letterspaced the text by up to 15% of the em. Only the path that
reuses the screen's layout, where the same bytes measured and paint, may fit a
run; and the adjustment is refused outright past a couple of percent, since a
gap that wide means the premise is false.

The export asked for every face the *session* had resolved rather than the ones
the document uses. A family applied and then removed was still fetched,
embedded into the file, reported to `onFontShortfall`, and could force the whole
document to be typeset again. Both the export and `Editor.fontSubstitutions`
now read one walk of the laid-out spans.

Two resource-less answers no longer count as agreement: neither side named a
face, so the screen measured a host font and the file would paint a standard
one. That case lays out again, as it did before.

An inline image no longer interns a font resolution — it has fixed dimensions
and is not set in a face, so resolving one reported a substitution for a
typeface nothing was drawn in. Atoms sized from a font, such as page-number
tokens, still carry theirs.

Also: the font path refuses a partial layout, as the other path already did;
`TextMeasureContext`, `TextMeasurerOptions`, `FontKey`, `FontSynthesis` and
`FontResolutionId` are exported from the barrels that already expose types
built on them; and the op-log gate records pushed text state, which is why the
letterspacing above changed every baseline's rendering without moving a
snapshot.
