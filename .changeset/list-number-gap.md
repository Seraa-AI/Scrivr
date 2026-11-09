---
"@scrivr/core": patch
---

A list number wider than its hanging indent no longer pushes its first line to
the next half-inch tab stop: the text starts where the number ends, as Word
lays out the same list. The same holds for a number moved past a floating
image on the item's left. Wrapped lines keep the item's indent, and canvas,
PDF and a DOCX export opened in Word agree.
