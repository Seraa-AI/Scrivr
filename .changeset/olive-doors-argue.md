---
"@scrivr/core": patch
"@scrivr/export-pdf": patch
---

**Breaking: embedding a face in a PDF now requires the resource to say so.**

`embedding: { allowed: true }` is what grants it. A resource that omits
`embedding` used to be treated as embeddable; it is now treated as unknown, and
unknown permission does not satisfy the `embeddable` resolution constraint.
Holding a font's bytes was never the same as holding the right to put them in a
file somebody else opens.

**To migrate:** add `embedding: { allowed: true }` to every `FontResource` whose
licence or `fsType` metadata permits embedding. Without it the face still draws
on screen, but an export refuses it.

Refuses, not silently substitutes: `embedFaces` now throws, naming the family.
A face that quietly failed to embed left its glyphs at coordinates measured from
a typeface the reader never sees, which is the defect this lane exists to
remove. Callers that mean to fall back should resolve with the `embeddable`
constraint, which answers with a face that may travel and reports the
substitution through `onFontShortfall`.

Also: a quoted family containing a comma (`"ACME, Sans", serif`) now resolves to
`ACME, Sans` rather than being split at the comma, and a canvas font
installation that fails once is retried on the next layout instead of being
given up on for the life of the editor.
