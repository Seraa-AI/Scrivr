---
"@scrivr/core": patch
"@scrivr/plugins": patch
---

Three capabilities a consuming application could not build on its own.

**Doc attrs across a storage boundary.** `seedDocAttrs` and `readDocAttrs` move a
document's own attributes between a plain `attrs` object and a `Y.Doc`. The live
binding already syncs them between peers through a map beside the content
fragment, which is the whole answer for a host that persists the `Y.Doc` — but a
host that persists a ProseMirror-JSON projection had no route in or out, because
both conversions walk the fragment's children and `doc.attrs` has no
representation in a `Y.XmlFragment` at all. A `.docx` imported with a header lost
it the first time the document was opened, and the save after wrote the schema's
nulls over the import.

A pair of functions rather than an exported envelope type, so a caller does not
have to know the values are wrapped or that `localSeq` is a dedup hint it has no
business setting. Seeding carries only attrs the reader's extensions declare,
skips null values — every document offers one for every declared key, and writing
those syncs an absence over a real policy — and leaves keys the room already
holds alone, since the room may have been restored from cache before the
projection was consulted. `DOC_ATTRS_MAP_NAME` is exported and now has one owner
rather than being spelled in three places.

**`getActiveFontSize()`.** The counterpart to `getActiveFontFamily`, resolving
inline mark then block style the way the family resolves through mark, attr and
page config. A size control previously had to read the `fontSize` mark itself and
got `undefined` for every run without one — which is most runs, since a run with
no mark still renders at the block style's size — so the control showed "unset"
over text the document plainly draws at a size. Always returns a number, because
a control needs a value to show.

**`inlineRegistry` on `BaseEditor`.** Layout reaches an inline node's strategy
through a registry the caller supplies, and the registry lived on `Editor` only —
so a `ServerEditor` had nothing to pass. `measure()` never ran, the span carried
no resolved face, and a PDF node handler that draws its own text was given no
font to draw it in. An atom that sizes itself from a font was exactly the case
that could not work headlessly. `InlineStrategy.render` still takes a canvas
context and stays browser-only: the box is layout, the paint is a surface.
