---
"@scrivr/core": patch
"@scrivr/docx": patch
"@scrivr/plugins": patch
---

Lists follow Word's levels.

- **Tab keeps going deeper, as in Word.** Tab on an item with one above it
  nests it, as before; Tab on a list's first item takes the whole list a level
  in, so Enter-then-Tab-then-Tab goes two levels deep. Shift-Tab brings it back
  a level before lifting the item out. Level 9 stays the deepest, and Tab there
  is consumed without a change. In Suggesting mode it is a list change, which
  rejecting takes back.
- `bulletList` and `orderedList` gain `levelOffset` (default 0): how many
  levels deeper the list sits than its place puts it. Layout, markers, PDF and
  DOCX `ilvl` all read it.
- **DOCX import keeps a list that skips a level** at its level, with
  `levelOffset`, instead of hanging it under an empty item that drew a stray
  bullet. `DocxBlock`'s list gains `levelOffset` and `start` (both optional).
