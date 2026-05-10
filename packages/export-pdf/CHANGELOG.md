# @scrivr/export-pdf

## 1.0.8

### Patch Changes

- bc1652d: Two new ways to seed initial editor content: a `DefaultContent` extension that takes either markdown or JSON, and a widened `content` constructor option that accepts strings (markdown) alongside the existing JSON object. Both surfaces share a single parser implementation; the constructor option overrides any extension contribution. Server users typically reach for `new ServerEditor({ content: "# md" })`, kit-builders compose `DefaultContent.configure({ markdown })` into an extensions list — either path lands the same document.

  **@scrivr/core**

  - New `DefaultContent` extension at `extensions/built-in/DefaultContent.ts`. Takes `{ markdown?: string } | { json?: object }` (mutually exclusive — throws on both or neither). Use via `DefaultContent.configure({ markdown: "# Hello" })` or `DefaultContent.configure({ json: docJson })`.
  - `BaseEditorOptions.content`, `EditorOptions.content`, and `ServerEditorOptions.content` widened from `Record<string, unknown>` to `string | Record<string, unknown>`. Strings are parsed as markdown via the merged extension token map; objects keep the existing JSON path. Passing `content` on the constructor overrides any `DefaultContent` (or other `addInitialDoc`) contribution from the extensions list.
  - `addInitialDoc` lifecycle now runs _after_ every extension has fully resolved (previously it ran inside each extension's `resolve()`, before others were known). The hook's `this` context is the new `InitialDocContext` — `ExtensionContext` plus a `parseMarkdown(text)` helper that uses the merged token map. This is what lets the extension seed from markdown without an editor instance. Existing extensions that only used `this.schema` keep working unchanged.
  - New `parseMarkdownToDoc(schema, tokens, text)` helper in `model/parseMarkdown.ts` — the shared core used by `BaseEditor.parseMarkdown`, the constructor `content` option, and `InitialDocContext.parseMarkdown`. `BaseEditor.parseMarkdown` is now a one-line wrapper.
  - New `InitialDocContext` type exported from `extensions/index.ts` for consumers writing custom content-seeding extensions.

  **@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-pdf**, **@scrivr/export-markdown**

  - No code changes. Patch bump only, lockstep versioning.

- 40be274: Tables ship behind an opt-in flag. Phase 1's placeholder render is intentionally not in default `StarterKit` while the layout/render/export pipeline is filled in (Phases 2–4 of `docs/tables.md`). Apps consuming the released packages get unchanged behavior; tables are silent until explicitly enabled.

  **Breaking-ish for early adopters:**

  ```ts
  // Before — default-on:
  new Editor({ extensions: [StarterKit] });

  // After — opt-in:
  new Editor({ extensions: [StarterKit.configure({ table: true })] });
  ```

  **@scrivr/core**

  - `StarterKitOptions.table` flips from `false?` (default-on, opt-out) to `true?` (default-off, opt-in). All five `if (opts.table !== false)` gates in `StarterKit` flip to `if (opts.table === true)` (nodes, commands, layout handlers, toolbar items, markdown serializer rules).
  - `Table` extension and its types (`CellSubBlock`, `LayoutBlockKind === "tableRow"`) remain exported. Power users can continue composing `Table` directly without StarterKit:

    ```ts
    new Editor({ extensions: [StarterKit, Table] });
    ```

  - 3 new regression tests in `Table.test.ts` lock in the contract:
    - default `StarterKit` does not include `table` / `tableRow` / `tableCell` / `tableHeader` in the schema,
    - default `StarterKit` does not expose `insertTable` / `deleteTable` commands,
    - `StarterKit.configure({ table: true })` registers the full schema.

  **@scrivr/react / @scrivr/plugins / @scrivr/export-pdf / @scrivr/export-markdown**

  - Lockstep version bump only — no API changes.

- dad19d0: Tables Phase 1 — schema + insert/delete + placeholder render. Tables can now be inserted, removed, serialised to JSON, and survive page boundaries with a one-bordered-box-per-row placeholder. Real cell layout, cell text rendering, and PDF parity land in Phase 4 (see `docs/tables.md`).

  **@scrivr/core**

  - New `Table` extension with four Word-shaped node specs: `table` (`grid: number[]`, `layout: "fixed"`, `isolating`), `tableRow` (`repeatHeader`, `allowBreakAcrossPages`), `tableCell` and `tableHeader` (`gridSpan`, `vMerge`, `hMerge`, `hAlign`, `vAlign`, `background`, `margins`, `borders`, all `isolating`).
  - New commands `insertTable({ rows, cols })` and `deleteTable()`. Insert places the table after the current top-level block with uniform 100px columns, an empty paragraph in each cell, and parks the cursor in the first cell. Delete walks up to the surrounding `table` ancestor.
  - New `LayoutBlock.cells?: CellSubBlock[]` field and `CellSubBlock` interface (Phase 1: always `[]`; Phase 4 fills it).
  - New `layoutTableRow()` in `BlockLayout.ts` — stub that returns a fixed-height (32px) `kind: "tableRow"` block per row.
  - New `TableLayoutEngine` re-export module (placeholder for Phase 4's full engine) and `TableRowStrategy` placeholder renderer that paints a single 1px gray bordered rectangle per row.
  - `PageLayout.collectLayoutItems()` now expands `table` nodes into one `LayoutItem` per row. Pagination treats `tableRow` as atomic alongside `leaf` blocks: whole rows move to the next page on overflow, and a row taller than the content area clips on the next page (Word's `cantSplit` policy).
  - `StarterKit` accepts `table?: false` and registers Table by default.
  - New `insertTable` toolbar item (▦ icon) inserts a 3×3 table.
  - New markdown serializer rules for `table` / `tableRow` / `tableCell` / `tableHeader`. Phase 1 emits GFM-style pipe tables: first row becomes the header, cells flatten to pipe-escaped single-line text. Block content, marks, and merged cells collapse to plain text (full markdown serializer with merged-cell skip lands in Phase 8). Without this, `getMarkdown()` would throw on any document containing an inserted table since StarterKit enables Table by default.
  - Regression test: `new Editor({ content: { ...table... } })` hydrates the table into the proper `tableHeader` / `tableCell` / `tableRow` / `table` structure. Locks in compatibility with `EditorOptions.content` (added by the DefaultContent extension PR) and confirms the schema round-trips through the constructor's content path.

  **@scrivr/react / @scrivr/plugins / @scrivr/export-pdf / @scrivr/export-markdown**

  - Lockstep version bump only — no API changes. PDF export ignores tables for now (canvas placeholder only); Phase 4 adds the PDF table handler in lockstep with real cell rendering, per the parity rule.

- bf33e14: Theming: 12 canvas tokens + per-extension theme + PDF override path. Tailwind dark mode (or any CSS-variable-driven theme system) can drive both DOM chrome and canvas paint from a single source of truth. PDF export defaults to a print-ready palette that ignores the canvas theme; callers opt into themed PDF via `exportPdf({ theme })`.

  **Note:** This bumps `MarkDecorator`, `InlineStrategy.render`, `OverlayRenderHandler`, `BlockRenderContext`, and `PageChromePaintContext` signatures with new theme/effective-color parameters. Third-party extensions that hook these will pick up TypeScript errors and need to update their signatures (most can ignore the new args; underline/strikethrough-style decorators read `effectiveTextColor`).

  **@scrivr/core**

  - New `EditorTheme` (input — accepts CSS color strings including `var(--token)` references) and `ResolvedTheme` (output — literal colors only, what render contexts consume). Both exported from `@scrivr/core`. 12 tokens cover cross-cutting paint surfaces: pageBg, pageShadow, defaultText, link, cursor, selectionFill, imagePlaceholderBg/Border/Text, listMarker, hrColor, resizeHandle.
  - New constants: `defaultEditorTheme` (matches every hardcoded color used today — zero visual regression for apps that don't pass `theme`) and `defaultPdfTheme` (print-ready palette: white bg, black text, blue link, light placeholders).
  - New `EditorOptions.theme` and `EditorOptions.themeRoot`. `themeRoot` defaults to the mounted container, falling back to `document.documentElement` for unmounted instances. `var(--token)` strings resolve against `themeRoot` via a hidden `<div>` probe + `getComputedStyle` (the browser handles every CSS color form for free — `var()`, `var()` with fallback, `color-mix()`, `oklch()`, `calc()`).
  - New `editor.setTheme(partial)` API. Partial merge with explicit semantics: `null` resets a token to its default, `undefined` leaves the token alone, any other value overrides. Calling with `{}` is a pure refresh (re-resolves and bumps `renderGeneration`).
  - New `editor.getTheme()` and `editor.getResolvedTheme()` accessors.
  - Auto-installed `MutationObserver` on `themeRoot` (watching `class`, `style`, `data-theme`) when any theme value contains `var(`. rAF-coalesced — burst mutations produce one re-resolve per frame. Toggling the Tailwind `dark` class triggers a single canvas repaint without explicit calls.
  - Theme threaded into every paint surface today: `canvas.ts` clearCanvas (pageBg), `TextBlockStrategy` default text fill (defaultText), `Underline`/`Strikethrough` decorations (theme.defaultText — color marks do NOT bleed into decoration color, matching Word/Docs convention), `Link` decorator (theme.link), `Image` placeholders (3 tokens), `HorizontalRule` (hrColor), `ListItemStrategy` markers (listMarker), `ResizeController` handles (resizeHandle), `OverlayRenderer` cursor + selection (cursor, selectionFill), `TileManager` page wrapper (pageBg + pageShadow).
  - `BlockRenderContext`, `PageChromePaintContext`, `MarkDecorator.decoratePre`/`decoratePost`/`decorateFill`, `InlineStrategy.render`, and `OverlayRenderHandler` now carry/receive a resolved theme (and `effectiveTextColor` for mark decorators) so third-party extensions get dark mode automatically without forking the paint contract.
  - `CodeBlock` extension now accepts a `theme: { bg, border }` option for per-extension palette overrides. Other built-ins read from the cross-cutting `ResolvedTheme` directly.
  - `ServerEditor` accepts `theme` and exposes `getTheme()` + `getResolvedTheme()`. Server-side any `var(...)` entries are dropped (warned at construct via `console.warn`) and the rest are merged over `defaultEditorTheme`. PDF callers can pass `editor.getResolvedTheme()` directly into `exportPdf({ theme })` without re-specifying colors.
  - Probe element lifecycle is leak-free across construct → mount → unmount → remount → destroy. The probe is disposed when `_themeRoot` switches (constructor's documentElement → mount's container) and again on destroy. The MutationObserver-driven rAF refresh is tracked + cancelled on unmount/destroy so stray callbacks can't recreate a probe on a torn-down editor.
  - Header/footer surfaces inherit the body's resolved theme via `PageChromePaintContext.theme` — they never store a copy, so `setTheme()` on the body propagates without surface-side refresh.
  - `TileManager` paged-mode page wrapper now reads `pageShadow` and `pageBg` from the active resolved theme on every paint. User-supplied `pageStyle.boxShadow` / `pageStyle.background` overrides still win.

  **@scrivr/export-pdf**

  - New `PdfExportOptions.theme` — `Partial<ResolvedTheme>` (literal CSS colors only). Shallow-merged over `defaultPdfTheme`. PDF default is independent of `editor.theme` so a dark canvas still produces a print-ready PDF unless the caller explicitly opts in.
  - The PDF per-page loop now paints `theme.pageBg` as the first draw call so themed exports actually have the requested background color (pdf-lib's default white was previously visible regardless of theme).
  - `editor.commands.exportPdf({ theme, filename })` accepts the same theme override at the command level. Type-safe via the augmented `Commands` interface.
  - New `parseCssColor` helper supports `#hex`, `#rgb`, `rgb(...)`, and `rgba(...)` formats — used internally to parse theme tokens into pdf-lib `rgb()` colors.
  - `PdfContext.theme` field carries the resolved theme to every PDF handler. Built-in handlers (paragraph/heading/image/hr/codeblock/listItem/underline/strikethrough/link) read from `ctx.theme`; extension-contributed PDF handlers via `addExports().pdf` get the same context shape.

  **@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-markdown**

  - No code changes. Patch bump only, lockstep versioning. Plugins' header-footer chrome paint reads `paintCtx.theme` to render header/footer body content with the same theme as the page body — surface theme parity with no surface-side state.

- Updated dependencies [bc1652d]
- Updated dependencies [40be274]
- Updated dependencies [dad19d0]
- Updated dependencies [bf33e14]
  - @scrivr/core@1.0.8

## 1.0.7

### Patch Changes

- b9d64c1: Anchored-object yOffset deferred fixes — closes the items left open by the prior yOffset PR. Core gets the architecture work; export-pdf gets paint-order parity; react/plugins/export-markdown bump in lockstep with no code changes.

  **@scrivr/core**

  - **Phase 5 V2 — FlowBlock rip-out for top-bottom.** The `partKind: "anchored-object"` synthetic FlowBlock split (with its `before / image / after` paragraph fragmentation in `buildBlockFlow`) is gone. Top-bottom now contributes a `side: "full"` rect via `addFullWidthRect` and reflows flows through the same `reflowFlowsAgainstExclusions` path as square. One path, one question. Removes `topBottomImageInfo`, the four `anchoredObject*` fields on `FlowBlock`, and the top-bottom `yOffset` suppression hack in `PointerController` that Phase 5 V1 needed.
  - **`zIndex` attribute on image nodes** (default `0`). Two new helpers — `compareAnchoredObjectPaintOrder` (asc by zIndex, then docPos) and `compareAnchoredObjectHitOrder` (paint order reversed) — drive painting in `PageRenderer`/`export-pdf` and hit-testing in `PointerController`. Schema attr round-trips through PM as a normal number.
  - **Cross-page exact-position drop.** `PointerController.commitAnchoredDrag` now resolves the destination `yOffset` against the new anchor's globalY instead of resetting to `0`. The image lands at the cursor position rather than snapping to the new anchor's natural row. Closes the deferred TODO from the prior PR.
  - **Same-page re-anchor with threshold.** `resolveSamePageReanchor` re-parents an image to the closest paragraph when the committed yOffset would shrink dramatically (past `RE_ANCHOR_THRESHOLD_PX = 24`). Without this the offset accumulates across many drags.
  - **Inline image drag overlay.** Inline images now show the same translucent ghost + caret marker as anchored drags, with `disabled = true` styling for in-gap drops. Mirrors the anchored-drag overlay state contract.
  - **`pageStartGlobal` / `pageLocalYToGlobal` lifted to `PageMetrics`** (`pageStartGlobalForMetrics`, `pageLocalYToGlobalForMetrics`, `PageFlowMetrics` type). One implementation, called from both `PageLayout` and `PointerController`.
  - **`pageRectsDigest` invalidates pagination cache** when anchored-object placements change between layout runs. The runFlowPipeline path now drops `previousLayout` for pagination if the digest mismatches.
  - **Magic-number constants extracted.** `DRAG_THRESHOLD_PX`, `AXIS_STILL_THRESHOLD_PX`, `RE_ANCHOR_THRESHOLD_PX` are file-level `const`s in PointerController.
  - **Tests.** New tests for: zIndex paint/hit order helpers (3), pageRectsDigest invalidation (2), same-page re-anchor (2), cross-page yOffset (1). Existing top-bottom tests updated to the unified-rect shape.

  **@scrivr/export-pdf**

  - Paints anchored objects in `compareAnchoredObjectPaintOrder` to match the canvas renderer. Without this, zIndex would silently differ between PDF and on-screen output.

  **@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-markdown**

  - No code changes. Patch bump only, lockstep versioning.

- dc23d63: Default anchored-image margin (wrap-zone breathing room) bumped from `8px` to `12px` to match Word's `~0.13"` Square / Tight wrap default. The previous 8px default left text appearing flush against the image's visible pixels — 12px is closer to Word and visually clearly separates text from the image at typical reading sizes. Documents with an explicit `margin` attr are unaffected.

  **@scrivr/core**

  - `ANCHORED_OBJECT_MARGIN` constant: `8` → `12`.
  - Image schema default in `Image.ts` extension and `model/schema.ts`: `8` → `12`.
  - One affected test updated (`square-left: constrained lines …` — text now starts at `image.right + 12 = 212` instead of `208`).

  **@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-pdf**, **@scrivr/export-markdown**

  - No code changes. Patch bump only, lockstep versioning.

- a958911: New opt-in debug overlay that visualises anchored-object placement state on the canvas. Useful when "the image looks wrong" — paints the exclusion area, the page-edge clamp boundary, and the paint-order metadata that normally lives only in `LayoutPage.anchoredObjects[]`.

  **@scrivr/core**

  - New `AnchoredObjectDebugOverlay.ts` — `installAnchoredObjectDebugOverlay(editor)` registers an overlay render handler that, when `editor.debug.anchoredObjects` is true, paints on every visible page:
    - **Wrap-zone fill** (translucent blue) at the margin-inflated exclusion rect. Square wrap inflates on all four sides; top-bottom inflates top/bottom only and spans the full content width. Behind/front contribute no exclusion and so render no fill.
    - **Clamp outline** (red, 2px) around the painted rect when `placement.clamped` is true.
    - **wrapMode + zIndex label** pinned to the painted rect's bottom-right corner.
  - `DragDebugConfig.anchoredObjects?: boolean` — new config slot, gated by `editor.debug.anchoredObjects`.
  - The overlay is always installed (zero cost when the flag is off); flip the flag at runtime via `editor.debug.anchoredObjects = true; editor.redraw()`.
  - **Tests.** 7 new cases covering: handler registration, no-op when flag is off, paint invocation when flag is on (square + top-bottom + behind/front variants), clamp outline, and per-page filtering.

  **@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-pdf**, **@scrivr/export-markdown**

  - No code changes. Patch bump only, lockstep versioning.

- 4d76706: Anchored-object drag UX hardening + critical drag fix. Core gets the behavior changes; export-pdf gets a type rename to match; react/plugins/export-markdown bump in lockstep with no code changes.

  **@scrivr/core**

  - **Square-right images now draggable.** Fixed `resolveXAlign` legacy shadow bug — `wrappingMode: "square-right"` was overriding explicit `xAlign: "custom"` set by drag commits, so right-flushed images stayed pinned regardless of drop target. Explicit non-default `xAlign` now always wins.
  - **Drag UX hardening.** Edge-band resize handles (12px) so inner image body is reachable for body drag instead of the 8-handle grid stealing every click. Clamp-no-move guard skips no-op PM transactions when drag clamps to source X. Inter-page gap drops are flagged invalid: ghost goes disabled, no transaction dispatched. Cross-page drag onto a virtualized destination falls back to layout-page block scan instead of silently collapsing to docPos 0.
  - **Single source of truth for image rects.** New `editor.getNodeRect(docPos)` reads `layout.anchoredObjects` first (Stage 3 authoritative), falls back to `charMap` for inline images. Resize handles + selection rendering now derive from the same coordinates as body drag.
  - **Drag debug overlay.** New `DragDebugOverlay` paints solver vs charMap rects (green vs yellow) and the page-gap zone (red strip) when `editor.debug = { drag: true }`. `dragDebugLog` emits structured `[drag]` events at down/move/commit/clampedNoMove/gapDrop.
  - **Phase 1b cache invalidation for square wrap zones.** New `flow.overlapsWrapZone` flag stamped during `reflowFlowsAgainstSquareObject`; `paginateFlow` now skips cached-tail reuse when an upstream wrap zone changed. Closes a silent layout-staleness gap when image attrs flip between runs.
  - **wrap-side spec hint.** `docs/anchored-objects/04-edit-ux.md` now documents the v1 wider-side wrap behavior with a tooltip spec for the future Square wrap-mode picker.

  **@scrivr/export-pdf**

  - Renamed `floats` → `anchoredObjects`, `FloatLayout` → `AnchoredObjectPlacement`, and collapsed `mode: "square-left" | "square-right"` to `wrapMode: "square"` to match the core API. Anchor field renamed `anchorBlockY` → `anchorGlobalY`. Internal helper `drawPdfFloat` → `drawPdfAnchoredObject`. No behavior change — pure rename to track the core type surface.

  **@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-markdown**

  - No code changes. Patch bump only, to keep all `@scrivr/*` packages on the same version.

- 85a8aea: Float-image bug fixes, new `PageBreak` extension, and stricter `ToolbarItemSpec` typing.

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

  - **Public re-exports for `CodeBlock`, `HorizontalRule`, `PageBreak`.** These extensions had `declare module "@scrivr/core"` augmentations but weren't re-exported from `extensions/index.ts`, so the augmentations never reached consumers' type graph (consumer apps saw `setHeading1`/`setLink`/`toggleBold` but not `toggleCodeBlock`/`insertHorizontalRule`/`insertPageBreak`). Adding the exports propagates the augmentations and unblocks typed `editor.commands.*` calls in consumer apps.

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

- 10ea56e: Anchored images can now extend horizontally into the left or right page margins (Word-aligned). Vertical clamp remains at content bounds — top/bottom margins are reserved for headers and footers, so images cannot extend into them. This narrows a divergence from Word's behaviour; Google Docs allows broader margin overflow including footer/off-page drops, which we explicitly do not adopt.

  **@scrivr/core**

  - **`resolveImageX` accepts `pageWidth` and applies a different clamp per `xAlign`.** Named alignments (`left` / `center` / `right`) still snap to content bounds — the typography convention and Word's default "Margin" horizontal anchor. `xAlign: "custom"` (the user-positioned result of a drag) clamps to page bounds: `[0, pageWidth - imageWidth]`. The image can therefore hang into the left or right margin but cannot escape the page.
  - **`PointerController.resolveDragTargetX` clamps the dragged image to page bounds** instead of content bounds, so live drag feedback matches the new commit behaviour.
  - **Vertical `yOffset` clamp is unchanged** — painted top stays in `[pageStart, pageStart + contentHeight - height]`. Top/bottom margins are reserved for headers/footers.
  - **Tests.** Two new `resolveImageX` cases cover left-margin and right-margin overflow; two existing custom-clamp cases updated to assert page-edge clamping. The "Step 3 — clamp-no-move" drag test is reframed around the page-left edge instead of the content-left edge.

  **@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-pdf**, **@scrivr/export-markdown**

  - No code changes. Patch bump only, lockstep versioning.

- 12e8476: Add an explicit `kind: "text" | "leaf" | "tableRow"` discriminator to `LayoutBlock` and migrate every consumer that previously branched on `lines.length === 0`. Foundation-only change: the `tableRow` variant is reserved for the upcoming Table extension and is not produced by any code path yet — paragraph, heading, list, listItem, image, hr, and pageBreak rendering are unchanged.

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

- 3e5ec8f: Closes the double-click rapid-drag race condition: while a drag is in flight, a second `mousedown` is now ignored. Without this guard, an accidental double-click during drag could fire two PM transactions from a single user gesture, or resolve text selection at a stale point.

  **@scrivr/core**

  - `PointerController.handleMouseDown` returns early when any drag is active (`isDragging`, `resizeDrag`, `anchoredDrag`, or `inlineImageDrag`). The guard releases on `mouseup` so a fresh gesture can start cleanly. Equivalent to `setPointerCapture` + `pointerdown` ignore — we use mouse events so the guard is explicit.
  - **Tests.** Three new cases in `PointerController.dragUX.test.ts § Step 9 — pointer capture during drag`: anchored-drag re-entry, resize-drag re-entry, and post-mouseup re-acquisition.

  **@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-pdf**, **@scrivr/export-markdown**

  - No code changes. Patch bump only, lockstep versioning.

- 9be941a: Segment-based wrap exclusions. Square-wrap text now flows through every available segment around an anchored object instead of picking one side. Core gets the layout refactor and a latent-bug fix; react gets a UI consolidation; export-pdf gets the renderer-side equivalent. Plugins and export-markdown bump in lockstep with no code changes.

  **@scrivr/core**

  - **Multi-segment line layout.** `LineBreaker` swapped its single-rect `ConstraintProvider` for a true `LineSpaceProvider` returning `AvailableSegment[]`. A visual line can now span multiple segments — text on both sides of a square-wrap image is filled left-to-right within one line. Lines carry `{ positioned, segments? }` instead of the old `{ constraintX, effectiveWidth }`.
  - **`ExclusionManager` is the single source of rect math.** `PageLayout.reflowFlowsAgainstSquareObject` now populates an `ExclusionManager` and queries `getAvailableSegments`, replacing the inlined subtraction helper that had drifted from the manager implementation.
  - **Schema: `wrapText` attr removed.** The per-image `largest | left | right` wrap-side override is moot now that both sides are usable simultaneously. Existing documents with `wrapText: "left"` etc. parse fine and silently lose the override (no migration needed — visual outcome is just both-sides wrap from now on).
  - **Latent bug fix in `blockHasAnchoredObject`.** The cache-invalidation predicate was reading legacy `wrappingMode` only. Combined with the new ImageMenu writing `{ wrapMode, wrappingMode: "inline" }`, anchored images set via the new menu were misclassified as inline. Now reads through `normalizeImageAttrs` so canonical and legacy attrs both resolve.
  - **Tests:** `ExclusionManager.test.ts` covers `getAvailableSegments` and `getNextFreeY`. `PageLayout.test.ts` asserts that segmented lines preserve word order across the exclusion hole (no drops or duplicates).

  **@scrivr/export-pdf**

  - Renderer skips alignment / justify offsets when `line.positioned`, since segmented lines carry final absolute span x values. Removed an `as`-cast that had been working around a stale type import.

  **@scrivr/react**

  - `ImageMenu` collapses `square-left` + `square-right` buttons into a single `square` toggle — the wrap-side preference is no longer meaningful with segment-based exclusions. `resolveWrappingMode` shims legacy persisted values.

  **@scrivr/plugins**, **@scrivr/export-markdown**

  - No code changes. Patch bump only, to keep all `@scrivr/*` packages on the same version.

- 331160e: Delete the legacy `table` / `tableRow` / `tableCell` node specs from `schema.ts`. They predated the Table extension plan, used an incompatible `columnWidths` attr, and lacked `isolating` / `parseDOM`. The forthcoming Table extension (Phase 1 step 4+ of `docs/tables.md`) will be the single source of truth for table schema.

  **@scrivr/core**

  - Removed the `table`, `tableRow`, `tableCell` node specs from `model/schema.ts`. No code path produces or consumes these nodes today — verified by grep across the monorepo.
  - Updated `model/schema.test.ts` to drop the table nodes from the required-types list and remove the `columnWidths` attr assertion.
  - Documentation (`CLAUDE.md`, `packages/core/README.md`) updated to reflect the trimmed node list.
  - Regression sweep per `docs/tables.md` Phase 1 step 3: paragraph/heading/list/listItem/image/hr/pageBreak rendering unchanged. All 842 core tests, 15 export-pdf tests, 311 plugins tests, 12 export-markdown tests green; full typecheck clean across all 12 packages.

  **@scrivr/export-pdf**, **@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-markdown**

  - No code changes. Patch bump only, lockstep versioning.

- 0d419b7: yOffset Phase 1: structural placement attribute for anchored images. Default `0` is a no-op — pre-Phase-1 documents render identically. Spec: `docs/anchored-objects/06-yoffset-redesign.md`.

  **@scrivr/core**

  - **New image attr `yOffset` (default `0`).** Vertical placement delta from the anchor flow's globalY. `imageRect.y = anchorFlow.globalY + yOffset` is now the single source of truth for paint, exclusion rects, hit-test, and PDF — every consumer reads from `placement.x/y/width/height/page`, no recomputation from anchor flow Y.
  - **`AnchoredObjectPlacement` gains `globalY` and optional `clamped`.** `globalY` is the painted top in continuous global-Y coordinates (= `anchorGlobalY + yOffset`, post-clamp). `clamped: true` is set when the user-set `yOffset` was clamped to keep the image on its anchor's page — Phase 2's drag overlay will read this for the boundary indicator. `anchorGlobalY` keeps its meaning (anchor flow's globalY); the Phase 2 drag snapshot reads it.
  - **Page-edge clamp (V1).** `image.page === anchor.page` is a hard invariant. A `yOffset` that would paint the image off the anchor's page is clamped silently in layout (Phase 2's drag overlay surfaces stickiness visually).
  - **Square-stacking math now uses painted bottoms.** `PageLayout` previously stacked the next square image against the prior placement's _anchor flow_ bottom; under non-zero `yOffset` that re-creates the "moves visually but wraps old location" bug class. Switched to `placed.globalY + height + margin`. Identical behavior when all `yOffset` values are 0.
  - **Square exclusion rect uses painted Y.** `reflowFlowsAgainstSquareObject` is fed the painted `globalY`/`localY`, so text wraps the image's actual position rather than its anchor flow row.
  - **Legacy `floatOffset.y` migrates to `yOffset` on read.** A non-zero `yOffset` is authoritative; the schema-default `0` falls back to `floatOffset.y` so legacy documents keep their vertical placement. New code should write `yOffset` directly.
  - **Tests.** `AnchoredObjects.test.ts` covers the `yOffset` migration table (default, explicit, legacy fallback, malformed `floatOffset` shapes). `PageLayout.test.ts` asserts `yOffset=0` is a no-op, `yOffset=40` shifts paint together with anchor preserved, legacy `floatOffset.y` produces the same painted position as new `yOffset`, page-edge clamp sets `clamped` and pulls overflow back onto the page (positive and negative), and square-stacking respects painted bottoms.

  **@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-pdf**, **@scrivr/export-markdown**

  - No code changes. Patch bump only, to keep all `@scrivr/*` packages on the same version. PDF export already reads `placement.x/y/width/height/page`, so it picks up `yOffset` for free through the layout layer.

- 0d419b7: yOffset Phase 2: drag commits `yOffset`, anchor stays put. Anchored images can now be dragged anywhere on their page without parenting to a different paragraph. Spec: `docs/anchored-objects/06-yoffset-redesign.md` § Phase 2.

  **@scrivr/core**

  - **`PointerController` drag rewrite.** At pointerdown we snapshot the anchor flow's globalY, the image's painted globalY, and the current `yOffset` from `placement.anchorGlobalY` / `placement.globalY` (Phase 1 fields). The snapshot is frozen for the gesture's lifetime — drag math never reads live layout, so vertical drag no longer feeds back into the anchor position.
  - **Same-page drag → `setNodeAttrs({ xAlign, x, yOffset })`.** Pure attr update; the image's docPos doesn't change. The user-visible behavior is the one the redesign was about: "drag an image anywhere on its page and it stays put — the anchor doesn't drift to another paragraph because the cursor passed over one."
  - **Cross-page drag → `moveAndUpdateNode({ ..., yOffset: 0 })`.** Anchor relocates to a paragraph on the new page in one transaction; `yOffset` resets so the image lands at the new anchor's natural position. (Preserving exact visual position across the page break — adjusted yOffset against new anchor's globalY — needs a `pageStartGlobal` helper not yet exposed to PointerController; deferred to a follow-up.)
  - **Y_THRESHOLD = 3px on same-page commits.** Mirrors the existing horizontal threshold. A "pure horizontal" drag with natural mouse jitter (≤3px Y wobble) doesn't write a spurious `yOffset`.
  - **Tests updated.** `PointerController.test.ts` and `PointerController.dragUX.test.ts` switched from the old commit matrix (moveAndUpdateNode for diagonal, moveNode for vertical) to the new one (setNodeAttrs same-page, moveAndUpdateNode cross-page). Pure-horizontal tests now use `dy=0` to assert that `yOffset` is omitted when there's no vertical intent.

  **@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-pdf**, **@scrivr/export-markdown**

  - No code changes. Patch bump only, lockstep versioning. Drag UX is core-side; React just mounts the renderer.

- 349da18: yOffset Phase 3: anchored-image height stops contributing to paragraph height. An image-only paragraph now reserves one default-font line of vertical space instead of inflating to the image's full height. Spec: `docs/anchored-objects/06-yoffset-redesign.md` § Phase 3.

  **@scrivr/core**

  - **`BlockLayout`'s empty-node fallback widens from "renderable" to "non-zero".** Previously the ZWS injection only fired when no spans existed (or only `kind: "break"` spans). Now it also fires when every span is a zero-size object sentinel — i.e. a paragraph whose only content is one or more anchored images.
  - **Sentinel preserved alongside ZWS.** When zero-size object sentinels are present, the ZWS is **appended** rather than substituted, so `getAnchoredObjectAnchors` still finds the image's docPos via `flow.lines[].spans[]`. Empty / break-only paragraphs keep the old substitute-with-ZWS behavior — no behavior change for those.
  - **Result.** Image-only paragraph now has `block.height ≈ MOCK_LINE_HEIGHT` (default font line) rather than `block.height = imageHeight`. Inline images are untouched (their non-zero size keeps `hasNonZeroContent` true). Phase 1 invariant _"`paragraph.height === text.height` (no image contribution)"_ is now true for the empty-anchor case too.
  - **Tests.** `BlockLayout.test.ts` adds four Phase 3 tests: (1) image-only paragraph collapses to default font line, (2) sentinel is preserved on the line, (3) text + non-inline image keeps text line height, (4) inline image still inflates as before.

  **@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-pdf**, **@scrivr/export-markdown**

  - No code changes. Patch bump only, lockstep versioning.

- aef1835: yOffset Phase 4: square reflow shares one `ExclusionManager` per page. Multi-image-on-same-flow now wraps against the union of all rects rather than the last one. Spec: `docs/anchored-objects/06-yoffset-redesign.md` § Phase 4.

  **@scrivr/core**

  - **`resolveAnchoredObjects` owns a `Map<pageNumber, ExclusionManager>`.** When a square anchor is processed, the rect is added to the page's shared manager _before_ the reflow call. Subsequent square anchors on the same page accumulate into the same manager, so flows that overlap multiple images see the union of all rects via `getAvailableSegments`.
  - **`reflowFlowsAgainstSquareObject` → `reflowFlowsAgainstSquareExclusions`.** The function no longer creates its own `ExclusionManager` or calls `addRect`. It receives the shared manager and a `{ pageNumber, zoneTop, zoneBottom, contentX, contentWidth }` zone for early-exit bounds. The `lineSpaceProvider` queries the manager directly so each line sees every rect added so far on the page.
  - **Latent bug fix.** Two square images in the same paragraph (or in adjacent paragraphs with overlapping wrap zones) used to corrupt subsequent text wrap: the second reflow's single-rect query returned segments around image B only, overwriting the first call's result and silently positioning text underneath image A. The shared manager fixes this by construction. Tracked as `todo_anchor_stacked_reflow.md`.
  - **Iteration semantics preserved for the common case.** Sequential anchors in document order — the realistic workload — re-iterate downstream flows against the current manager state, so adding a rect always reflows everything below it. Pathological out-of-document-order overlaps (anchor A late in the doc with a yOffset that places its rect above anchor B earlier in the doc) are not handled by this iteration; that's a Phase 4 follow-up if it appears in real documents.
  - **Cache invalidation deferred.** Spec calls for a `pageRectsDigest` to widen the per-flow `overlapsWrapZone` cache key; this PR keeps the existing flag (set when a flow's Y intersects the current zone) and accepts that flow caching can stale when an image rect moves under yOffset. Will land in a follow-up.
  - **Tests.** New `PageLayout.test.ts` test: two square images (`xAlign: "left"` and `xAlign: "right"`) on the same page with a long text paragraph below — text spans are asserted to fall entirely between the two rects' painted edges, not beneath either image.

  **@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-pdf**, **@scrivr/export-markdown**

  - No code changes. Patch bump only, lockstep versioning.

- 2189983: yOffset Phase 5 (minimal): top-bottom anchored objects contribute a `side: "full"` rect to the page's shared `ExclusionManager`. Architectural unification — all wrap modes now feed one manager. Spec: `docs/anchored-objects/06-yoffset-redesign.md` § Phase 5.

  **@scrivr/core**

  - **`ExclusionManager.addFullWidthRect(...)` helper.** Closes the spec's correctness gap on `side: "full"` rects: a manually-set `addRect` with `side: "full"` but `x` / `right` narrower than the queried content area silently leaves side segments, which makes `getAvailableSegments` drop the `skipToY` (segments.length ≠ 0 → skipToY suppressed in the return). The helper takes `{ page, y, bottom, contentX, contentWidth, docPos }` and forces the rect to span the content bounds — the failure mode is unreachable.
  - **Top-bottom rects flow into the page-level manager.** In `resolveAnchoredObjects`, when `wrapMode === "top-bottom"`, the placement now also contributes a full-width rect via `addFullWidthRect`. Square reflows on the same page therefore see top-bottom bands as real exclusions through the same manager that drives square wrap — Phase 4's per-page `ExclusionManager` now holds rects for _every_ anchored wrap mode.
  - **Scope choice — minimal V1.** The spec also calls for ripping out the `partKind: "anchored-object"` `FlowBlock` splitting in `buildBlockFlow` so top-bottom and square share the layout-pipeline path entirely. That rewrite forces test rewrites (8+ existing tests assert the image lives as its own layout block separated from "before" / "after" text fragments). Deferred to Phase 5 V2; the current FlowBlock splitting still positions the image vertically for the no-overlap-with-square common case. The user-visible win — top-bottom and square interacting cleanly through one manager — lands now; the structural rip-out is a separate change.
  - **Tests.** New `ExclusionManager.test.ts` tests: (1) `addFullWidthRect` produces `skipToY` for overlapping queries, (2) demonstrates the failure mode the helper prevents (manual `addRect` with mismatched bounds suppresses `skipToY`).

  **@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-pdf**, **@scrivr/export-markdown**

  - No code changes. Patch bump only, lockstep versioning.

- Updated dependencies [b9d64c1]
- Updated dependencies [dc23d63]
- Updated dependencies [a958911]
- Updated dependencies [4d76706]
- Updated dependencies [85a8aea]
- Updated dependencies [10ea56e]
- Updated dependencies [12e8476]
- Updated dependencies [3e5ec8f]
- Updated dependencies [9be941a]
- Updated dependencies [331160e]
- Updated dependencies [0d419b7]
- Updated dependencies [0d419b7]
- Updated dependencies [349da18]
- Updated dependencies [aef1835]
- Updated dependencies [2189983]
  - @scrivr/core@1.0.7

## 1.0.6

### Patch Changes

- 36a7776: **@scrivr/react** — Add `readOnly` option to `useScrivrEditor` hook. Reset `letterSpacing`, `wordSpacing`, `textTransform` on the `<Scrivr>` container to prevent host app CSS from causing cursor drift.

  **@scrivr/core** — New `Indent` extension with block indent (`Mod-]`/`Mod-[`, 0-8 levels at 24px each) and first-line indent (`textIndent` attr in px). Both inherited on Enter split, parsed from paste, serialized to DOM. Expose `getMarkdownParserTokens()` and `parseMarkdown(text)` on `BaseEditor` for server-side markdown parsing.

- 88016a6: Add LICENSE file and README to all packages. Add missing `license` field to export-pdf, export-markdown, and export-docx package.json files.
- ddd1448: Allow mouse selection (click, drag, double/triple-click) in readOnly mode so users can select and copy text. Block programmatic command dispatch (`editor.commands.*`) in readOnly to prevent extensions from bypassing InputBridge.
- Updated dependencies [39e008c]
- Updated dependencies [36a7776]
- Updated dependencies [88016a6]
- Updated dependencies [ddd1448]
  - @scrivr/core@1.0.6

## 1.0.5

### Patch Changes

- f6950b5: Add token authentication and connection lifecycle callbacks to the Collaboration plugin and collab server.

  **@scrivr/plugins** — `Collaboration.configure()` now accepts `token` (string or async function) forwarded to HocuspocusProvider for WebSocket auth, plus optional `onConnect`/`onDisconnect` callbacks for connection lifecycle visibility.

- 0f6d00a: Fix cross-page selection highlight and cursor fallback for float-only pages
- 81970d5: Refactor monolithic `buildPdf()` into a 7-phase handler dispatch pipeline. Extensions can now contribute PDF node/mark/chrome handlers via `addExports()`.

  - `@scrivr/core`: add `ExtensionManager.getExportContributions()` and `BaseEditor.getExportContributions()` on `IBaseEditor`; fix missing `text` + `hardBreak` markdown serializer rules in Document extension
  - `@scrivr/export-pdf`: extract `PdfContext`, `PdfDrawHelpers`, `PdfFontRegistry`, and default node/mark handlers into dedicated modules; fill `PdfHandlers` with real typed interfaces (`PdfNodeHandler`, `PdfMarkHandler`, `PdfChromeHandler`)
  - `@scrivr/export-markdown`: fill `MarkdownHandlers` with `MarkdownNodeHandler` and `MarkdownMarkHandler`; widen `exportToMarkdown()` to accept `BaseEditor`; add 12 tests

- ff7390f: Split `@scrivr/export` into `@scrivr/export-pdf` (pdf-lib) and `@scrivr/export-markdown` (prosemirror-markdown) so each format carries only its own deps. The original `@scrivr/export` becomes a compat shim that re-exports from both — existing consumers keep working.

  Add `addExports()` extension lane to `@scrivr/core` with the `FormatHandlers` augmentation pattern. Format packages declare their handler shape via module augmentation; extensions contribute format-tagged handlers via `addExports()`. Handler interfaces are placeholders until the M2 export dispatch refactor fills them.

  Dependent packages bumped to pick up the new export extensibility types.

- a198d0f: Add HeaderFooter extension with configurable headers and footers, live inline editing, token substitution, and PDF export parity.

  **@scrivr/plugins** — New `HeaderFooter` extension: doc-level `headerFooter` policy, per-page slot resolution (`differentFirstPage`, `differentOddEven` reserved), `pageNumber`/`totalPages`/`date` inline atom tokens with dynamic `measure()`, headless `HeaderFooterController` for building settings UI, surface-based live editing with undo/redo history, restricted schema (no tables/page breaks), and PDF chrome + token export handlers.

  **@scrivr/core** — Surface-aware command routing (`_getActiveState`/`_dispatchToActive`), `chromeClick` event, `PageChromePaintContext` gains `measurer`/`markDecorators`/`blockRegistry`/`inlineRegistry`, `ChromeContribution` gains `replacesTopMargin`/`replacesBottomMargin`/`topBandStart`/`bottomBandStart`, `EditorSurface` accepts plugins, `IEditor` exposes `surfaces`/`invalidateLayout`/`getPageScreenPosition`, `InlineStrategy` type exported from layout index, and `addCommands` signature widened to support typed command parameters.

  **@scrivr/export-pdf** — Chrome payload image scanning for `embedImages`, WinAnsi sanitizer expanded to cover smart quotes and em/en dashes.

  **@scrivr/react** — New `HeaderFooterRibbon` component (Google Docs-style ribbon bar with "Different first page" toggle, margin controls, token insert buttons, and remove header/footer actions).

- Updated dependencies [bf50408]
- Updated dependencies [f6950b5]
- Updated dependencies [0f6d00a]
- Updated dependencies [81970d5]
- Updated dependencies [ff7390f]
- Updated dependencies [a198d0f]
- Updated dependencies [8ccf3ea]
  - @scrivr/core@1.0.5
