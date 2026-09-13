---
"@scrivr/core": patch
"@scrivr/export-pdf": patch
---

Make PDF handler dispatch independent of object prototypes across mark, node,
and chrome contributions. Only own entries register handlers; later extensions
override earlier ones, and prototype-like names work as ordinary keys.

Validate mark styles before drawing. Invalid or unsupported colors no longer
turn highlights opaque black or override valid text colors. Invalid background
opacity skips that background while other valid style properties still apply.
Mark callbacks receive their declared theme-only context.
