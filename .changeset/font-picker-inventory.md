---
"@scrivr/core": patch
---

A font picker offers what the editor can render

`FontFamily` declares its preset families in phase 1, before an editor exists,
so it cannot know what the editor it ends up in holds. With a `FontProvider`
supplying Inter, its six presets were six names that all resolved to the same
typeface — a control that appears to do something and does not. A document
written in a family nobody owns compounded it: the control read "Aptos" while
the page was drawn in Inter.

`FontProvider` gains an optional `inventory()`, `Editor` exposes
`fontFamilies`, and the family toolbar group is reconciled against it at
construction. With no provider the extension's presets stand unchanged.

Also fixes `systemCandidates` being reported lowercased — they were stored
folded for matching, so a picker would have shown "courier new".
