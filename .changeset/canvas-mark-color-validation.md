---
"@scrivr/core": patch
---

Validate mark colours with the drawing context before applying canvas colour
precedence. Invalid authored colours no longer suppress link defaults or inherit
the previous span's ink. Both canvas render paths preserve earlier valid
declarations and continue accepting colours supported by the canvas itself.
