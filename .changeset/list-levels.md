---
"@scrivr/core": patch
"@scrivr/docx": patch
"@scrivr/plugins": patch
---

Lists follow Word's levels and numbering.

- **Tab takes an item deeper, as in Word, and only that item.** Each Tab
  goes one level further, past the item above, up to level 9 (Tab there is
  consumed without a change); the items after it keep their levels. Shift-Tab
  brings it back a level, then lifts it out as before, and so does Backspace
  at the start of an item below the top level, which no longer joins it into
  the item above. Backspace at the start of a line just below a list joins it
  onto the list's last text, as Word does, instead of wrapping it into the list
  as an item. In Suggesting mode a Tab is one change on that item ("List
  indent: 0 → 1"), which rejecting takes back; moving a list item you added is
  part of that proposal and records no change of its own.
- `listItem` gains `levelOffset` (default 0): how many levels deeper the item
  sits than its list. Layout, markers, PDF and DOCX `ilvl` all read it, and an
  ordered list numbers by level, as Word counts: an item follows the last item
  at its level, and a shallower item restarts the deeper ones.
- **DOCX import keeps an item that skips a level** at its level, with
  `levelOffset`, instead of hanging it under an empty item that drew a stray
  bullet. `DocxListItem` gains `levelOffset` and `DocxBlock`'s list gains
  `start` (both optional).
- **Each list restarts in Word.** DOCX export gives every top-level list its
  own numbering (`numId`) over one shared definition, with level 0's
  `startOverride` set to its `order`, so separate lists no longer continue
  each other and a list starting at 3 starts at 3. `DocxContext.numbering.getOrCreate`
  gains `instance` and `start` (both optional).
- **DOCX import reads where a list starts** (`w:start`, `startOverride`) into
  `order`, and reads `numId` 0, Word's "no numbering", as a plain paragraph.
