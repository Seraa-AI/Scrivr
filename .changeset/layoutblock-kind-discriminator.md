---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
---

Add an explicit `kind: "text" | "leaf" | "tableRow"` discriminator to `LayoutBlock` and migrate every consumer that previously branched on `lines.length === 0`. Foundation-only change: the `tableRow` variant is reserved for the upcoming Table extension and is not produced by any code path yet — paragraph, heading, list, listItem, image, hr, and pageBreak rendering are unchanged.

**@scrivr/core**

- New `LayoutBlockKind` type exported from `BlockLayout.ts`. `LayoutBlock.kind` is now a required field with documented invariants:
  - `"text"` — block has rendered lines (paragraph, heading, list_item, codeBlock; anchor-only paragraphs still qualify because they hold a hidden anchor line).
  - `"leaf"` — block has no inline content (image, horizontalRule, pageBreak, and the inline-atom sub-blocks dispatched by the PDF exporter); `lines` is `[]`.
  - `"tableRow"` — reserved; not constructed yet.
- `layoutBlock` returns `kind: "text"` for textblocks; `layoutLeafBlock` returns `kind: "leaf"`. The split-path partBlocks in `paginateFlow` are tagged `"text"`.
- `MeasureCacheEntry` and `FlowBlock` mirror `kind` so the pagination loop and exclusion-reflow pass route on the discriminator without re-probing line counts. Page-break flow markers carry `kind: "leaf"`.
- Migrated consumers: `paginateFlow`'s leaf-overflow branch and split-path guard, `reflowFlowsAgainstExclusions`, `isAnchorOnlyFlowEntry`, `LayoutCoordinator._indexLayout` and `ensurePagePopulated`, and `populateCharMap` in `BlockLayout.ts`. Each now switches on `block.kind === "leaf"` (or its inverse) rather than `block.lines.length === 0`.
- All 829 core tests, 15 export-pdf tests, and 311 plugins tests stay green; full typecheck and build are clean across all 12 packages.

**@scrivr/export-pdf**

- The inline-atom dispatch in `context.ts` constructs its synthetic atom block with `kind: "leaf"` and drops the prior `as LayoutBlock` cast in favour of a typed annotation. PDF rendering output is unchanged.
- Test fixtures in `buildPdf.test.ts` carry the new field (`kind: "text"` for `paragraphBlock`, `kind: "leaf"` for `hrBlock`).

**@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-markdown**

- No code changes. Patch bump only, lockstep versioning.
