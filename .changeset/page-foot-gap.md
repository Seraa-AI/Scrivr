---
"@scrivr/core": patch
---

A block near the foot of a page keeps the gap above it, as Word does. When its first line does not fit after the gap, it starts the next page, and the gap is dropped there. Before, core gave up the gap to fit the line, so a heading could sit flush against the paragraph above it with the rest of the heading's block on the next page. Documents with a block in that last sliver of a page paginate differently.
