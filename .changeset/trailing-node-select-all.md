---
"@scrivr/core": patch
---

The empty line added after a document's last heading, list, table or other block is taken away again after Select All, and after an undo or redo that brought it back. A caret placed in it, or text typed in it, still keeps it. An undo or redo no longer takes away an empty last line someone made themselves, and no longer throws "Position out of range" in some of those sequences. With collaborative editing, a line an undo brings back is kept.
