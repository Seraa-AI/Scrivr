---
"@scrivr/core": patch
---

The empty line added after a document's last heading, list, table or other block is taken away again after Select All, and after an undo or redo that brought it back. A caret placed in it, or text typed in it, still keeps it, and so does making it part of something else, such as a list. After an undo or redo, an empty last line someone made themselves is no longer taken away. The added line is removed only in response to an edit, never as a side effect of an undo or redo; removing it there could make a later undo throw "Position out of range". Adding or removing it no longer drops bold or other marks waiting for the next typing. With collaborative editing, a line an undo brings back is kept.
