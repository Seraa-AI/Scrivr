---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
---

Float-image bug fixes, new `PageBreak` extension, and stricter `ToolbarItemSpec` typing.

**@scrivr/core**

- **Anchor-only paragraph is never a flow citizen.** Four layers were leaking the orphan empty paragraph that appeared after dragging a float out of its host paragraph; each is now closed:
  - `BlockLayout.ts` — anchor-only paragraphs now bypass `LineBreaker` entirely. `layoutBlock` synthesises a single hidden anchor line directly via `createHiddenAnchorLine`, so the zero-height invariant is preserved even when the paragraph overlaps its own exclusion zone (top-bottom wrap with `skipToY` was the failing case).
  - `PageLayout.ts` — square and top-bottom exclusion rects now clamp `[zoneTop, zoneBottom]` to the float's own page so a float anchored near the bottom of page N can't leak exclusion onto page N+1. Flows track `wrapZonePage`, and `rebreakWrappedLinesWithoutExclusions` re-breaks lines at full width when a wrapped flow's continuation lands on a page with no overlapping float.
  - `Editor.ts` — `moveAndUpdateNode` / `moveNode` now compute a `moveDeleteRange` that swallows the parent textblock when an inline image is the sole child. The drag transaction deletes the husk in the same tx and re-maps `targetPos` through the resulting mapping. Word-style: dragging a float out never leaves an orphan paragraph behind.
  - `SelectionController.ts` — `moveLeft` / `moveRight` consolidated into `_moveHorizontally`. If the next position would land on a non-inline image, a `NodeSelection` is made on the image; if `extend=true`, the navigation skips past the hidden anchor; positions with no `CharacterMap` entry are walked through. The cursor cannot park in a zero-height anchor line.

- **New `PageBreak` extension.** Layout already supported `pageBreak` (`paginateFlow` branches on `flow.isPageBreak` at PageLayout.ts:1183, `collectLayoutItems` detects `node.type.name === "pageBreak"`), but the active StarterKit schema didn't register the node. The new extension closes that gap:
  - `addNodes` — `pageBreak` as a non-selectable atom block, with `<div class="scrivr-page-break">` round-trip.
  - `addCommands` — `insertPageBreak()` inserts after the current top-level block.
  - `addKeymap` — `Mod-Enter` (Word/Docs convention).
  - `addToolbarItems` — `↵` button in the `insert` group.
  - Wired into `StarterKit` (`addNodes`, `addCommands`, `addKeymap`, `addToolbarItems`) gated on a new `pageBreak?: false` option.

- **Stricter `ToolbarItemSpec.command` typing.** `command` is now `keyof SafeFlatCommands` instead of `string`, so toolbar items are validated against contributed `Commands<ReturnType>` augmentations. Filled the pre-existing gaps the new type surfaced:
  - `FontFamily.ts` — added `setBlockFontFamily` and `unsetBlockFontFamily` to the Commands augmentation (toolbar was using these untyped).
  - `Heading.ts` — Commands augmentation switched to a mapped type `[K in 1|2|3|4|5|6 as setHeading${K}]: () => ReturnType` so the toolbar's template literal narrows; `HeadingLevel = 1|...|6` exported and `HeadingOptions.levels` narrowed to `HeadingLevel[]`. `StarterKitOptions.heading.levels` updated to match.
  - `Indent.ts` — added the missing Commands augmentation for `increaseIndent` / `decreaseIndent`.

- **Tests.** 12 new cases:
  - `BlockLayout.test.ts` — anchor-only paragraph stays zero-height when overlapping its own exclusion zone.
  - `PageLayout.test.ts` — anchor-only paragraph contributes no vertical gap before following text; floats at page bottom don't leak exclusion onto the next page.
  - `Editor.test.ts` — drag deletes the orphan parent paragraph; `moveRight` selects a non-inline image instead of landing in its hidden anchor; `Shift+moveRight` skips a hidden anchor when extending selection.
  - `PageBreak.test.ts` — node registration, atom/selectable flags, command exposure, keymap binding, schema integration, JSON round-trip.

**apps/docs**

- Demo content polished: tightened the welcome and Layout Engine paragraphs (less marketing-y, no redundant phrasing).
- New "Floating Images" section that exercises every wrap mode with text actually wrapping around it: square (left, with surrounding flow), top-and-bottom (full-width, text above and below, plus a contrast-with-square closing line), behind (right, `yOffset: 40`), in-front (left, `yOffset: 30`).
- A page-break drops the behind/in-front demos onto their own page.

**@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-pdf**, **@scrivr/export-markdown**

- No code changes. Patch bump only, lockstep versioning.
