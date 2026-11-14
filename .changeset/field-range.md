---
"@scrivr/core": patch
---

`Field` adds a `fieldRange` mark for text an author fills in, which behaves like a Word content control. `insertFieldRange` inserts a placeholder prompt, or turns the selected text into a filled field. A caret inside a placeholder selects all of it, typing over it fills the field, and deleting the text brings the placeholder back. `exitFieldRange` (ArrowRight at the field's end) steps out. A pasted or split copy gets a fresh id. Placeholder text paints and prints in the placeholder colour.
