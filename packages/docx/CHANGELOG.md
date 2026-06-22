# @scrivr/export-docx

## 1.0.13

### Patch Changes

- 741709c: `@scrivr/core` — `ensureFullLayout()` no longer inherits a truncated tail (fixes
  PDF export still dropping the end of large documents, the residual from 1.0.12).

  It seeded the re-layout with the partial layout, so pagination's
  early-termination copied that partial's downstream pages — which end at the
  streamed block cutoff (the tail was never laid out). A mid-document cache miss
  (e.g. a `tableRow`, whose measurement bypasses the cache) followed by cached
  paragraphs was enough to trigger the copy, producing a "complete" layout that
  was actually cut off at the partial boundary. It also forced `layoutIsPartial =
false`, so `exportToPdf`'s partial-layout guard could never fire.

  `ensureFullLayout` now lays out from scratch (no `previousLayout`), making the
  early-termination guard unsatisfiable, and reads `isPartial` back instead of
  forcing it false (restoring the export guard as a real backstop). The
  `measureCache` still speeds per-block measurement.

  Regression test: a 300-paragraph doc with a mid-document table lays out all
  blocks after `ensureFullLayout` (truncated to the 100-block partial before).

  Other packages: lockstep version bump, no behavior change.

- Updated dependencies [741709c]
  - @scrivr/core@1.0.13

## 1.0.12

### Patch Changes

- 80e1e65: `@scrivr/core` — an anchored object no longer paints over a preceding paragraph
  that splits across a natural page boundary.

  Root cause (the natural-split sibling of the explicit-page-break fix): Stage 4
  paginates at the line level — a line that would cross a page bottom moves whole
  to the next page, leaving an unused sub-line gap. Stage 2's continuous
  `globalY` ignored those gaps, so an anchored object whose anchor sits after a
  paragraph that splits was placed from a coordinate that ran ahead of where
  Stage 4 actually puts the surrounding lines — the float landed a page early /
  too high and overlapped the paragraph's tail.

  Fix: `assignGlobalY` and `restampGlobalYFrom` now advance through each flow with
  a shared `advanceFlowGlobalY` helper that models the page-bottom gaps, reusing
  the same `fitLinesInCapacity` primitive `paginateFlow` uses so the line-fit
  decision can't diverge. With `globalY` reflecting true paginated positions,
  Stage 3's page derivation, anchor-push, and exclusion zones agree with Stage 4
  for every wrap mode — the model invariant ("no content after an anchored object
  renders on an earlier page than the object") now holds for natural splits too.

  Regression test: a top-bottom float after a paragraph that splits 4 + 1 at a
  non-line-aligned page boundary stays below the tail (fails before, passes now).
  Full core suite green (1173 tests) — no pagination/streaming/cache regressions.
  The demo's "Top and bottom" intro is restored to its full multi-line form,
  which now paginates correctly.

  Other packages: lockstep version bump, no behavior change.

- d91051d: `@scrivr/core` — an anchored object after an explicit page break now stays on
  the same page as its anchor instead of being left behind on the previous page.

  Root cause: a `pageBreak` flow has height 0, so Stage 2 (`assignGlobalY`) gave
  it no contribution to the continuous `globalY`. Stage 3 then derived the
  anchor's page from that continuous coordinate — which still pointed at the
  pre-break page — so an image anchored after the break was placed there, while
  Stage 4 force-advanced the anchor text to the next page. The float and its
  anchor split across pages (the "behind"/"front"/"square" image stranded on the
  prior page, with text wrapping the wrong page).

  Fix at the Stage 2/3 seam: `assignGlobalY` (and `restampGlobalYFrom`, used by
  the anchor-push and wrap-zone reflow) now advance `globalY` to the next page's
  content top when they cross a forced page break. With `globalY` reflecting the
  real vertical position, Stage 3's page derivation, anchor-push, and exclusion
  zones all agree with Stage 4's pagination — the model invariant ("no content
  after an anchored object renders on an earlier page than the object") holds by
  construction for the explicit-page-break case.

  Regression test: a square float anchored after a `pageBreak` lands on page 2
  with its anchor (fails before, passes now).

  Remaining known limitation: a float can still desync from its anchor when the
  _preceding paragraph_ splits across a natural page boundary (no explicit
  break) — a separate Stage 3/Stage 4 case tracked for later.

  Other packages: lockstep version bump, no behavior change.

- 8ba5a90: `@scrivr/core` — defensive clamp so `AnchoredObjectPlacement.page` never
  exceeds `layout.pages.length`.

  Under extreme inputs (huge image height + dense float packing + extreme
  `yOffset`), the anchored-object solver picks `placement.page` based on
  geometry before pagination finalizes the page count. If no flow content
  lands on that geometry-derived page, the page list truncates but the
  placement keeps the higher index — and downstream consumers (PDF export
  indexed by page, hit-testing reaching for `CharacterMap` on a
  non-existent page) reference a page that doesn't exist.

  `runPipeline` now calls `clampPlacementsToPages(mergedPlacements,
pages.length)` on the **final** layout (non-partial branch) so every
  placement that survives into `layout.anchoredObjects` satisfies
  `placement.page <= layout.pages.length`. Partial layouts are
  intentionally left un-clamped: they get carried forward to the next
  streaming chunk as `previousLayout?.anchoredObjects`, and clamping there
  would permanently lose a placement's original page when a later chunk
  grows the layout back. View consumers reading a partial layout during
  streaming may briefly observe `placement.page > pages.length`; the
  window closes when the next chunk arrives.

  The clamp leaves `placement.y` untouched — the float was already
  painting off the bottom of its intended page; the visual is no worse,
  but every loop that iterates pages can now trust the index. Common
  case stays allocation-free (returns the input reference when no
  clamping is needed).

  `clampPlacementsToPages` is `@internal` — used by `runPipeline`
  finalization, not part of the `@scrivr/core` public API. The package
  barrel does not re-export it.

  Tests: 5 new cases in `PageLayout.test.ts` cover the clamp, the
  `y`-preservation contract, the allocation-free no-op path, the empty
  input, and the `pageCount === 0` guard.

  Other packages: lockstep version bump, no behavior change.

- 5fb5ddd: `@scrivr/core` — fix text-selection drag getting stuck at the source page
  when the cursor crosses into a page whose CharacterMap has not been
  populated yet.

  `PointerController.handlePointerMove` calls
  `editor.charMap.posAtCoords(x, y, page)` on every frame of a text-select
  drag. `posAtCoords` is page-scoped: on a destination page whose glyphs
  have not been registered (the common case during the first drag into an
  off-cursor page), `nearestLine` returns `undefined`, the lookup falls
  through to `0`, and `setSelection(anchor, 0)` collapses the selection to
  the document start — visually appearing as "drag stuck at the source
  page" because the destination half never receives a valid head.

  The anchored-object drag handler in the same controller already mitigates
  this: it calls `editor.ensurePagePopulated(hit.page)` before resolving
  `posAtCoords` (see `resolveDragTargetDocPos`). Text drag now does the
  same. The selection head now updates correctly as the pointer enters
  each new page during a drag.

  In the same fix, mid-drag pointermoves whose `hitTest` result lands in
  the inter-page gap (`hit.gap === true`) are now skipped instead of
  re-running `posAtCoords` with `docY` clamped to the source-page bottom.
  Without this, every gap-traversal frame would re-collapse the selection
  head to end-of-source-page on the way down. The last valid selection now
  sticks until the pointer enters real page content again.

  Tests: three new cases in `PointerController.test.ts` cover (a) the
  `ensurePagePopulated` call during a cross-page drag, (b) the gap-skip
  behavior, and (c) the end-to-end selection-head update when dragging
  into page 2.

  Other packages: lockstep version bump, no behavior change.

- 758dd29: `@scrivr/core` — expose `cursorManager: CursorManager` on the `IEditor`
  interface so extensions running in `onViewReady` can reset the blink
  cycle and read the current blink phase with full typing instead of
  ad-hoc structural mirrors.

  `ServerEditor` still does not implement this surface — blink is a
  view-layer concern and only `Editor` (browser) carries a `CursorManager`.
  The `IBaseEditor` interface is unchanged.

  `@scrivr/plugins` — `HeaderFooter` no longer carries the `CursorManagerLike`
  structural-typing workaround. The `isCursorManagerLike` runtime guard
  and `getCursorManager` / `isCursorVisible` helpers are gone; call sites
  now read `editor.cursorManager` directly. No behavior change — the
  blink reset on every header keystroke and the cursor-visibility gate
  on the overlay handler fire identically. Just the wrong-shape failure
  class (a rename of `CursorManager.resetSilent` would have silently
  broken header blink behavior) is removed.

  Other packages: lockstep version bump, no behavior change.

- 1e76d7c: `@scrivr/core` + `@scrivr/docx` — DOCX export and import for tables, so the
  table extension round-trips through Word the same way it already does through
  PDF.

  Export is extension-owned: `Table.addExports()` now contributes `docx` node
  handlers (`table` / `tableRow` / `tableCell` / `tableHeader`) alongside the
  existing `pdf` handler, keeping `@scrivr/docx` free of table-specific
  knowledge. The walker dispatches them like any other node — a `table` becomes
  `<w:tbl>` with `<w:tblPr>` (single-line borders matching the canvas grid) +
  `<w:tblGrid>` (column widths px→twips), each row a `<w:tr>` (with
  `<w:tblHeader/>` when `repeatHeader` is set), each cell a `<w:tc>` carrying
  `<w:gridSpan>`, `<w:vMerge>`, and `<w:shd w:fill>` for the background.

  Import mirrors the list precedent — nested structural blocks are
  package-handled (not extension-dispatched) so the recursion has the full
  handler set. `parser.ts` claims `<w:tbl>` into a new `DocxBlock` table shape
  (grid twips→px, rows, cells with gridSpan/vMerge/background); `transform.ts`'s
  `buildTableNode` builds the `table` node, reconstructing a `<w:tblHeader/>` row
  as `repeatHeader` + `tableHeader` cells so header semantics survive the trip.

  A table imported into a schema without the table nodes warns
  (`schema-missing-table`) and drops, the same non-fatal way a list does when
  `bulletList`/`listItem` are absent.

  Tests: round-trip coverage in `@scrivr/docx` (rows/cells/text, grid widths,
  header row + background, and the emitted OOXML elements). The pre-existing
  "unsupported element" policy tests move from `<w:tbl>` (now supported) to
  `<w:sdt>`.

  Other packages: lockstep version bump, no behavior change.

- 1e76d7c: `@scrivr/core` — anchored floats no longer paint over text at their top edge.

  The line-space exclusion probe in `LineBreaker` sampled each prospective line
  with a 1px height (`lineY..lineY+1`). A line whose top sat just above a float's
  exclusion zone but whose body extended into it was therefore read as
  non-overlapping and laid out full-width, so text — or a heading directly above
  the float — painted under the float's top edge.

  The four probes now pass the line's real height (the starting word's font
  metrics, or an inline object's height), and the `BlockLayout` first-line-indent
  wrapper forwards that height instead of replacing it with 1. Every line that
  actually overlaps a float now wraps out of its column.

  Two regression tests cover it: a square float whose zone top falls mid-line,
  and a top-bottom float reserving its full vertical band — both overlap at the
  old 1px probe and are clean now.

  Known limitation (unchanged): a float still desyncs from its anchor across an
  explicit page break or a paragraph that splits across a page boundary; that's a
  separate Stage 3/Stage 4 placement issue tracked for a later fix.

  Other packages: lockstep version bump, no behavior change.

- ff43b26: `@scrivr/plugins` — fix heading/paragraph (and every other extension
  command) inside header and footer editing surfaces.

  Header/footer surfaces previously built their own restricted `Schema`
  instance by copying the host editor's node specs into a fresh
  `new Schema(...)`. `Heading.addKeymap()` and `addCommands()` capture
  the host schema's `NodeType` at extension-resolve time and pass it to
  `setBlockType()`. When the user pressed `Mod-Alt-1` (or invoked
  `setHeading1` via a toolbar) inside a header, the keymap fired with a
  host-schema `NodeType` against a surface state built from a _different_
  `Schema` instance; ProseMirror's `canChangeType` rejected the mismatch
  and the command silently returned `false`. The user saw nothing happen.

  Surfaces now share `editor.schema` directly — same `Schema` instance,
  same `NodeType` identity — so heading↔paragraph conversion, list
  toggles, marks, and every other extension command work in headers and
  footers exactly as they do in the body.

  The "no tables, no page breaks in header/footer" restriction moves
  from a rebuilt schema to a `filterTransaction` ProseMirror plugin on
  the surface (`createBlockedNodeFilter`). The plugin walks the resulting
  doc and rejects any transaction that introduces `table`, `tableRow`,
  `tableCell`, or `pageBreak`. Same enforcement guarantee, applied at
  the transaction layer instead of the schema layer, with one
  mechanism covering paste, command insertions, and external dispatches.

  **Public API surface:** `buildRestrictedSchema` is no longer exported
  from `@scrivr/plugins` (the function is gone). The blocklist is
  exposed as `HEADER_FOOTER_BLOCKED_NODES: ReadonlySet<string>` for
  consumers that want to inspect or extend it.

  Other packages: lockstep version bump, no behavior change.

- c18ea0b: `@scrivr/plugins` — the Collaboration extension now connects on a headless
  `ServerEditor`.

  Provider/binding setup lived in `onViewReady`, which only fires in the browser
  `Editor` — so a `ServerEditor` (no view) never created its Y binding or provider
  and never joined the document. Setup moves to `onEditorReady`, which fires in
  both environments; `YBinding` already depends only on `IBaseEditor`, so it works
  unchanged. The two `setReady` calls (layout/paint suppression during Y.js sync)
  are view-only and are now guarded — they no-op headless, where there is no paint
  to suppress. `collaborationRegistry` is keyed by `IBaseEditor` so server-side
  collab registers there too.

  A side benefit: collaboration now wires up in `onEditorReady`, which always runs
  before `CollaborationCursor`'s `onViewReady`, so the cursor extension can rely on
  the provider already being registered.

  Test: a `ServerEditor` configured with Collaboration registers its provider and
  Y.Doc on construction (fails on the old `onViewReady` path).

  Other packages: lockstep version bump, no behavior change.

- be79212: `@scrivr/core` + `@scrivr/export-pdf` — PDF export of large documents no longer
  truncates.

  Large documents stream their layout: first paint lays out an initial chunk and
  idle callbacks complete the rest. `exportToPdf` read `editor.layout.pages`
  before the stream finished (and in a server/node context the idle callbacks may
  never fire), so the exported PDF contained only the first chunk's pages.

  `@scrivr/core` adds `IEditor.ensureFullLayout()`, which cancels pending idle
  layout work and runs the full pipeline synchronously with no block cutoff.
  `exportToPdf` now calls it before reading the layout and throws a clear error if
  the layout is still partial (e.g. an older core without the method).

  Tests: `Editor.ensureFullLayout` synchronously completes a streamed 160-block
  layout; `buildPdf`/`exportToPdf` cover the paged-layout path.

  Other packages: lockstep version bump, no behavior change.

- 1e76d7c: Table fit/hit-test fixes, and a **breaking** `buildPdf` signature change.

  **`@scrivr/export-pdf` — BREAKING:** `buildPdf(layout, options?, editor?)` is now
  `buildPdf(layout, editor, options?)` with `editor` **required**. PDF handlers for
  extension nodes (e.g. `table`) are contributed through
  `editor.getExportContributions()`, so calling `buildPdf` without an editor
  silently dropped those blocks (blank table rows). Making the editor required
  removes that footgun at the type level. The editor only needs the
  `getExportContributions` surface, so a `ServerEditor` is sufficient for
  server-side/test use. `exportToPdf(editor, options?)` is unchanged. Migration:
  `buildPdf(layout)` → `buildPdf(layout, editor)`; `buildPdf(layout, opts)` →
  `buildPdf(layout, editor, opts)`. A block whose node type still has no handler is
  skipped with a one-time `console.warn` instead of failing silently.

  **`@scrivr/core` — table column fit:** `TableLayoutEngine` now scales the
  `table.grid` widths to fill the available content width (Word/Docs behaviour), so
  a grid whose sum exceeds the page no longer overflows the margin, and a narrow
  grid stretches to fill. `availableWidth` is threaded into the engine.

  **`@scrivr/core` — table cursor navigation:** Home/End and vertical line
  navigation (`lineStartPos`/`lineEndPos`/`posAbove`/`posBelow`) now resolve the
  line in 2D (x and y). Previously they used a y-only lookup that, in a table row
  where cells share a y band, could resolve the first cell's line instead of the
  cell the cursor is in. The y-only `lineAtCoords` helper is removed; all
  point-based lookups use the unified 2D resolver.

  Other packages: lockstep version bump, no behavior change.

- 7b54708: `@scrivr/core` — Table Phase 3: structural row/column commands, mapped to Word.

  The Table extension (opt-in via `StarterKit.configure({ table: true })`) now
  exposes the structural editing commands on top of the existing
  `insertTable`/`deleteTable`:

  - `addRowBefore` / `addRowAfter` — insert an empty row above/below the
    selected cell's row. Inserting a row through a vertical merge extends the
    merge (a `continue` cell is added) instead of splitting it.
  - `deleteRow` — remove the selected row. Deleting the top row of a vertical
    merge promotes the continuation below to the new master so the merge
    survives one row shorter. Deleting the last remaining row removes the whole
    table (an empty table is invalid).
  - `addColumnBefore` / `addColumnAfter` — insert an empty column left/right of
    the selected cell and extend `table.grid`. Inserting through a horizontal
    `gridSpan` grows that cell's span rather than adding a stray cell.
  - `deleteColumn` — remove the selected column and shrink `table.grid`. A cell
    whose span covers the deleted column shrinks by one; deleting the last
    column removes the table.

  When deleting the last row or column would remove a table that is the entire
  document, the table is replaced with an empty paragraph so the document stays
  valid rather than empty. A selection resting in a vertical-merge continuation
  cell resolves to its master cell, so the commands operate on the right cell.

  - `goToNextCell` / `goToPreviousCell` — move the selection between cells in
    document order. Binding these to `Tab`/`Shift-Tab` (with new-row-on-overflow)
    is the editing-guards plugin's job in a later phase.

  Edits are fine-grained `setNodeMarkup` / `insert` / `delete` steps against the
  live document, so cells untouched by a command keep their `Node` identity and
  the measurement cache stays warm. `tableIntegrityPlugin` continues to repair
  any residual structural drift after each command.

  Other packages: lockstep version bump, no behavior change.

- 1e76d7c: `@scrivr/core` — Table Phase 4: real cell layout, rendering, cursor, and PDF
  parity. Tables (opt-in via `StarterKit.configure({ table: true })`) are now a
  usable feature, not a placeholder.

  - **Layout** — `TableLayoutEngine` lays out each cell's child blocks inside its
    column box (width from the table's `grid`, minus padding) by reusing
    `layoutBlock`, and sizes each row to its tallest cell. Cell `x` is absolute,
    cell/child `y` is relative to the row top, so the layout stays
    position-independent and reuses across page placements. Table rows are
    re-measured fresh (bypass the block measure cache) so cell span positions stay
    correct.
  - **Rendering** — `TableRowStrategy` paints cell borders/backgrounds and the
    cell text (reusing the body-text `drawBlock` path), with the top border
    suppressed for `vMerge` continuations so a vertical merge reads as one cell.
  - **Cursor** — `populateCharMap` descends into cells, so clicking a cell places
    the caret inside it and typing works like any other block.
  - **PDF parity** — table rows export to PDF. The handler is owned by the Table
    extension (`addExports({ pdf: { nodes: { tableRow } } })`) using a structural
    PDF-context shape, so core stays free of `pdf-lib`.

  Demo: tables are enabled in the playground (`apps/docs`).

  Other packages: lockstep version bump, no behavior change.

- Updated dependencies [80e1e65]
- Updated dependencies [d91051d]
- Updated dependencies [8ba5a90]
- Updated dependencies [5fb5ddd]
- Updated dependencies [758dd29]
- Updated dependencies [1e76d7c]
- Updated dependencies [1e76d7c]
- Updated dependencies [ff43b26]
- Updated dependencies [c18ea0b]
- Updated dependencies [be79212]
- Updated dependencies [1e76d7c]
- Updated dependencies [7b54708]
- Updated dependencies [1e76d7c]
  - @scrivr/core@1.0.12

## 1.0.11

### Patch Changes

- ec550ce: `@scrivr/docx` — lock the DOCX export base contract AND ship the
  semantic-core default handlers. Replaces the type-only skeleton with a
  real, deterministic pipeline that produces a Word-openable `.docx` out of
  the box. Built so feature PRs (lists, tables, images, hyperlinks,
  track-changes) can add handlers without renegotiating the contract.

  The default handlers cover the StarterKit semantic primitives — paragraph,
  heading (with auto-registered Heading1-6 paragraph styles), hardBreak,
  pageBreak, horizontalRule, codeBlock, and the basic marks (bold, italic,
  underline, strikethrough, code, color, highlight, fontSize, fontFamily).
  Without them an unconfigured editor would export an empty body that Word
  rejects, so they're part of the base, not deferred.

  A new `DocxExport` extension contributes `editor.commands.exportDocx()` +
  an "⬇ DOCX" toolbar button, mirroring the `PdfExport` pattern.

  The base PR ships the pieces that are expensive to change later:

  **Contract (locked)**

  - `DocxNodeHandler(node, children, ctx, meta)` — walker owns recursion and
    passes already-composed child XML in; handlers wrap or position it.
  - `DocxMarkHandler(props, mark, ctx) → DocxRunProps` — marks accumulate
    into a run-property bag, never wrap XML, so `bold(italic(...))` cannot
    produce nested `<w:r>` (invalid OOXML).
  - `DocxRunProps` reserves `trackedInsert`/`trackedDelete` fields. The
    walker intentionally does NOT emit `<w:ins>`/`<w:del>` — track-changes
    XML lands in a dedicated feature PR with author/date/comment-range
    semantics.
  - `DocxExportResult { bytes, diagnostics }` from `exportDocx()` — DOCX
    is inherently lossy, so the API surfaces fidelity warnings from day
    one. `exportDocxBytes()` is the ergonomic alias.
  - `DocxExportError` carries `diagnostics` so fatal failures preserve the
    warnings that preceded them.
  - `options.unsupported: "drop" | "placeholder" | "throw"` and
    `options.fidelity: "strict" | "compatible" | "best-effort"` — value
    types locked even though only `"drop"` and `"compatible"` are honored
    by the base walker (feature PRs branch on these without touching the
    contract).

  **Pipeline**

  - `collect → createContext → onBeforeExport → walk → onBuildTreeComplete
→ finalize / default packager → zip`.
  - Handler layering: built-in defaults → extension `addExports().docx`
    contributions → per-call `options.overrides`.
  - `walkDocument` skips the implicit root, returns body XML; default
    packager wraps it in `<w:document>/<w:body>` plus a US-Letter sectPr.
  - `createDocxContext` exposes producer registries (`styles.getOrCreate`,
    `numbering.getOrCreate`, `rels.addImage/addHyperlink`, `media.add`,
    `diagnostics.warn/error`, `shared.getOrInit`) backed by an internal
    `DocxBuildState` the OPC builder walks.
  - `buildDocxPackage` emits all required OPC parts:
    `[Content_Types].xml`, `_rels/.rels`, `word/document.xml`,
    `word/_rels/document.xml.rels`, `word/styles.xml`, `word/numbering.xml`,
    `word/settings.xml`, plus media parts and extension content-type
    defaults per unique extension.
  - Internal document rels use stable named IDs (`rIdStyles`,
    `rIdNumbering`, `rIdSettings`) so they never collide with user-allocated
    `rId{n}` IDs.

  **Serializer**

  - `xml(name, attrs?, children?)` builder + `serializeXml(root, opts?)`
    with alphabetical attribute ordering for golden-test stability and
    proper XML escaping for both text and attribute values.
  - `xml:space="preserve"` is automatically applied to text runs with edge
    whitespace.

  **Mark merging**

  - `<w:rPr>` children emitted in OOXML spec order (`rStyle`, `rFonts`,
    `b`, `i`, `strike`, `color`, `sz`, `highlight`, `u`).
  - Run-prop conversion: `fontSize` (px) → half-points (×1.5), `color`
    strips leading `#`, `code` mark sets Courier New `rFonts` when no
    explicit `fontFamily`.

  **ZIP**

  - `fflate` (`zipSync`) — small (~8KB), zero deps, browser + Node compatible.
  - `mtime` pinned to the ZIP epoch so identical input produces identical
    bytes (deterministic for content-addressable storage and golden tests).

  **Word compatibility**

  - The walker's "drop" policy now wraps orphan inline children of a
    dropped textblock in `<w:p>` — bare `<w:r>` as a direct child of
    `<w:body>` is invalid OOXML and Word refuses to open the file.
  - `buildDocumentRoot` injects an empty `<w:p/>` when the walked body
    is empty (same reason — Word rejects empty bodies).

  **Tests**

  - 51 unit tests across `xml`, `walker`, `package`, `defaults`,
    `exportDocx`. Walker tests drive a real `ServerEditor` + StarterKit
    schema (no fake nodes / fixtures) — exercises text emission,
    whitespace preservation, mark merging into a single run, missing-mark
    warnings, all three unsupported policies, font-size unit conversion,
    and the reserved track-changes fields (verifies no `<w:ins>`/`<w:del>`
    emission yet).
  - End-to-end test exports a `ServerEditor` doc, unzips the bytes, and
    asserts every required OPC part is present and well-formed.

  Other packages: lockstep version bump, no behavior change.

- ec550ce: DOCX image export — `image` node now exports to `<w:drawing>` with all five
  Scrivr wrap modes mapped to the corresponding OOXML wrap elements. Embedded
  as binary parts under `word/media/`, referenced by document-level rels.

  **Where it lives**

  - `packages/core/src/extensions/built-in/Image.docx.ts` — the extension owns
    its DOCX export shape. Uses LOCAL structural type stand-ins (no runtime
    imports of `@scrivr/docx`) so the dependency direction stays
    one-way (docx → core). The integration test in `@scrivr/docx`
    asserts the local types stay structurally compatible with `DocxContext`.
  - Image extension's `addExports()` returns `{ docx: imageDocxContribution }`.
    StarterKit got a new `addExports()` that aggregates sub-extension
    contributions (format-aware merge: `nodes`/`marks` combine, lifecycle
    hooks chain, `onFinalize` is last-writer-wins) — Image's docx
    contribution now propagates through StarterKit to the export pipeline.

  **Wrap-mode mapping (Scrivr → OOXML)**
  | Scrivr `wrapMode` | OOXML wrapper | Wrap element |
  |-------------------|---------------------|-------------------------------|
  | `inline` | `<wp:inline>` | (atom inside `<w:r>`) |
  | `square` | `<wp:anchor>` | `<wp:wrapSquare wrapText=…/>` |
  | `top-bottom` | `<wp:anchor>` | `<wp:wrapTopAndBottom/>` |
  | `behind` | `<wp:anchor behindDoc="1">` | `<wp:wrapNone/>` |
  | `front` | `<wp:anchor behindDoc="0">` | `<wp:wrapNone/>` |

  **Pipeline**

  - `onBeforeExport` walks the doc once, collects unique `image.src` values,
    fetches the bytes (data URLs decoded synchronously; http(s) via `fetch`),
    sniffs MIME from magic bytes (PNG / JPEG / GIF / WebP — fallback PNG),
    registers media + rel via `ctx.media.add` / `ctx.rels.addImage`, and
    stores `Map<src, ImageRecord>` under `ctx.shared["docx:images"]`.
  - Sync `image` node handler reads the precomputed record, picks
    `<wp:inline>` for `wrapMode: "inline"` and `<wp:anchor>` for the four
    float modes, with the right wrap element per mode.

  **Unit + position**

  - `pxToEmu(px)` = `round(px × 9525)` (1px @ 96 DPI = 9525 EMU).
  - Anchored position: `xAlign: left | center | right` → `<wp:align>`;
    literal `x` (px) → `<wp:posOffset>` in EMU relative to column; `yOffset`
    (px) → `<wp:posOffset>` relative to paragraph; `margin` (px) → all four
    `dist*` attrs.

  **Base contract tweak**

  - `DocxContext.editor: IBaseEditor` — lifecycle hooks like
    `onBeforeExport` need the doc to walk it for resource precomputation.
    Previously hooks only received `ctx` with no way back to the source.

  **Tests**

  - 8 integration tests across all 5 wrap modes, dedup by src,
    fetch-failure diagnostic, EMU conversion sanity. Mocked `fetch`
    serves a real 1×1 PNG so the bytes survive ZIP encode/decode.

  Other packages: lockstep version bump, no behavior change.

- 19b2879: `@scrivr/docx` — add DOCX import. The package now round-trips: import a
  `.docx` to a ProseMirror `Node` against the editor's schema, edit, and
  re-export with semantic fidelity for everything the playground exercises.

  Same architectural shape as the export side:

  **Contract types in core**

  - `@scrivr/core/exports/docx.ts` is the single source of truth for both
    directions. New: `DocxImports` (blocks/paragraphStyles/marks/inlines +
    lifecycle hooks), `DocxImportContext` (mirror of `DocxContext` with
    `resolveImage` / `resolveHyperlink` instead of `addImage` / `addHyperlink`),
    `DocxBlock` / `DocxInline` / `DocxMark` for the normalized intermediate
    model the parser emits.
  - `addImports()` extension lane added to `Extension`, collected by the
    manager alongside `addExports()`.

  **Two-stage pipeline**

  - **Stage 1 — parser** (`packages/docx/src/import/parser.ts`). OOXML-pure;
    no ProseMirror awareness. Emits `DocxImportModel { blocks: DocxBlock[] }`.
    Tolerates real Word output via allowlists for ignorable metadata
    (bookmarks, `proofErr`, comment markers, `smartTag`, permission ranges).
    Hyperlinks survive as `link` marks carrying relId/anchor/history;
    inline `<w:br w:type="page"/>` splits the surrounding paragraph;
    toggle rPr (b/i/u/strike/...) is normalized via `parseOnOff` so
    `<w:b w:val="false"/>` drops the mark instead of reaching Stage 2.
    Images deep-look for `<a:blip>` to tolerate non-standard drawingML
    nesting and preserve `relativeFrom` on positionH/positionV.
  - **List reconstruction** (between stages) — flat `numPr` paragraphs →
    nested `bulletList > listItem > paragraph` trees. Handles mixed nested
    lists (bullet outer, ordered inner): nested paragraphs with a different
    numId at `ilvl > 0` stay in the same run instead of splitting into
    separate top-level lists.
  - **Stage 2 — transform** (`transform.ts`). Dispatches via extension
    contributions plus per-call overrides. Three dispatch lanes mirror
    export: `blocks[block.type]`, `paragraphStyles[styleId]`,
    `marks[mark.kind]`, plus a new `inlines[inline.type]` lane for images.
    Handlers return real PM `Node` / `Mark` instances — no invented JSON
    shape to drift from ProseMirror.

  **Built-in import handlers (extension owns its import)**

  - Heading — paragraphStyles dispatch for `Heading1`/`Heading2`/`Heading3`.
  - Marks: bold, italic, underline, strikethrough, color, highlight
    (named `val` and hex shading), fontSize (half-points → px),
    fontFamily, link (relId → URL via `ctx.rels.resolveHyperlink`).
  - Image — five wrap modes (`inline` / `square` / `topAndBottom` /
    `behind` / `front`) with rel-resolved src.
  - HorizontalRule — Stage 1 detects Word's empty-paragraph-with-bottom-
    border convention and emits a `horizontalRule` block (matches the
    export side's output shape).
  - CodeBlock, PageBreak, Paragraph fallbacks live in the transform.

  **Media materialization** (`media.ts`)

  - `options.media`: `"data-url"` (default, base64 `data:` URL, works
    everywhere) / `"object-url"` (`URL.createObjectURL(blob)`, browser-only)
    / `"drop"` (emit no `src`, record a diagnostic — caller handles uploads).

  **Unsupported policy honored on both sides**

  - Parser emits `unsupported-docx-element` for any unmodeled body child
    (tables, sdt, etc.) with an explicit ignorable allowlist for harmless
    markup. Transform emits `unsupported-block` / `unsupported-mark` for
    unknown kinds. `importDocx` escalates to `DocxImportError` post-pipeline
    when `options.unsupported === "throw"`. Mirrors export-side semantics:
    any content loss is fatal under `throw`, silent (but diagnosed) under
    `drop`/`placeholder`.

  **`DocxImport` extension** (`packages/docx/src/import/DocxImport.ts`)

  - Toolbar button + file-picker flow. Opens a native `<input type="file">`,
    runs `importDocx`, replaces the editor's doc via
    `tr.replaceWith(0, doc.content.size, …)` — the same pattern the collab
    YBinding uses for hard resets. Browser-only; server callers continue
    to use `importDocx(editor, bytes)` directly.
  - Playground wires the icon (Lucide `FileUp`) into the toolbar `ICON_MAP`
    next to `⬇ DOCX` and registers the extension in both the collab and
    standalone extension lists.

  **Tests**

  - 33 import tests in `import.test.ts`. Round-trips through
    `exportDocxBytes`: build a known doc, serialize → bytes, parse bytes →
    PM `Node`, assert structure. Covers all built-in marks, headings, code
    blocks, page breaks, horizontal rule, bullet/ordered/nested/mixed-nested
    lists, all five image wrap modes (inline + four anchored), drop policy,
    extension dispatch.
  - 4 dedicated tests for code-review fixes: HR round-trip, mixed-nested
    list reconstruction, `unsupported-docx-element` diagnostic, `throw`
    policy escalation.
  - Full `@scrivr/docx` suite at 105 tests (export 72 + import 33).

  Other packages: lockstep version bump, no behavior change.

- 6f5fb5d: `@scrivr/docx` — replace the placeholder README with a proper one. Covers
  installation, in-editor usage via the `DocxImport` / `DocxExport` extensions,
  server-side usage via `importDocx` / `exportDocx` with `ServerEditor`, the
  shared option dials (`unsupported`, `fidelity`, `media`), and how custom
  extensions contribute their own DOCX handlers via `addImports` / `addExports`.

  No code changes — the placeholder text was a leftover from when the package
  was a type-only skeleton.

  Other packages: lockstep version bump, no behavior change.

- 8b3c741: `@scrivr/core` — new `editor.findExtension(name)` API and React
  ribbon sizes itself from `HeaderFooter.options.activeEditingGap`
  (no more parallel magic constant).

  **New public API:**

  ```ts
  const ext = editor.findExtension("headerFooter");
  if (ext) {
    // ext.options is typed as `object` (the manager has no compile-time
    // link from name → option shape); narrow with a runtime guard.
  }
  ```

  Returns the registered `Extension` instance or `null`. Mirrors the
  existing `ExtensionManager.findExtension(name)` it delegates to.
  Useful for cross-package consumers (React adapter hooks, future
  DevTools) that want to read another extension's configured options
  without coupling to its presence.

  **Ribbon now reads its size from the extension config:**

  `useHeaderFooterRibbon` (in `@scrivr/react`) now calls
  `editor.findExtension("headerFooter")` and reads
  `options.activeEditingGap`. The returned hook value exposes
  `ribbonHeight`, which `HeaderFooterRibbon.tsx` uses for both the
  ribbon's CSS `height` and its top offset. The previous hardcoded
  `28` is gone from the React side — the only remaining `28` is a
  defensive fallback for the case where the `HeaderFooter` extension
  is not registered at all (so `findExtension` returns null).

  Change `HeaderFooter.configure({ activeEditingGap: 40 })` and the
  extension's reserved gap _and_ the ribbon's height move together,
  no manual sync.

  Other packages: lockstep version bump, no behavior change.

- 8b3c741: `@scrivr/plugins` — `HeaderFooter` extension is now configurable with
  `activeEditingGap` so consumers can match the reserved gap to the
  height of their editing affordance.

  ```ts
  HeaderFooter.configure({ activeEditingGap: 28 }); // default — matches React HeaderFooterRibbon
  HeaderFooter.configure({ activeEditingGap: 40 }); // custom ribbon at a different height
  HeaderFooter.configure({ activeEditingGap: 0 }); // headless — no UI to reserve for
  ```

  The value acts as a floor on `slot.margin`: smaller user-set margins
  are clamped up at measure time so activating a surface does not push
  body content down. Margins larger than the gap are honored as-is.

  **Where the value lives.** Applied once at layout time inside
  `resolveChrome.measureSlot` and baked into `slot.reservedHeight` +
  `metrics.contentTop`. Every downstream consumer — canvas paint, PDF
  chrome render, anything reading `editor.layout` — reads the same
  baked value. The PDF render side is intentionally pure render and
  has no knob of its own; configuring this option at editor
  construction is the only place the gap is decided.

  **Dual-use editor limitation.** A single browser `Editor` used for
  both interactive editing and PDF export carries one value across
  both modes — the same layout drives both. Configure for the editing
  case (so the ribbon doesn't push content) and accept the same gap
  in the exported PDF. Consumers that need a ribbon-friendly editor
  _and_ a tight printed PDF should run PDF export against a separate
  `ServerEditor` constructed with `activeEditingGap: 0`, sharing the
  same doc JSON. A future per-export override would require a
  layout-pipeline primitive that accepts per-call chrome option
  overrides — deferred until a concrete consumer requests it.

  Default unchanged for React consumers — the `HeaderFooterRibbon`
  remains 28px tall, the extension defaults to 28, and the React
  hook offsets the ribbon by `-28`. All three locations are
  cross-referenced in code comments so a custom ribbon at a different
  height has clear instructions.

  Other packages: lockstep version bump, no behavior change.

- 8b3c741: `@scrivr/plugins` — header/footer ribbon no longer pushes body content
  down when activated.

  Previously the layout reserved the slot's configured `margin` (default
  12px) as the gap between header content and body. When the user clicked
  into the header, the React ribbon (28px tall) needed more room than the
  gap could fit — `policyWithLiveSurface` widened the margin to 28 on the
  fly, recomputing the band's reserved height and shifting body content
  down by ~16px. Clicking out reversed it. The shift was jarring.

  Fix — always reserve at least ribbon-height for the gap at measure time,
  inside `resolveChrome.measureSlot`. The body now sits at the same
  position whether or not a surface is active; the ribbon simply appears
  in space that was already there. The active-time clamp in
  `policyWithLiveSurface` is gone — the function only updates the live
  slot's content now.

  Behavior delta — a header/footer with `margin < 28` is silently floored
  to 28 at measure time (no API change; the stored value is preserved).
  Documents that already used `margin >= 28` are unaffected. The slight
  extra whitespace below tight headers is the cost of stable body
  positioning.

  Other packages: lockstep version bump, no behavior change.

- a749a3c: `@scrivr/core` — lift ingestion-time normalization from `ServerEditor`
  up to `BaseEditor` so the browser `Editor` benefits too.

  Previously `new Editor({ content: jsonFromAi })` only got URL safety
  on the initial doc; node-ID assignment and table repair waited for the
  first transaction to fire the `UniqueId` and `tableIntegrityPlugin`.
  A consumer who constructed an editor and immediately serialised
  without typing anything saw an un-normalized snapshot.

  Now `BaseEditor`'s constructor routes the initial doc through
  `normalizeDocument` — JSON, markdown, or extension-supplied default —
  so every initial state is URL-safe, table-repaired, and fully
  ID-stamped before the first transaction. `editor.lastNormalizeResult`
  exposes the same `{ doc, warnings, fingerprint, changed }` shape that
  `ServerEditor.setContent` already populated.

  `normalizeDocument(input, options)` also now accepts a parsed
  ProseMirror `Node` (not just JSON), so callers that already have a
  Node — including `BaseEditor`'s own constructor after the markdown
  parse — skip the wasted JSON round-trip.

  Behaviour delta — the browser `Editor` now also stamps node IDs and
  repairs tables on initial load. Symmetric with the server side; the
  in-editor plugins (`UniqueId`, `tableIntegrityPlugin`) still run on
  subsequent transactions and find no work to do because the constructor
  already handled it. Full suite green (core 1105/1105, plugins 328 + 5
  skipped, typecheck 13/13).

  Other packages: lockstep version bump, no behavior change.

- a749a3c: `@scrivr/core` — extract pure-function normalization primitives from the
  plugin layer in preparation for a public `normalizeDocument` entry point.

  **New core exports** (`@scrivr/core`):

  - `assignBlockIds(doc, { generate? })` — pure function that stamps a
    stable `nodeId` onto every block whose schema declares the attr but
    whose current value is `null`. Returns the same `Node` reference when
    nothing needed assignment (fast-path), so callers can detect a no-op
    cheaply. Mirrors the shape of `sanitizeDocUrls`.
  - `planBlockIdAssignments(doc, { generate? })` — sibling for
    transaction-grain callers. Returns one `{ pos, attrs }` entry per
    block that needs an ID, so the caller can emit one `setNodeMarkup`
    step per block instead of a whole-doc replace (better grain for
    history and collab).
  - `normalizeTablesDoc(doc, schema)` — doc-level wrapper around the
    existing `normalizeTables(state)` so table-integrity repair is
    reachable without materialising an `EditorState`. Same fast-path
    semantics.

  **`@scrivr/plugins`** — `UniqueId` plugin no longer carries its own
  walk. `appendTransaction` calls `planBlockIdAssignments(newState.doc)`
  and translates the result into `setNodeMarkup` steps. Single source of
  truth for the "which blocks need IDs?" predicate, so server-side and
  AI ingestion paths apply identical semantics to the live editor.

  Behaviour delta: none. All existing tests pass unchanged
  (core 1085/1085, plugins 328 + 5 skipped). Strictly a refactor that
  makes the upcoming `normalizeDocument` and `diffDocuments` public APIs
  possible without duplicating logic across packages.

  Other packages: lockstep version bump, no behavior change.

- a749a3c: `@scrivr/core` — ingestion-time `normalizeDocument` and `ServerEditor`
  wire-up.

  **New public API**

  ```ts
  import { normalizeDocument } from "@scrivr/core";

  const result = normalizeDocument(jsonFromAi, {
    schema: editor.manager.schema,
    // optional knobs
    mode: "repair", // or "strict" — strict throws on bounds breach
    assignIds: true, // default — stamp nodeId on blocks missing one
    generate: () => uuid(), // override the ID generator (deterministic in tests)
    maxNodes: 5000, // bounds check
    maxDepth: 50,
  });

  // result.doc         — normalized PM Node
  // result.warnings    — per-stage diagnostics (urls-sanitized, tables-normalized,
  //                       ids-assigned, bounds-exceeded)
  // result.fingerprint — FNV-1a 8-hex-char hash, deterministic per doc shape
  // result.changed     — true when normalization mutated the input
  ```

  Pipeline composes the existing primitives in one pass:

  1. `schema.nodeFromJSON(input)` — schema validation
  2. bounds check (maxNodes / maxDepth)
  3. `sanitizeDocUrls` — URL allow-list
  4. `normalizeTablesDoc` — table integrity (gridSpan / vMerge / grid)
  5. `assignBlockIds` — stable `nodeId` on every id-bearing block
  6. fingerprint over a deterministic stringification of `doc.toJSON()`

  Warnings are aggregate per stage (`{ code, message, count? }`) — enough
  for an AI server-side review pipeline to decide "did the model output
  something that needed repair?" without diffing two trees.

  **`ServerEditor.setContent` now routes through `normalizeDocument`**.
  The previous standalone `sanitizeDocUrls` call is gone; the same URL
  gate still runs as one stage of the new pipeline, plus table repair
  and ID assignment that previously only happened inside a live editor
  transaction. The result lives on `editor.lastNormalizeResult` for
  consumers that want to inspect warnings (e.g. reject AI output
  containing `urls-sanitized`).

  **Behaviour delta** — `ServerEditor.setContent` now also stamps node
  IDs and repairs tables on initial load instead of waiting for the
  first transaction. This brings server-side ingestion to parity with
  the live editor (where the `UniqueId` and table-integrity plugins
  were already doing it incrementally). Existing tests pass unchanged
  (core 1100/1100, plugins 328 + 5 skipped).

  Other packages: lockstep version bump, no behavior change.

- 65cafa2: `@scrivr/docx` — first public release. Dropped `private: true`, aligned
  version (`0.0.6` → `1.0.10`) with the lockstep version of the other
  `@scrivr/*` packages, and added the missing publish metadata (author,
  repository.directory, homepage, bugs, keywords, publishConfig). The
  package now joins the changeset `fixed` group so future releases keep
  all `@scrivr/*` packages in lockstep.

  Why now: the DOCX round-trip (export PR #92 + import PR #94) shipped two
  weeks ago and the demo has been exercising it. The package is ready to
  ship to npm; the previous independent `0.0.x` versioning track and
  `private: true` flag were holdovers from when only the skeleton existed.

  No code or behavior changes — purely packaging metadata.

  Other packages: lockstep version bump, no behavior change.

- Updated dependencies [ec550ce]
- Updated dependencies [ec550ce]
- Updated dependencies [19b2879]
- Updated dependencies [6f5fb5d]
- Updated dependencies [8b3c741]
- Updated dependencies [8b3c741]
- Updated dependencies [8b3c741]
- Updated dependencies [a749a3c]
- Updated dependencies [a749a3c]
- Updated dependencies [a749a3c]
- Updated dependencies [65cafa2]
- Updated dependencies [51c1d1f]
  - @scrivr/core@1.0.11

## 0.0.6

### Patch Changes

- 6d6f642: `@scrivr/core` — new `addPageConfig?(): PageConfig | undefined` extension
  lane. Extensions can now contribute page dimensions, margins, and the
  pageless toggle through the same first-class hook pattern used for nodes,
  marks, page chrome, etc. `ExtensionManager.buildPageConfig()` resolves the
  config by iterating the lane rather than looking extensions up by name —
  the manager no longer hardcodes `"pagination"` or `"starterKit"`.

  Behavior changes:

  - `Pagination` extension now implements `addPageConfig()` returning its
    configured `PageConfig` options.
  - `StarterKit` implements `addPageConfig()` reading its nested
    `pagination` option. Returns `undefined` when unset (so a downstream
    `Pagination.configure(...)` wins cleanly), the partial-merged config
    when set to an object, and `undefined` again when set to `false`.
  - Multi-provider warning fires when two extensions contribute non-undefined
    page configs — same pattern as the initial-doc lane.
  - The two `Extension.options` runtime predicates (`isPageConfig`,
    `readStarterKitPagination`) that existed to dodge `as` casts on
    `unknown` option lookups are gone — the typed lane removes the need.

  The `[StarterKit, Pagination.configure(usLetter)]` user pattern continues
  to resolve to `usLetter`. Bare `[StarterKit]` continues to render at
  `defaultPageConfig` via Editor's existing fallback chain.

  Future: when page config moves to `doc.attrs.pageSettings` (see
  `project_page_config_to_docattrs` memory — collaborative page settings,
  ruler-driven margin drags), the same `addPageConfig` lane stays in place
  and the extension just sources from `state.doc.attrs.pageSettings`
  instead of `this.options`. No manager-side rewiring needed.

  Other packages: lockstep version bump, no behavior change.

- 1db8abc: `@scrivr/core` — extension authors now get a `console.warn` whenever one
  extension silently overrides another's node, mark, keymap binding, command,
  input handler, markdown parser token, or markdown serializer rule (per kind
  or lane). Each warning names the previous and new contributor so accidental
  typos that shadow built-ins surface immediately. Doc attrs and surface owners
  remain `throw` on collision; the new warn lane covers everything else where
  override is sometimes intentional but always worth knowing about.

  Additionally:

  - New baseline warning when an extension overrides ProseMirror's required
    `doc` or `text` node — points at `addDocAttrs()` as the supported path for
    doc-level data.
  - New warning when more than one extension provides an initial document
    (e.g. `Collaboration` + `DefaultContent` stacking).
  - `buildSchemaFromPhase1` no longer mutates its input contributions object.
  - `Phase1SchemaContributions` now types `nodes` / `marks` as `NodeSpec` /
    `MarkSpec` instead of `object`, removing two `as` casts from the schema
    merge step.
  - `buildPageConfig` reads `Extension.options` via runtime predicates
    (`isPageConfig`, `readStarterKitPagination`) instead of unchecked `as`
    casts.

  Internal refactor: nodes, marks, keymap, commands, input handlers, markdown
  parser tokens, markdown serializer rules, and doc-attrs all share one
  `mergeContributions<T>()` helper with a `"warn"` / `"throw"` policy.

  Other packages: lockstep version bump, no behavior change.

- 2f74d3e: `@scrivr/core` — new first-class `HardBreak` extension, individually
  importable as `import { HardBreak } from "@scrivr/core"` and matching
  the shape of the other built-ins (Bold, Heading, HorizontalRule, etc.).

  Previously the `hardBreak` node lived bundled inside the `Document`
  extension and the `Shift-Enter` keymap was hardcoded in `BaseEditing`.
  That made it impossible to opt out cleanly, to swap in a different
  implementation, or to disable just the shortcut while keeping the node.

  The new extension owns:

  - The `hardBreak` inline-leaf node spec
  - The `Shift-Enter` keymap (gated by `shortcut: boolean` option)
  - The `insertHardBreak()` command (`editor.commands.insertHardBreak()`)
  - The markdown serializer rule (with trailing-break suppression — a
    trailing hardBreak no longer leaks a stray `\\\n` into the output)
  - The markdown PARSER token mapping (new — closes a long-standing
    asymmetry where the old `Document` extension serialized hard breaks
    but couldn't parse them back in, throwing `Token type "hardbreak"
not supported` on any markdown input containing one)

  `Document` shrinks to contributing only the baseline `text` markdown
  serializer rule (kept here because every doc has text nodes and
  prosemirror-markdown needs an explicit serializer for them).
  `BaseEditing` drops its Shift-Enter binding entirely — Backspace,
  Delete, Mod-a, and arrow navigation are still owned there.

  `StarterKit` gains a new option:

  ```ts
  StarterKit.configure({
    hardBreak: false, // drop entirely
  });

  StarterKit.configure({
    hardBreak: { shortcut: false }, // keep node + command, drop Shift-Enter
  });
  ```

  Default behavior is unchanged: `StarterKit` includes `HardBreak` with
  the Shift-Enter shortcut bound, so existing apps see no observable
  difference except that `ServerEditor({ content: "alpha\\\nbeta" })`
  now parses correctly instead of throwing.

  19 tests cover the extension surface (node shape, keymap presence /
  opt-out, command behaviour against a real `ServerEditor`, markdown
  parse + serialize + full roundtrip including the trailing-break edge
  case), regression guards proving `Document` and `BaseEditing` no
  longer own this responsibility, and `StarterKit` integration through
  all three option shapes (`undefined`, `false`, `{ shortcut: false }`).

  Other packages: lockstep version bump, no behavior change.

- 6c1945a: Collaborative headers & footers (Phase 5 of the header-footer plan).

  **`@scrivr/core`** — `ExtensionManager` exposes `getDocAttrNames()` and
  `getDocAttrOwners()`, sourced from the doc-attr ownership map already built
  during schema construction. `IBaseEditor` grows `getDocAttrNames(): string[]`
  so headless consumers (collab bindings, future audit tooling) can read the
  declared-attr whitelist without touching schema internals. `BaseEditor`
  implements the delegation, inherited by `Editor` and `ServerEditor`. Pure
  additive surface.

  **`@scrivr/plugins`** — `YBinding` now syncs `doc.attrs` across peers via a
  sibling `Y.Map("prose_doc_attrs")` keyed by attr name with `DocAttrEnvelope`
  values (`{ localSeq, value }`). Header/footer policy edits propagate between
  peers, late joiners adopt the room's current policy on `markSynced`, and
  the `Y.UndoManager` scope grows to cover the attrs map so Cmd-Z reverses a
  policy change like any other document edit. The whitelist comes from
  `editor.getDocAttrNames()` so only declared attrs cross the wire; undeclared
  keys and malformed envelopes are silently dropped. Yjs remains authoritative
  for conflict resolution — `localSeq` is a local dedup hint, not a tiebreaker.

  `HeaderFooterRibbon` placement fix (it now sits above the header band rather
  than overlapping the painted header content).

  **`@scrivr/react`** — `HeaderFooterRibbon` + `useHeaderFooterRibbon` updated
  to match the new ribbon-placement contract.

  **`@scrivr/export`, `@scrivr/export-pdf`, `@scrivr/export-docx`,
  `@scrivr/export-markdown`** — lockstep version bump only; no behavior change.

- 4c2dd5e: `@scrivr/core` — regression coverage for `PasteTransformer` and the
  markdown ingestion path against real-world hostile inputs. No
  functional changes; documents what the existing pipeline already does.

  `PasteTransformer.test.ts` gains five new describe-blocks asserting
  the cleaning contract on every output doc:

  - **drops script and style elements** — `<script>`, `<style>`, nested
    scripts inside divs
  - **strips event-handler attributes** — `onerror`, `onclick`,
    `onmouseover`, body-level `onload`
  - **rejects forbidden URL schemes** — `javascript:`, `data:text/html`,
    `vbscript:`, `file:`, plus obfuscation variants (mixed case,
    whitespace prefix, HTML-entity-encoded scheme)
  - **ignores embedded objects** — `iframe`, `object`, `embed`, `form`
  - **SVG content model** — `<svg><script>`, `<svg onload>`

  Plus a deeply-nested-wrappers case proving the cleaning walks through
  any depth.

  `parseMarkdown.test.ts` (new file) covers the markdown ingestion path
  the constructor uses when given `content: "..."`. With
  `MarkdownIt({ html: false })` raw HTML in markdown source survives as
  literal text — safe in every render target the framework supports
  (canvas paints glyphs, exports use textContent / structured writers,
  DOM renderers are required to use textContent per the security model).
  The structural and URL invariants are asserted; the literal-text
  behavior is documented as intentional.

  Each describe-block reads as a normal regression test for how the
  component behaves under hostile input — not as a labelled "security
  suite" that would advertise the threat surface or frame defenses as
  separable from the features they protect.

  Comment cleanup along the way: removed temporal references from
  `Document.ts` ("hardBreak lives in its own HardBreak extension as of
  the extraction PR") and `HardBreak.ts` ("Previously bundled inside
  the Document extension. Extracted so it...") that coupled the code
  to specific PR work.

  Other packages: lockstep version bump, no behavior change.

- fcd166b: **Popover UX — close on editor focus loss.** Floating menus (bubble menu,
  slash menu, link popover, image menu, floating block menu, AI suggestion
  popover, track-changes popover) now hide when the editor loses DOM focus
  to something that isn't the popover itself. Previously they stayed
  anchored to invisible selection state when the user clicked into a sidebar,
  the browser address bar, or another window — the classic "feels weird"
  artifact of subscribing only to PM state changes (DOM blur leaves the
  selection untouched).

  New `subscribeEditorFocusOutside(editor, onHide, { getPopoverElement? })`
  helper in `@scrivr/core/menus` is the shared signal source. Defers the
  hide one microtask so a click _into_ a popover (which blurs the editor
  then focuses an input inside) settles before the check runs.

  Popover detection, in priority:

  1. `getPopoverElement()` — accessor returning the popover's root DOM node.
     Each `createXMenu` controller now accepts this, and each React hook
     threads its `rootRef.current` through. Bulletproof for internal
     popovers — no marker attribute required.
  2. `[data-scrivr-popover="<menu-name>"]` ancestor — fallback for vanilla
     / third-party popovers that don't have a ref accessor. The seven React
     components ship with a named marker (`bubble-menu`, `link-popover`,
     etc.) as defense in depth and to keep DOM inspection self-documenting.

  Header/footer surfaces are intentionally excluded — they're a persistent
  editing mode, not a popover.

  **`cx` utility upgrade.** The class-name combiner in `@scrivr/react/utils`
  now accepts strings, numbers, falsy values, nested arrays, and conditional
  dictionaries in addition to the previous string-only positional form. The
  eight existing callers continue to work unchanged (they pass positional
  strings, which the new shape handles identically). New shapes available:

  ```ts
  cx("btn", isActive && "btn-active"); // already worked
  cx("btn", { "btn-active": isActive }); // NEW — conditional dict
  cx(["base", flagged && "flag"]); // NEW — nested arrays
  cx("col-", count); // NEW — numbers
  ```

  Return contract preserved: `string | undefined`. Tailwind utility-class
  conflicts are NOT auto-merged (pull in `tailwind-merge` for that).

  **React test runner bootstrap.** `@scrivr/react`'s `"test": "true"`
  placeholder is replaced with real vitest + a node-environment config.
  First occupant: 15 tests for the upgraded `cx` covering positional
  strings, conditional dicts, nested arrays, numbers, dedup order, and the
  documented Tailwind non-merge limitation. Removes one item from the
  stable-1.x roadmap's "React adapter has no regression tests" gap.

  Other packages: lockstep version bump, no behavior change.

- b61e408: `@scrivr/core` — central URL allow-list at the document boundary. PR 2
  of the pre-1.x security baseline (`SECURITY.md` shipped in PR 1).

  Adds `safeUrl(value)` in `@scrivr/core/model`. Returns the trimmed input
  when the value is safe to store, `null` when it isn't. Allow-list:
  `http`, `https`, `mailto`, `tel`, fragment-only (`#anchor`), and
  relative URLs. Everything else — `javascript:`, `data:`, `vbscript:`,
  `file:`, unknown custom schemes — returns `null`. Strips ASCII control
  characters before validating so the classic `"java\x00script:"`
  obfuscation can't slip past a naive prefix check. Trims whitespace.
  Case-insensitive scheme match per RFC 3986. Defensive against non-string
  input so callers reading from `unknown`-typed sources (collab apply,
  parseDOM attribute getters) can pass values through without their own
  type guard.

  Wired at every URL ingestion point in `Link` and `Image`:

  - `Link` parseDOM — `<a href="javascript:...">click</a>` → mark dropped,
    text preserved (returning `false` from `getAttrs` is the canonical
    "drop this match" signal)
  - `Link.setLink` command — prompt validated; unsafe input is a no-op
  - `Link.setLinkHref` command — returns `false` on unsafe href; safe
    href stored normalised
  - `Image` parseDOM — `<img src="javascript:...">` → node dropped entirely
  - `Image.insertImage` command — prompt validated; unsafe input is a no-op

  **JSON-load gate** — addresses the codex-flagged gap that parseDOM-only
  validation leaves: `schema.nodeFromJSON` bypasses parseDOM entirely, so
  a saved doc on disk with `link.attrs.href = "javascript:..."` would
  round-trip unchanged.

  New `sanitizeDocUrls(doc, schema)` walks a constructed PM doc and
  applies the same allow-list to URL-bearing attrs. Image with unsafe
  `src` → node dropped. Link mark with unsafe `href` → mark stripped,
  text and co-occurring marks preserved. Cheap idempotent fast-path: a
  clean doc returns the same `Node` reference, no allocation.

  Wired at both raw-JSON ingestion sites:

  - `BaseEditor` constructor — covers `content: json`, `content: "markdown"`,
    and extension-supplied `addInitialDoc()` (like `DefaultContent`) in
    one place
  - `ServerEditor.setContent(json)` — runtime doc replacement

  **Out of scope** (deliberate, separate PRs):

  - **Collab Y→PM apply** — `yXmlFragmentToProseMirrorRootNode` bypasses
    both parseDOM and constructor init. Adversarial-peer trust is already
    documented in `SECURITY.md` as an app-layer concern (auth, validation,
    potentially E2EE). A post-apply walker is a separate design.
  - **Hand-rolled raw-node transactions** (`editor.applyTransaction(tr.replaceWith(0, 5, rawNode))`)
    — covered if the node came through commands, not if hand-rolled. A
    doc-wide transaction filter would catch it but trades for per-keystroke
    overhead. Defer.

  **Bonus cleanup** (the user's no-`as` rule extends here):

  - New `getNodeAttrs<K>` / `getMarkAttrs<K>` typed accessors in
    `@scrivr/core/model`. Look up `NodeAttributes[K]` / `MarkAttributes[K]`
    augmentations to give extension authors typed `attrs.src` /
    `attrs.href` access. Single `as` lives inside the helper behind a
    runtime kind check — no scattered casts at usage sites.
  - Augmented `NodeAttributes.image` (existing `MarkAttributes.link` was
    already in place from a prior PR).
  - Removed 4 scattered `as` casts from `Link.ts` and `Image.ts`. Zero
    type assertions remain in either file.

  **Tests** (43 new):

  - 25 fuzz tests on `safeUrl` covering all the agreed obfuscation
    scenarios from the security baseline plan
  - 11 tests on `sanitizeDocUrls` covering helper behaviour + ServerEditor
    constructor + setContent integration
  - 7 integration tests on `Link` covering parseDOM rejection and command
    rejection

  All 12 monorepo typecheck tasks pass. All 11 test tasks pass.

  Other packages: lockstep version bump, no behavior change.

- 6d49fe0: **Repo:** add `SECURITY.md` — first PR of the pre-1.x security baseline.

  Establishes the disclosure surface and the trust model so external
  researchers know how to report vulnerabilities responsibly and app
  authors know where the framework's defended surface ends.

  Disclosure channel is GitHub Security Advisories (private, encrypted,
  CVE-integrated). Coordinated-disclosure window is 90 days. Acknowledge
  within 3 business days, substantive response within 10.

  Explicitly out-of-scope (so reporters don't burn time and app authors
  know to handle these at their layer):

  - **Extensions are trusted code** — same model as TipTap / ProseMirror /
    CodeMirror / Slate. No sandbox. Audit extensions like dependencies.
  - **Collaborative peers can mutate the document** — Scrivr enforces
    schema invariants but not authorisation. Adversarial-peer scenarios
    need app-level permissioning, validation, and potentially E2EE.
  - **AI prompt injection** — defended at the prompt layer + accept-time
    UX, not the suggestion overlay primitive.
  - **DoS via pathological input** — documented as recommended app-level
    limits today; hard guards in core planned for 1.1+.

  States the load-bearing invariant: **storage-safe forever**. Anything
  that enters the ProseMirror JSON document must be safe to render
  through any future surface (DOM a11y mirror, PDF, DOCX, exports).
  Validation happens at ingestion time, not render time.

  No code changes — lockstep patch bump only so the policy is visible
  in every published package's release notes.

  **Action required by the repo owner before this policy is real:** enable
  "Private vulnerability reporting" in repo Settings → Security → Code
  security and analysis. Without it the disclosure URL 404s for non-
  maintainers.

- Updated dependencies [6d6f642]
- Updated dependencies [1db8abc]
- Updated dependencies [2f74d3e]
- Updated dependencies [6c1945a]
- Updated dependencies [4c2dd5e]
- Updated dependencies [fcd166b]
- Updated dependencies [b61e408]
- Updated dependencies [6d49fe0]
  - @scrivr/core@1.0.10

## 0.0.5

### Patch Changes

- dd3f3d6: `@scrivr/plugins`: drop the hand-rolled `TestAiEditor` `IEditor` stub. The
  ai-suggestion test suites now drive a real headless `ServerEditor` (wrapped
  in a thin `AiTestEditor` subclass that adds test sugar — `showSuggestion`,
  `apply`, `reject`, `text`, `suggestionState`). The 110-LOC blob of
  `as never` view stubs (canvas, layout, surfaces, full SelectionController)
  is gone — the test driver is now a real editor with the actual minimal
  schema + `aiSuggestionPlugin` + `trackChangesPlugin` + `history()` wired
  through `ServerEditor`'s extension lifecycle.

  To make this possible, three public function signatures widen from
  `IEditor` to `IBaseEditor`:

  - `showAiSuggestion(editor: IBaseEditor, …)`
  - `applyAiSuggestion(editor: IBaseEditor, …)`
  - `rejectAiSuggestion(editor: IBaseEditor, …)`

  These functions only use `getState` + `applyTransaction` — both on
  `IBaseEditor`. Backwards-compatible: any existing caller passing a
  browser `Editor` still satisfies the broader requirement.

  `subscribeToAiSuggestions` also widens to `IBaseEditor`. Its internal
  `activate(blockId)` callback used to call `editor.selection.moveCursorTo`
  unconditionally; it now uses a type-predicate guard (`hasSelectionApi`)
  so view-bound editors keep moving the cursor while headless editors
  skip the no-op-on-headless cursor move. No `as` cast — the guard returns
  a TypeScript type predicate (`editor is IBaseEditor & Pick<IEditor,
"selection">`).

  Other packages: no runtime / API change — bumps included for lockstep
  versioning.

- 0a17632: `@scrivr/core`: drop the static `model/schema.ts` `export const schema`
  and the `model/state.ts` (`createEditorState`, `createEditorStateFromJSON`)
  factories. Both were drifting out of sync with what the production editor
  actually builds — `Editor` and `ServerEditor` construct their schema
  dynamically from extensions (`StarterKit` adds `paragraph.dataTracked`,
  `paragraph.nodeId`, etc.; `TrackChanges` from `@scrivr/plugins` adds
  `trackedInsert` / `trackedDelete` marks) and the static schema couldn't
  keep up.

  **Stability note (beta `0.x`):** the removed surfaces below were technically
  reachable through `@scrivr/core` but were never part of the documented public
  API — `Editor` / `ServerEditor` / `StarterKit` (the documented entry points)
  do not consume them, and they had drifted out of sync with the runtime
  schema. They are removed as internal cleanup. Per the project's beta
  versioning rule (`feedback_changeset_patch_only`) the lockstep bump stays
  `patch`; any external consumer reaching past the documented surface should
  migrate as described below.

  Migration story:

  - The `schema` runtime value, `NodeTypeName` type, `MarkTypeName` type,
    `createEditorState`, `createEditorStateFromJSON`, and the
    `model/schema.ts` + `model/state.ts` modules themselves are removed from
    the package. The `EditorState` type re-export now comes from
    `prosemirror-state` directly. Build a live schema with
    `getSchema([StarterKit, …])` (or `buildStarterKitContext()` in tests) —
    that's what the production editor uses.
  - `model/commands.ts` had ~110 LOC of schema-using helpers (`toggleBold`,
    `toggleItalic`, `toggleUnderline`, `toggleStrikethrough`, `setFontSize`,
    `setFontFamily`, `setColor`, `applyUndo`, `applyRedo`, `splitBlock`,
    `applyToggleMark`) that were never imported in production — each
    extension already exposes its equivalent via `addCommands()` (Bold,
    Italic, FontSize, History, …). All removed. The surviving exports
    (`insertText`, `deleteSelection`, `deleteBackward`, `deleteForward`)
    power `InputBridge` / `PasteTransformer` / `BaseEditing` and don't
    reference any schema.
  - Test consumers of the static schema now build it locally per file via
    `buildStarterKitContext()` (existing helper) or `getSchema([StarterKit])`
    — same StarterKit-built source the runtime editor uses. The describes
    that need `schema` directly (e.g. for `align`-specific attrs) declare
    their own `const { schema } = buildStarterKitContext()` at the describe
    top.

  `@scrivr/plugins`:

  - ai-suggestion test fixture: the `AiTestEditor` (introduced in PR #81)
    now extends `ServerEditor` and wires the production `StarterKit` +
    `TrackChanges` extensions through it. The custom `nodeSpecs` /
    `markSpecs` / `TestSchemaExtension` blob is gone — the test driver runs
    on the same schema and plugins that production runs on.
  - `TrackChanges.onEditorReady` widens `editor: IEditor` to
    `editor: IBaseEditor` and uses a `hasOverlayApi(editor)` type-predicate
    guard to no-op overlay registration on headless editors. Browser-path
    behaviour is unchanged. Mirrors the existing guards in
    `HeaderFooterController` / `HeaderFooter` and the
    `subscribeToAiSuggestions` guard from PR #81. One of the seven
    extensions documented in `todo_extension_oneditorready_guard.md`.

  No runtime behaviour change in the browser path. Test surfaces reduced
  by 25 tests (8 from `state.test.ts`, 5 from dropped commands describes,
  12 from `schema.test.ts`) — coverage of the removed code is replaced by
  the production extensions' own tests.

  Other packages: no runtime / API change — bumps included for lockstep
  versioning.

- ebd52d1: `@scrivr/core` + `@scrivr/plugins`: drop the `_`-prefix on the remaining
  underscore-tagged members — interface methods, cross-class internal API,
  and layout shape fields. Completes the underscore sweep started in the
  previous release.

  **Breaking** (BUT pre-1.0 / beta, no external consumers known beyond the
  in-repo plugins which migrate in this same PR):

  - `IBaseEditor._applyTransaction(tr)` → `IBaseEditor.applyTransaction(tr)`.
    The previous public `applyTransaction(tr)` wrapper that just delegated to
    `_applyTransaction` is removed — there's now a single canonical method.
    Plugins (`YBinding`, `AiToolkit`, `ai-suggestion`, `header-footer`) and
    app code that called `editor._applyTransaction(tr)` should call
    `editor.applyTransaction(tr)` — same behaviour, no underscore.
  - `SurfaceRegistry._setOwnerMediator()` → `setOwnerMediator()`. Still
    `@internal` — only called by `Editor` during construction.
  - `EditorSurface._committing` → `committing`. Still `@internal` — set by
    `SurfaceRegistry` during commit lifecycle, checked by
    `EditorSurface.dispatch()` to refuse re-entrant dispatch.
  - `DocumentLayout._chromePayloads` → `chromePayloads`. Layout shape field
    read by `TileManager` + written by `PageLayout` + `runMiniPipeline`.
  - Module-scope helpers in `PageLayout` (`_runPipelineDepth`,
    `_runPipelineBody`) and `OverlayRenderer` (`_activeDpr`,
    `_setActiveDpr`) lose their underscores.
  - `Paragraph` extension's module-local `_split` const renamed to
    `splitParagraph`.

  Unused-parameter underscores (`_pageNumber`, `_charMap`, `_event`, …) stay
  — that's TS/ESLint convention, not the same pattern.

  No runtime behaviour change. 1,260 / 1,260 tests pass.

- d85d4af: `@scrivr/core`: drop the `_`-prefix convention on internal class members and
  rely on TypeScript visibility modifiers (`private` / `protected`) instead.
  Touches `BaseEditor`, `Editor`, `ServerEditor`, `EditorSurface`,
  `SurfaceRegistry`, `SelectionController`, `LayoutCoordinator`, `TileManager`,
  `PointerController`, `InputBridge`, `CursorManager`.

  Notable renames:

  - `BaseEditor._state` → `BaseEditor.editorState` (root editor state, distinct
    from `EditorSurface`'s `editorState` and any layout `Flow*` concept).
  - `BaseEditor._readOnly` → `readOnlyValue` (backing field for `get readOnly()`).
  - `BaseEditor._applyState` / `_notifyListeners` / `_fireEditorReady` /
    `_dispatchToActive` / `_getActiveState` / `_buildCommands` → underscore
    dropped.
  - `Editor._onChange` → `onChangeHandler`, `_onFocusChange` →
    `onFocusChangeHandler` (avoid shadowing the constructor option names).
  - `Editor._viewDispatch` → `viewDispatch`, plus theme / debug / raf private
    fields stripped of their underscore.
  - `LayoutCoordinator._cursorPage` → `cursorPageValue` (backing for the
    public `get cursorPage()`); everything else dropped the underscore.
  - `EditorSurface._state` / `_isDirty` / `_listeners` → `editorState` / `dirty` /
    `listeners`.
  - `SurfaceRegistry._activeId` / `_activeSurface` → `activeIdValue` /
    `activeSurfaceValue` (backing fields for the public getters); other
    private fields dropped the underscore.

  Comment updates: "flow document" / "flow state" wording that was contrasting
  the root editor against active surfaces is rewritten to "root editor
  document" / "root editor state" so the same vocabulary doesn't blur with
  layout's `Flow*` types (`FlowBlock`, `FlowConfig`).

  **Public API is unchanged.** Interface members (`IBaseEditor._applyTransaction`,
  `IBaseEditor._setOwnerMediator`-style cross-class API), layout shape fields
  (`_chromePayloads`), and `EditorSurface._committing` remain `_`-prefixed —
  those are intentional "internal-ish public" signals and migrate separately.

  Other packages: no runtime / API change — bumps included for lockstep
  versioning.

- d508775: **⚠️ Visual behaviour change for `@scrivr/react` menu components — see migration note below.**

  Make the React menu and popover components headless-friendly by removing baked-in visual inline styles, adding stable `data-*` state and part selectors, exposing per-part class name props for consumer styling, shipping an optional `@scrivr/react/styles.css` reference stylesheet that can be overridden by app CSS or Tailwind utilities, and exporting hooks for consumers who want to render fully custom UI.

  **Migration:** the previous inline styles are gone. Consumers who relied on the default look must either (a) import `@scrivr/react/styles.css`, or (b) provide their own styles via the new per-part class name props / `data-*` selectors. This bump is **patch** in keeping with Scrivr's beta-only patch policy (`feedback_changeset_patch_only`); semver discipline begins at the future deliberate 1.0 → 2.0 graduation, not here.

- 0a17632: `@scrivr/core`: split the extension lifecycle into engine + view phases.

  **Before:** every extension declared `onEditorReady(editor: IBaseEditor)`
  and either cast to `IEditor` (the documented workaround) or accepted
  `IEditor` directly (silently overriding the parameter type). The result
  was that view-only extensions (Image / TrackChanges / CollaborationCursor
  / AiCaret / GhostText / AiSuggestion / HeaderFooter / PdfExport / etc.)
  would crash at runtime when loaded into `ServerEditor` because the hook
  fired headlessly and reached for `addOverlayRenderHandler` / `redraw` /
  `selection` / `surfaces`.

  **Now:** two hooks, two phases:

  ```ts
  Extension.create({
    onEditorReady?(editor: IBaseEditor) {
      /* engine setup */
    },
    onViewReady?(editor: IEditor) {
      /* view setup  */
    },
  });
  ```

  - `onEditorReady` fires in **both** `Editor` and `ServerEditor` after the
    document engine is ready. Parameter is `IBaseEditor`; only engine APIs
    are reachable. Use for: collaboration document binding, plugin-state
    bootstrap, subscribers, export/markdown setup.
  - `onViewReady` fires **only in browser `Editor`**, after layout / input
    bridge / surfaces / overlay layer are initialised. Parameter is
    `IEditor`; full view surface is reachable. Use for: overlay handlers,
    redraw triggers, selection wiring, layout reads, `setReady`.

  Cleanup fns from both hooks collect in one `runtimeCleanup` array on
  `BaseEditor` and fire on `destroy()` in registration order.

  **Extensions migrated to `onViewReady`** (paint/view-only work that was
  crashing on `ServerEditor` and now simply doesn't run there):

  - `@scrivr/core`: `Image` (redraw on image load), `StarterKit`
    (aggregates Image's view-only setup).
  - `@scrivr/plugins`: `TrackChanges`, `CollaborationCursor`,
    `Collaboration`, `AiCaret`, `GhostText`, `AiSuggestion`, `AiToolkit`,
    `HeaderFooter`.
  - `@scrivr/export-pdf`: `PdfExport`.

  `HeaderFooter`'s and `TrackChanges`'s ad-hoc `isViewEditor` runtime
  guards are removed — the engine guarantees the hook only fires when the
  view is real.

  **Closes** `todo_extension_oneditorready_guard.md` (was tracking the 7
  extensions that crashed on `ServerEditor`; all migrated).

  **New tests:** `packages/core/src/extensions/lifecycle.test.ts` — 6 tests
  prove the contract:

  1. `ServerEditor` calls `onEditorReady` but not `onViewReady`.
  2. `Editor` calls both, in order (`editor` then `view`).
  3. Cleanup from both hooks runs on `destroy()`.
  4. `ServerEditor` only runs `onEditorReady` cleanup on `destroy()`.
  5. A view-only extension that uses `addOverlayRenderHandler` inside
     `onViewReady` loads in `ServerEditor` without crash (no guard, no
     cast — the hook never fires there).
  6. A mixed extension runs engine setup on server and view setup only in
     browser.

  **Plugin authors going forward:** if your extension touches `editor.layout`,
  `editor.addOverlayRenderHandler`, `editor.redraw`, `editor.selection`,
  `editor.surfaces`, or `editor.setReady`, put that work in `onViewReady`.
  If it only touches `editor.getState`, `editor.applyTransaction`,
  `editor.subscribe`, etc., keep it in `onEditorReady`.

  `onEditorReady` and `onViewReady` are both optional — declare neither,
  either, or both per your extension's needs.

  No runtime behaviour change in the browser path. Headless `ServerEditor`
  now loads every built-in / plugin extension without runtime errors;
  view-only setup is silently skipped.

  1,241 / 1,241 tests pass (1,235 baseline + 6 new lifecycle tests).

- 020e362: `@scrivr/core`:

  - New public type `TextMeasurerLike` — the four-method contract
    (`measureWidth`, `getFontMetrics`, `measureRun`, `invalidate`) that the
    layout pipeline consumes. Re-exported from the package entry. Layout +
    rendering signatures (`BlockLayoutOptions.measurer`,
    `BlockRenderContext.measurer`, `LayoutCoordinatorOptions.measurer`,
    `PageChromeMeasureInput.measurer`, `RenderPageOptions.measurer`,
    `MiniPipelineOptions.measurer`, `InlineStrategy.measure`, etc.) widen
    from concrete `TextMeasurer` to `TextMeasurerLike`. Backwards
    compatible — real `TextMeasurer` still satisfies the interface.
  - New `EditorOptions.textMeasurer?: TextMeasurerLike` injection point.
    Production code leaves it undefined and gets the existing DOM-canvas
    default; tests and custom runtimes pass a real `@napi-rs/canvas` or
    other backend.
  - New `TextMeasurerOptions.context?: TextMeasureContext` injection point
    on the `TextMeasurer` constructor. Same purpose: tests inject a real
    Skia ctx so widths and metrics come from a real backend.

  `@scrivr/plugins`:

  - `YBinding`'s constructor `editor` parameter widens from `IEditor` to
    `IBaseEditor`. The binding only uses base-editor APIs (`getState`,
    `subscribe`, `_applyTransaction`), so the narrower interface covers
    both browser `Editor` and headless `ServerEditor`. Backwards
    compatible — existing `IEditor` callers still satisfy `IBaseEditor`.
  - `tokenStrategies` (header-footer) re-types its measurer parameters as
    `TextMeasurerLike` instead of concrete `TextMeasurer`. No runtime
    change.

  Other packages: no runtime / API change — bumps included for lockstep
  versioning.

- Updated dependencies [dd3f3d6]
- Updated dependencies [0a17632]
- Updated dependencies [ebd52d1]
- Updated dependencies [d85d4af]
- Updated dependencies [d508775]
- Updated dependencies [972dab2]
- Updated dependencies [0a17632]
- Updated dependencies [020e362]
- Updated dependencies [0dec8aa]
  - @scrivr/core@1.0.9

## 0.0.4

### Patch Changes

- Updated dependencies [bc1652d]
- Updated dependencies [40be274]
- Updated dependencies [dad19d0]
- Updated dependencies [bf33e14]
  - @scrivr/core@1.0.8

## 0.0.3

### Patch Changes

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

## 0.0.2

### Patch Changes

- Updated dependencies [39e008c]
- Updated dependencies [36a7776]
- Updated dependencies [88016a6]
- Updated dependencies [ddd1448]
  - @scrivr/core@1.0.6

## 0.0.1

### Patch Changes

- 0f6d00a: Fix cross-page selection highlight and cursor fallback for float-only pages
- Updated dependencies [bf50408]
- Updated dependencies [f6950b5]
- Updated dependencies [0f6d00a]
- Updated dependencies [81970d5]
- Updated dependencies [ff7390f]
- Updated dependencies [a198d0f]
- Updated dependencies [8ccf3ea]
  - @scrivr/core@1.0.5
