---
"@scrivr/core": patch
---

Turning everything back into paragraphs after Select All no longer leaves an extra empty paragraph at the end. A selection that only runs into the empty line added after a document's last heading, list, table or other block no longer counts as being in it; a caret placed there, or text typed there, still keeps it.
