---
"@scrivr/core": patch
"@scrivr/export-pdf": patch
"@scrivr/export-semantic": patch
---

The PDF bookmarks and the semantic outline visit the same headings.

- A heading nested in a list, sourced block or table cell heads the semantic
  breadcrumbs of what follows it and opens a section in `toDocumentOutline`,
  as it is a PDF bookmark. A unit lists the headings it holds in the new
  `SemanticUnit.headings` (`SemanticHeading`).
- A heading whose proposed text is empty (blank, or all proposed for deletion)
  heads nothing in either outline; `headingLevel` is absent on such a unit.
- A section's title is its heading's text, without a grouped lede.
