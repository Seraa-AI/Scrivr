---
"@scrivr/core": patch
---

A node ends a section by declaring `sectionBoundary: true` on its spec, so the
sections model and layout no longer find section breaks by name. `Sections`
declares it; documents lay out exactly as before.

- Layout items carry one typed `boundary` (`LayoutBoundary`): a page break,
  or a section boundary with its transition, a continuous one included.
  `pageStartPast(boundary)` gives the page the next block starts on.

**Breaking:**

- `LayoutItem.isPageBreak` and `pageBreakType` are replaced by `boundary`;
  `FlowBlock.isPageBreak` and `pageBreakType` by `pageStart`.
