---
"@scrivr/core": patch
---

A floating image with square or top-and-bottom wrap no longer paints over a
table beside it. The table moves below the image as one unit, as Word does, and
is never narrowed; screen, cell clicks and PDF export all follow. A float stays
on its anchor when a table or paragraph above that anchor moves. A square float
that would overlap another moves below it and its paragraph stays put, where
before the paragraph was pushed down too. A float whose own wrap keeps moving its
anchor is locked where it stands, so text wraps around it instead of under it.

`ExclusionManager.getNextFreeY` now takes `height, contentX, contentWidth` and
also clears side-wrap rects: it returns the first y where a band of that height
leaves the whole content width free.

`AnchoredObjectPlacement` gains an optional `stackOffset`: how far the solver
moved a stacked image below the float it would overlap. `globalY` includes it;
the user's offset from the anchor is `globalY - stackOffset - anchorGlobalY`.
