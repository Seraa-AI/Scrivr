---
"@scrivr/core": patch
---

Prevent incremental pagination from reusing a previous layout tail before all
changed blocks in the current document have been processed. Paragraph splits
after tables or other stable blocks now repaint immediately instead of drawing
stale pre-edit content.
