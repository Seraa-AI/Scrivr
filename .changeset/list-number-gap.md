---
"@scrivr/core": patch
---

A list number wider than its hanging indent is followed by a space, not pushed
to the next half-inch tab stop. The same holds for a number moved past a
floating image on the item's left. Wrapped lines keep the item's indent, and
canvas and PDF place the text alike. A DOCX export still writes no number
suffix, so Word applies its own tab rule to the exported file.
