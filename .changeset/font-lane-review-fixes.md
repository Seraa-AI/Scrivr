---
"@scrivr/core": patch
"@scrivr/export-pdf": patch
"@scrivr/plugins": patch
---

Font reporting names the typeface, and a resource is identified by its id

`Editor.fontSubstitutions` reported the private family name the measurement
backend installs owned bytes under, so a substitution notice read
"Arial → ScrivrFace0" while the font control beside it read "Arial → Inter".
A resolution now keeps the real family in `resolved.family` and carries the
backend's name separately, where only the code building the measurement string
reads it.

`FontResource` is identified by its `id`, as its name always implied. The
editor keyed its install caches on object identity instead, so a provider that
built its answer fresh per call — which the interface permits — installed a new
face on every layout and never used any of them.

An answer that never had a resource is no longer downgraded to `generic`. A
`systemCandidates` family renders correctly, and reporting it as degraded fired
substitution notices for fonts that were drawn exactly as asked.

Both PDF export paths now embed through one function, so a licence-denied or
unparseable face is treated the same whether the caller used `exportToPdf` or
`buildPdf`. `editor.commands.exportPdf()` forwards every export option, which
`onFontShortfall` previously could not reach through.

Empty paragraphs resolve their font like any other text, so a blank line is the
same height as the text around it. Substitutions are read from the document
rather than the resolver's cumulative table, so a family applied and undone
stops being reported. `@scrivr/plugins` header and footer slots are measured
with the editor's resolved faces and font modifiers.
