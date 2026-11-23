---
"@scrivr/core": patch
---

Turning everything back into paragraphs after Select All, or after an undo or redo, no longer leaves an extra empty paragraph at the end. A selection that only runs into the empty line added after a document's last heading, list, table or other block no longer counts as being in it; a caret placed there, or text typed there, still keeps it. An undo or redo hands the line back only when it is what brought the line back, so an empty line someone made or typed in stays theirs. Collaborative editing undoes through the shared document instead, and there a line an undo brings back is still kept.
