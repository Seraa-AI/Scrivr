---
"@scrivr/core": patch
---

Extensions can rewrite copied markup with `addCopyHtmlTransforms()`, the
counterpart to `addPasteHtmlTransforms()`. The transforms run on every copy
and cut, including a cell selection's table. Table declares its `rowspan`
rewrite this way, so the clipboard serializer no longer knows about tables.

`serializeSelectionToHtml(state, schema, copyHtmlTransforms?)` takes the
transforms to run. Called without them, it now leaves a merged table's cells
as one per row (`data-vmerge`) instead of collapsing them to `rowspan`. Pass
`manager.buildCopyHtmlTransforms()` to get what the editor copies.
