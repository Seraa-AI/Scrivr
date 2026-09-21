---
"@scrivr/core": patch
"@scrivr/plugins": patch
"@scrivr/export-pdf": patch
---

Canvas synthesis reaches the text that is actually painted

The stand-in for a missing weight or slant was wired into `drawBlock`, which
`renderPage` only reaches when no block strategy is registered. Every text
block type registers one — paragraphs, headings, list items and code blocks all
paint through `TextBlockStrategy`, which drew with a plain `fillText`. So bold
text with no owned bold face changed nothing on screen while the exported PDF
was genuinely bold: the screen-versus-file disagreement the feature exists to
remove, pointing the other way. Table cells did synthesize, so one page could
show a thickened cell above an unthickened paragraph.

Header and footer chrome had the same split in a second place: the PDF lane
read the resolution table and the canvas lane was never given it.
`PageChromePaintContext` carries it now.

`Editor.fontFamilies` decides `portable` under the conditions an export
actually imposes. It asked only for portability, so a face whose licence
forbids embedding was offered as though it would survive, and the exporter then
resolved past it. A family is also portable if any of its faces is, rather than
whichever the provider happened to list first.

The playground's font control describes each combination rather than testing
bold and italic separately — a family holding a bold and an italic but no bold
italic was being called complete. Synthetic strokes use a round join in both
lanes, so a sharp apex cannot spike at heading sizes.
