---
"@scrivr/core": patch
---

A long document with images is laid out as it streams in as it is whole. Text and tables beside an image wrap it and move clear of it wherever the streaming cutoff falls, and an image that reaches back over text laid out earlier re-wraps that text; before, text could be drawn under an image until something else laid the document out again. The page the first 100 blocks end on is repainted when the rest of it arrives. Documents where several images reach back over one another can still differ.
