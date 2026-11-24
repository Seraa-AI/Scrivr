---
"@scrivr/core": patch
---

A layout that reuses the last one's unchanged tail now equals a fresh one:

- A deleted block no longer stays on the page. It did in a document with a table, or when one layout covered the deletion and an edit before it; deleted page breaks, section breaks that stop moving the flow, moved blocks, split lists and restyled wrappers had the same cause.
- Text below an edit keeps its document positions. After a letter and then Enter it mapped one position off, and the end of a Shift+Enter line fell one further behind with every letter typed above it, so a click there could land in another paragraph.
- Without pages, typing near the top no longer shrinks the document's height to just below the edit.
- A float's new margin re-wraps the text beside it.
- A paragraph split across pages has the right `sourceNodePos` on both parts.
