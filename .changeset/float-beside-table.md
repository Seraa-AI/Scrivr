---
"@scrivr/core": patch
---

A floating image with square or top-and-bottom wrap no longer paints over a
table beside it. The table moves below the image as one unit, as Word does, and
is never narrowed; screen, cell clicks, PDF and DOCX export all follow. A float stays
on its anchor when a table or paragraph above that anchor moves. A square float
that would overlap another moves beside it while the column has room, and below
it otherwise, as Word does; its paragraph stays put, where before the paragraph
was pushed down too. A float whose own wrap keeps moving its
anchor locks at the placement it keeps returning to, so text wraps around it
instead of under it. A dragged image lands where it was dropped, stacked,
clamped or locked, on the page it was dropped on; dropped on a paragraph
carried over from the previous page, it anchors to the nearest paragraph that
starts on that page, as in Word; a square or top-and-bottom image dropped
there can still land a little below the drop. DOCX export marks
square images `allowOverlap="0"`, so Word keeps them apart too, and keeps the
user's offset.

An image anchored in a table cell is laid out in that cell, as Word does with
`layoutInCell`: the cell's text wraps around it, the row grows to hold it, and
it moves with its row; an image wider than its cell is scaled down to fit.
Dropping an image onto a table cell anchors it there;
dragging it out of the table anchors it back in the body. An image painted
over a table now takes the click, as its cursor shows; one behind the table
leaves the click to the cell.

In documents without floats, blocks no longer leave a blank band under the
first block of a page, matching Word.

A word too wide for the gap beside a square image now goes below the image, as
Word wraps it, instead of overflowing past the gap (in a narrow table cell it
ran into the next cell).

**Migration:** a dragged image's custom `x` (`xAlign: "custom"`) is now measured
from the content area's left edge, as the schema documents and as DOCX writes
it (`relativeFrom="column"`). Layout and drag used the page's left edge, so a
body image dragged sideways in an older document moves right by the left margin
when reopened, and Word files now open with images where Word put them. A named
`xAlign` (left, center, right) now wins over a leftover `x` in DOCX export, as
it does in layout.

`ExclusionManager.getNextFreeY` now takes `height, contentX, contentWidth` and
also clears side-wrap rects: it returns the first y where a band of that height
leaves the whole content width free.

`AnchoredObjectPlacement` gains an optional `stackOffset`: how far the solver
moved a stacked image below the float it would overlap. `globalY` includes it;
the user's `yOffset` does not. (Where an in-cell image is laid out is described
with the composite layout: `regionPos`, `LaidRegion.floats`.)
