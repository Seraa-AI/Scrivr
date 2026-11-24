---
"@scrivr/core": patch
---

Blocks in a table cell are spaced as Word spaces them. A heading in a cell keeps its space above it, not below; the first block in a cell keeps its space before and the last its space after; and between two blocks the larger of their spaces is kept, where both used to be added. Rows holding headings or code can be a little shorter than before. This holds in nested tables, and for any composite's regions.
