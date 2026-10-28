---
"@scrivr/core": patch
---

The modified-clause gutter bar now sits in the page's left margin, beside its sourced block and only that block. It used to be drawn beside the last character of the block before it, and it stretched over a horizontal rule or image next to the block. When a block runs onto the next page, each page shows a bar for only its own part of the block, instead of one bar that crossed the text, and a middle page of a block spanning three or more pages now has its bar. A sourced block inside a table cell gets its bar too.

- **Changed:** a sourced block with no `baseHash` (`null`, or the `""` that earlier DOCX imports wrote) is never modified, edited or not. With no recorded base there is nothing to compare against. Such blocks no longer show the bar, no longer appear in `sourcedBlockDivergenceKey`'s `diverged` set, and no longer report `modified: true` to `onInstanceChanged`. `collectSourcedBlocks` reports their `baseHash` as `null`, `""` included. To track edits on one, give it a `baseHash` from `computeBlockHash`. No event fires for a block's state when a document opens, so a host that stored `modified: true` for such a block should re-read it from `diverged` on load.
- `SourcedBlockExtension`'s DOCX importer keeps a missing `baseHash` as `null` instead of writing `""`.
- A table cell lays out a node declared `layout: { kind: "transparent" }` as its children, as the body flow does. A sourced block in a cell used to lay out as one box.
