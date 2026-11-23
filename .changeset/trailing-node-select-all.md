---
"@scrivr/core": patch
---

The empty paragraph added after a document's last heading, list, table or other non-paragraph block is taken away again once the document ends in a paragraph, even after Select All. Select All, or a selection that only runs into that line, no longer counts as someone being in it, so turning everything back into paragraphs after Select All no longer leaves an extra empty paragraph at the end. A caret placed in the line, or text typed there, still keeps it.
