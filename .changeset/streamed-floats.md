---
"@scrivr/core": patch
---

A long document with images is laid out the same while it streams in as it is whole. Text and tables beside an image wrap it and move clear of it wherever the streaming cutoff falls, and an image that reaches back over text laid out earlier re-wraps that text. Before, text could be drawn under an image until something else laid the document out again.
