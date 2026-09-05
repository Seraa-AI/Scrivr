---
"@scrivr/core": patch
"@scrivr/docx": patch
"@scrivr/export-pdf": patch
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
copied out of Scrivr arrives in them as the table it was — bar `hMerge`, which
neither Word nor HTML states separately from a span, and cell alignment, which
round-trips through the clipboard but is not yet honoured by layout, PDF, or
DOCX.

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
  already derive, so a fractional span becomes its floor rather than 1. Every
  reader now derives it in one place, so the layout, the exporters, and the
  table map can no longer disagree about what a malformed span means.
- **`@scrivr/core`** — cell shading is exported to PDF, which drew borders and
  text but never a fill.
- **`@scrivr/core`** — cell shading survives DOCX export whatever spelling the
  browser gave it. Only six hex digits were accepted, while Chrome's CSSOM
  hands back `rgb(...)`, so a pasted fill was kept on screen and dropped from
  the file.

- **`@scrivr/core`** — vertical merges are bounded by the rows their row group
  actually has, independently of the column allocation limit, so a merge longer
  than 64 rows survives a copy. Span attributes are read the way HTML parses a
  non-negative integer, so `rowspan="1e3"` is one row rather than the whole
  group.
- **`@scrivr/core`** — one parser now says what a CSS colour means, wherever a
  colour crosses a boundary. It resolves named colours, `hsl()`, space-separated
  syntax and alpha without a DOM, so a document exported on a server means the
  same thing as one exported in a browser.
- **`@scrivr/core`** — a cell fill is validated once, where every lane reads it,
  rather than only on the paste path. A fill arriving from DOCX import, collab
  or `setContent` can no longer reach the canvas as an unpaintable value, which
  used to leave the previous cell's colour on the brush and paint two cells the
  same.
- **`@scrivr/core`** — text colour survives DOCX export whatever its spelling.
  `cssColorToDocxHex` read hex and comma-form `rgb()` only, so a `color: red`
  mark — the literal a paste keeps — was dropped with a diagnostic while a cell
  filled `red` exported correctly in the same document.
- **`@scrivr/export-pdf`** — a text colour that is not hex no longer exports as
  black, and no longer crashes the export. `parseHexColor("red")` produced `NaN`
  channels, which pdf-lib throws on; both PDF colour helpers now read the same
  literals the rest of the editor does. `parseHexColor` is deprecated in favour
  of `parseCssColor`.
- **`@scrivr/docx`** — a cell span a file claims is bounded on import, as it
  already was on paste. A `<w:gridSpan w:val="100000"/>` would otherwise become
  a real cell in every row of the document when the grid was padded.
- **`@scrivr/core`** — a translucent colour is composited onto the page for
  formats that have no alpha, instead of being written at full strength. A 40%
  yellow highlight exports as the colour a reader sees.
