# @scrivr/core

## 1.0.3

### Patch Changes

- 914daad: ### Editing UX improvements

  - Double-click to select word, triple-click to select paragraph, with word-granularity drag extension
  - Platform-specific keyboard shortcuts: Option/Ctrl+Arrow word navigation, Cmd/Home/End line start/end, Cmd+Up/Down doc start/end, Option/Ctrl+Backspace/Delete word delete — all with Shift variants for extending selection

  ### Crisp rendering

  - Pixel-snap all overlay rectangles (selection, tracked changes) to the device pixel grid — eliminates antialiasing seams between adjacent rects
  - DPR change detection via matchMedia + Visual Viewport API — canvases repaint at correct resolution on browser zoom, display switch, and pinch-to-zoom

  ### Architecture

  - **New:** `SelectionController` — extracted from Editor, owns all cursor movement, word/line navigation, and selection logic. Accessed via `editor.selection`
  - **New:** `PointerController` — extracted from TileManager, owns all mouse interaction (hit testing, click counting, drag tracking)
  - **Breaking:** `editor.moveCursorTo()` and other navigation methods removed from Editor — use `editor.selection.moveCursorTo()` instead
  - **Breaking:** `ViewManager` deleted (was deprecated, replaced by TileManager). Remove any `ViewManager` imports

## 1.0.2

### Patch Changes

- 1d7dde7: Add CommonJS output to all packages so CJS consumers can `require()` the library

## 1.0.1

### Patch Changes

- 4b0e9c0: Add README.md to all packages with installation instructions, API overview, and usage examples. Fix root README to reference the correct hook name (`useScrivrEditor`) and renderer (`TileManager`).
- f4442e8: feat(core): addDocAttrs() extension lane for doc-level attributes

  Extensions can now contribute attributes to the `doc` node via a new `addDocAttrs()` Phase 1 hook:

  ```ts
  const HeaderFooter = Extension.create({
    name: "headerFooter",
    addDocAttrs() {
      return { headerFooter: { default: null } };
    },
  });
  ```

  `ExtensionManager.buildSchema` merges contributions from every extension into the doc node spec. Two extensions contributing the same attr name is a collision and throws at schema-build time with an error naming both owners — extensions are expected to namespace their attr names to avoid collisions in practice.

  Once declared, attrs are writable via ProseMirror's built-in `tr.setDocAttribute(name, value)`, which routes through `DocAttrStep` (jsonID `"docAttr"`, shipped in `prosemirror-transform` since 1.8.0). `@scrivr/core` now re-exports `DocAttrStep` as a convenience — extensions don't need to import from `prosemirror-transform` directly.

  This is the foundation for PR 4's HeaderFooter extension and future footnotes / comments / page-settings extensions that need document-level metadata participating in undo/redo, history snapshots, and collaboration round-trips.

- 3dcb134: refactor(layout): per-page PageMetrics, runMiniPipeline, recursion guard

  Internal refactor to `@scrivr/core`'s layout engine. Zero behavior change — all 566 tests pass unchanged.

  ### New primitives

  - `PageMetrics` — per-page geometry bundle (contentTop, contentBottom, contentHeight, contentWidth, header/footer heights). Replaces raw `margins.top` / `pageHeight - margins.bottom` arithmetic throughout the pipeline.
  - `computePageMetrics` — pure function deriving PageMetrics from PageConfig + chrome reservations.
  - `ChromeContribution` / `ResolvedChrome` — types for future chrome contributors (headers, footers, footnotes).
  - `fitLinesInCapacity` — shared line-fitting primitive extracted from paginateFlow's split loop.
  - `runMiniPipeline` — measurement-only pipeline for mini-documents (headers, footers, footnote bodies). Safe to call from chrome contributor hooks without triggering recursive pagination.
  - Recursion guard on `runPipeline` that throws with a readable error pointing at `runMiniPipeline`.

  ### Refactored hot paths

  - `paginateFlow` reads all vertical positions through `metricsFor(pageNumber)` instead of raw margin arithmetic (10 call sites).
  - `applyFloatLayout` uses `metricsForPage` helper across 9 call sites (float placement, exclusion re-layout, overflow cascade).
  - `DocumentLayout` gains optional `metrics[]`, `runId`, `convergence`, `iterationCount` fields.
  - `MeasureCacheEntry` gains `placedRunId` / `placedContentTop` for the early-termination guard to detect chrome configuration changes between runs.
  - `EMPTY_RESOLVED_CHROME` is `Object.freeze`d to prevent accidental mutation.

  ### Test coverage

  566 tests passing (555 pre-existing + 11 new covering PageMetrics, fitLinesInCapacity, runMiniPipeline, and the recursion guard).

## 1.0.0

### Minor Changes

- 7ba7cb5: Add ClearFormatting extension — `Mod-\` removes all inline marks, converts headings/code blocks to paragraphs, resets alignment and font family, and flattens lists back to plain paragraphs. Matches Google Docs behaviour. Exposed as `editor.commands.clearFormatting()` and registered in StarterKit.
