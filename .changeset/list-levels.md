---
"@scrivr/core": patch
"@scrivr/docx": patch
"@scrivr/plugins": patch
---

Lists follow Word's levels and numbering.

- **Tab keeps going deeper, as in Word.** Tab on an item with one above it
  nests it, as before; Tab on a list's first item takes the whole list a level
  in, so Enter-then-Tab-then-Tab goes two levels deep. Shift-Tab brings it back
  a level before lifting the item out, and so does Backspace at the start of
  an item below the top level, which no longer joins it into the item above.
  Backspace at the start of a line just below a list joins it onto the list's
  last text, as Word does, instead of wrapping it into the list as an item.
  In Suggesting mode, moving a list item you added is part of that proposal
  and records no list change of its own. Level 9 stays the deepest, and Tab there
  is consumed without a change. In Suggesting mode it is a list change, which
  rejecting takes back.
- `bulletList` and `orderedList` gain `levelOffset` (default 0): how many
  levels deeper the list sits than its place puts it. Layout, markers, PDF and
  DOCX `ilvl` all read it.
- **DOCX import keeps a list that skips a level** at its level, with
  `levelOffset`, instead of hanging it under an empty item that drew a stray
  bullet. `DocxBlock`'s list gains `levelOffset` and `start` (both optional).
- **Each list restarts in Word.** DOCX export gives every top-level list its
  own numbering (`numId`) over one shared definition, with level 0's
  `startOverride` set to its `order`, so separate lists no longer continue
  each other and a list starting at 3 starts at 3. `DocxContext.numbering.getOrCreate`
  gains `instance` and `start` (both optional).
- **DOCX import reads where a list starts** (`w:start`, `startOverride`) into
  `order`, and reads `numId` 0, Word's "no numbering", as a plain paragraph.
