---
"@scrivr/core": patch
---

The empty line added after a document's last heading, list, table or other block is taken away again after Select All, and after an undo or redo that brought it back. A caret placed in it, or text typed in it, still keeps it. An undo or redo no longer takes away an empty last line someone made themselves, and the added line is never taken away during an undo or redo, only by an edit, which used to leave later undos throwing "Position out of range". With collaborative editing, a line an undo brings back is kept.
