---
"@scrivr/core": patch
"@scrivr/docx": patch
"@scrivr/ai": patch
"@scrivr/export": patch
"@scrivr/export-markdown": patch
"@scrivr/export-pdf": patch
"@scrivr/export-semantic": patch
"@scrivr/plugins": patch
"@scrivr/react": patch
---

**Hyperlinks survive DOCX export**

A document exported to Word lost every hyperlink. The text came through, the
link did not, and the export logged an `unsupported-mark` warning that no UI
surfaces — so the first sign of it was a Word file where nothing was clickable.

- **`@scrivr/core`** — new `DocxRunWrapper` contribution kind, and
  `DocxHandlers.markWrappers`. `DocxMarkHandler` contributes run *properties*,
  which is all bold or colour need; OOXML expresses a hyperlink as a
  `<w:hyperlink>` element wrapping the runs and carrying a relationship id, so
  no run property can produce one. That is why `Link` had no export handler at
  all rather than a broken one.
- **`@scrivr/core`** — `Link` now contributes both halves: the wrapper that
  registers the relationship through the existing `ctx.rels.addHyperlink()`,
  and Word's built-in Hyperlink character style so the link looks like one. A
  link with no usable href stays styled text rather than emitting a `r:id` for
  a relationship that was never registered, which produces a file Word refuses
  to open.
- **`@scrivr/docx`** — the walker applies wrapping marks around the run it just
  built, in the order the marks appear on the text, so two wrapping marks nest
  predictably.
