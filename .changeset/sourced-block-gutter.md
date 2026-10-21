---
"@scrivr/core": patch
"@scrivr/docx": patch
---

The modified-clause gutter bar now sits in the left margin next to its sourced block. It used to be drawn beside the last character of the block before it. When a block runs onto the next page, each page shows a bar for only its own part of the block, instead of one bar that crossed the text.

- **Changed:** a sourced block with no `baseHash` (`null`, or the `""` that earlier DOCX imports wrote) is no longer reported as modified. With no recorded base there is nothing to compare against. Before, every such block showed the bar and sent `modified: true` to the provider, even if no one had edited it.
- DOCX import now keeps a missing `baseHash` as `null` instead of writing `""`.
