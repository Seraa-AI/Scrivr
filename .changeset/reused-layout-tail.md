---
"@scrivr/core": patch
---

A layout that reuses the last one's unchanged tail now equals a fresh one. Deleting a block no longer leaves it on the page, which happened in a document with a table, or when one layout covered the deletion and an edit before it; a deleted page break, a section break that stops moving the flow, a moved block, a split list and a restyled wrapper are covered the same way. After typing and then moving the blocks below (a letter and then Enter), the text below no longer maps one position off, so the caret and clicks land where they should. A paragraph split across pages keeps the right `sourceNodePos` on both parts.
