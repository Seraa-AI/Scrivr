---
"@scrivr/core": patch
---

A horizontal rule in a PDF is painted from the theme, like everything else.

The handler held the canvas slate (`#cbd5e1`) as a literal of its own, so
`defaultPdfTheme.hrColor` described a colour nothing read and
`exportPdf({ theme: { hrColor } })` could not change a rule. It was the only
PDF handler ignoring a token that already existed — visible now that it sits on
the extension beside the canvas renderer, which reads `theme.hrColor` correctly.

**A rule changes colour.** It is drawn in `defaultPdfTheme.hrColor` — `#999999`,
the print-ready grey — rather than the lighter `#cbd5e1` the canvas uses. That
is the palette the export was always meant to use; nothing read it. An alpha in
the colour now becomes the stroke's opacity, and a fully transparent `hrColor`
draws no rule at all.

Pass `exportPdf({ theme: { hrColor: "#cbd5e1" } })` to keep the previous ink.
