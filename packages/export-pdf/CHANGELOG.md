# @scrivr/export-pdf

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
