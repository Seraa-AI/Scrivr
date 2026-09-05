---
"@scrivr/core": patch
---

Copy a table, and get a table back. Pasting one used to keep the rows and cells
and drop everything that made it a particular table: `colspan` and `rowspan`
collapsed to single cells, column widths, alignment, and cell shading were all
discarded, and a Word table's merges arrived as ragged rows. Scrivr's own copies
came back the same way, so a table could not survive a round trip through the
editor that produced it.

Table markup now translates in both directions. `gridSpan`, column widths,
horizontal and vertical alignment, and cell fill are read on paste and written
on copy, so a table pasted from Word or Google Docs keeps its shape, and one
copied out of Scrivr arrives in them as the table it was.

Vertical merges needed the translation to happen before parsing. HTML omits the
cells a `rowspan` covers, while the schema keeps a real cell per row — and once
ProseMirror has read the markup, a covered row is merely short, with no way to
tell which columns it is short by. Pasted markup is therefore rewritten into one
cell per row first, and collapsed back to `rowspan` on the way out.

- **`@scrivr/core`** — new extension hook `addPasteHtmlTransforms()`, for
  rewriting pasted HTML before it is parsed. The existing `addPasteTransforms()`
  runs on the parsed slice, which is too late for markup whose meaning lives in
  the tree shape. `PasteHtmlTransform` is exported alongside `PasteTransform`.
- **`@scrivr/core`** — a table cell's `background-color` survives paste. Pasted
  styles are stripped of incidental background colours, which was right for text
  spans and wrong for a cell, whose fill is document content.
- **`@scrivr/core`** — a cell's fill is only ever painted, so only a colour is
  accepted into the model: `url(...)`, `var(...)`, and other non-colour values
  are dropped rather than stored.
- **`@scrivr/core`** — the integrity pass now stores the `gridSpan` readers
  already derive, so a fractional span becomes its floor rather than 1.
