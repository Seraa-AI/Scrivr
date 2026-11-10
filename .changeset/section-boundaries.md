---
"@scrivr/core": patch
"@scrivr/plugins": patch
---

A node ends a section by declaring `sectionBoundary: true` on its spec, so the
sections model and layout no longer find section breaks by name. `Sections`
declares it; documents lay out exactly as before.

- A section boundary is a leaf with a `settings` attr between the document's
  own blocks: one nested in a wrapper ends no section and no longer starts a
  page, as the sections model already read it. Headers and footers refuse
  section boundaries.
