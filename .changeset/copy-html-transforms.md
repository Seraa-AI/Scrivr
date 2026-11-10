---
"@scrivr/core": patch
---

Extensions can rewrite copied markup with `addCopyHtmlTransforms()`, the
counterpart to `addPasteHtmlTransforms()`. The transforms run on every copy
and cut, including a cell selection's table. Table declares its `rowspan`
rewrite this way, so the clipboard serializer no longer knows about tables.

**Breaking:** `serializeSelectionToHtml(state, schema, copyHtmlTransforms)`
takes the transforms to run, as a required argument. Pass
`editor.getCopyHtmlTransforms()` (new) to serialize what the editor copies.

A copied range that starts partway into a table row now keeps a vertical merge
in its own column. It used to hand the merge to the cell to its right.
