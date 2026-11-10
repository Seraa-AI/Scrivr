---
"@scrivr/core": patch
---

The toolbar shows the block the caret is in, as Word's ribbon does, in nested
lists and table cells. A numbered list nested in a bulleted one shows as
numbered. A list, heading or alignment inside a table cell shows. A centred
paragraph in a list shows as centred.

**Breaking:**

- `getBlockInfo()` and `SelectionSnapshot` now report the caret's own
  textblock. They used to report the outermost block, which was the list
  inside a list and the table inside a cell.
- They gain `ancestors`: the nodes around the textblock, `{ type, attrs }`,
  innermost first.
- `ToolbarItemSpec.isActive` takes one `ToolbarState` object instead of
  positional arguments. It holds `activeMarks`, `activeMarkAttrs`,
  `blockType`, `blockAttrs` and `ancestors`; destructure what you need, e.g.
  `isActive: ({ activeMarks }) => activeMarks.includes("bold")`. A
  `SelectionSnapshot` is a `ToolbarState`, so a toolbar you render yourself
  can pass `item.isActive(editor.getSelectionSnapshot())`.
- Inside a list, `blockType` is now `"paragraph"` (or `"heading"`), not
  `"bulletList"`. `editor.isActive("bulletList")` asks whether the caret is
  inside a bullet list at any depth; for toolbar state, call the item's
  `isActive(editor.getSelectionSnapshot())`, which presses only the list
  the paragraph belongs to.
