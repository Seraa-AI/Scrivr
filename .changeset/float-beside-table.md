---
"@scrivr/core": patch
---

A floating image with square or top-and-bottom wrap no longer paints over a
table beside it. The table moves below the image as one unit, as Word does, and
is never narrowed; screen, cell clicks and PDF export all follow.
