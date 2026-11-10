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
- `ToolbarItemSpec.isActive` receives `ancestors` as a fifth argument. Pass
  it through when you render toolbar items yourself.
- Inside a list, `blockType` is now `"paragraph"` (or `"heading"`), not
  `"bulletList"`. Use `editor.isActive("bulletList")` to ask whether the
  caret is in a list, at any depth.
