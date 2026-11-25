---
"@scrivr/core": patch
---

Blocks in a table cell are spaced as Word spaces them. A heading in a cell keeps its space above it, not below; the first block in a cell keeps its space before and the last its space after; and between two blocks the larger of their spaces is kept, where both used to be added. Rows whose blocks keep space above them, such as headings, code and rules, can be a little shorter than before. Nested tables are spaced the same way.
