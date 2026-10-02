---
"@scrivr/core": patch
"@scrivr/export-semantic": patch
---

`toDocumentOutline` — the section hierarchy the headings imply.

`toSemanticUnits` answers an ordered flat list, which states the document's
structure without describing it. Every consumer that wanted a navigable outline
rebuilt one: opening and closing sections on heading level, threading ancestor
titles, naming the content that precedes the first real heading. Each of those
is a judgement about what a section is, made by a consumer rather than by the
editor that owns the structure — so two places could disagree.

Three rules now live with the editor: content before the first heading is a
section and needs a name; a heading closes every open section at its level or
deeper; a section's range is heading-inclusive and ends where the next one
opens, so an outer section contains its children's range.

Each `OutlineSection` carries `id`, `parentId`, `heading`, `headingNodeId`,
`level`, `path`, and a `startUnit`/`endUnit` range into the same unit list.
`headingNodeId` is null exactly when the section covers content preceding the
first heading — there is no heading block to anchor a citation to, and the
absence says so without a second flag. The name for that section is the
`untitledHeading` option, because it is text a reader sees in a language only
the host knows.

Deterministic from the same units: every id is a unit's own anchor, so two
reads of an unchanged document return the same sections and a cached chunk
anchor keeps resolving. Nesting depth is read from the breadcrumb the walker
already threads rather than re-derived from heading levels, so a section's path
and its units' breadcrumbs cannot drift apart.
