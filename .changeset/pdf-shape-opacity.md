---
"@scrivr/core": patch
"@scrivr/export-pdf": patch
---

Apply drawing-surface opacity to both fill and stroke for rectangles and
missing-image placeholders. An operation with zero opacity no longer leaves
a visible border when it draws a rectangle or an image cannot be resolved.
