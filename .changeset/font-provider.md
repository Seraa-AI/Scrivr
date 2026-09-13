---
"@scrivr/core": patch
"@scrivr/docx": patch
---

An editor can be told which fonts it has.

`new Editor({ fonts })` takes a `FontProvider`: an inventory of font resources
the application supplies, a default it owns, and the answers to the question
"what is this text actually set in". `DefaultFontProvider` covers the common
case; the interface behind it is for an application with its own font library.

A resource is bytes somebody owns, reached through `bytes()` so it can come
from a bundler asset, a CDN, an object store or a buffer built at runtime.
Registering a catalogue costs nothing — only the faces a document resolves to
are fetched, so a package can hand over hundreds of descriptors.

Resolution answers before anything is measured, and says how it got there:
`requested`, `substituted`, `default` or `generic`, and whether the answer is
`portable` — false for a face this environment happens to have but nobody can
hand to an export. A consumer states what it needs rather than remembering a
rule: `resolve(request)` on screen, `resolve(request, { portable: true,
embeddable: true })` for an export, which is how the two lanes can reach
different answers without either one guessing.

DOCX import is the first consumer. A document states the faces it was written
in, and an import now reports the ones this editor cannot honour instead of
discovering it later from the geometry. An editor without a provider reports
nothing — there is nobody to ask, and inventing an answer is the guess this
lane exists to remove.

Nothing renders differently yet. Layout does not read resolutions, and the PDF
exporter still derives its own; that is the next phase.
