---
"@scrivr/export-pdf": patch
---

**Breaking: a WOFF or WOFF2 face is refused instead of written into the PDF.**

A web font container is not a font program. fontkit unwraps one, so a face
registered as `.woff2` measured and shaped correctly and nothing upstream
noticed - but the bytes went into `FontFile2` as they arrived, where a reader
expects the font itself. Preview rendered such a file as a row of dots, other
viewers substituted a typeface and painted it at coordinates measured from a
different one.

Register faces as `.ttf` or `.otf`. The error names the family that has to
change.
