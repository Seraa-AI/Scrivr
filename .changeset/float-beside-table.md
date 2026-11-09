---
"@scrivr/core": patch
---

A floating image with square or top-and-bottom wrap no longer paints over a
table beside it. The table moves below the image as one unit, as Word does, and
is never narrowed; screen, cell clicks, PDF and DOCX export all follow. A float stays
on its anchor when a table or paragraph above that anchor moves. A square float
that would overlap another moves below it and its paragraph stays put, where
before the paragraph was pushed down too. A float whose own wrap keeps moving its
anchor locks at the placement it keeps returning to, so text wraps around it
instead of under it. A dragged image lands where it was dropped, stacked,
clamped or locked, on the page it was dropped on; dropped on a paragraph
carried over from the previous page, it anchors to the nearest paragraph that
starts on that page, as in Word. DOCX export marks
square images `allowOverlap="0"`, so Word stacks them the same way, and keeps
the user's offset rather than the stacked position.

In documents without floats, blocks no longer leave a blank band under the
first block of a page, matching Word.

`ExclusionManager.getNextFreeY` now takes `height, contentX, contentWidth` and
also clears side-wrap rects: it returns the first y where a band of that height
leaves the whole content width free.

`AnchoredObjectPlacement` gains an optional `stackOffset`: how far the solver
moved a stacked image below the float it would overlap. `globalY` includes it;
the user's `yOffset` does not.
