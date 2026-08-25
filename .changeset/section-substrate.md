---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/docx": patch
"@scrivr/ai": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
"@scrivr/export-semantic": patch
---

**Section substrate**

`@scrivr/core` gains the boundary-derived section model that per-section
columns, page chrome, and page geometry will build on
(`docs/sections-roadmap.md` step 1).

- **`sectionBreak`** — a block atom carrying the settings of the section it
  terminates, mirroring DOCX's paragraph-level `sectPr` ownership. The body
  tree stays flat.
- **`doc.attrs.finalSection`** — settings for the trailing section, which has
  no terminating break.
- **`deriveSections(doc)`** — projects the boundaries into `{ id, from, to,
  breakPos, settings }` ranges. Pure, mints no ids, and never persists
  positions, so it is safe on the read path.
- **Commands** — `insertSectionBreak`, `setSectionSettings`,
  `removeSectionBreak`. Inserting copies the current section's settings to both
  halves; removing merges forward, which is Word's behavior and also what a raw
  deletion of the node produces.
- **Layout** — a `continuous` break has no flow effect; any other break type
  starts a new page. Documents with no section break are unchanged.

All other `@scrivr/*` packages bump for lockstep version alignment only — no
code changes in them.
