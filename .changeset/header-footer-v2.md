---
"@scrivr/plugins": patch
"@scrivr/core": patch
"@scrivr/export-pdf": patch
"@scrivr/react": patch
---

Add HeaderFooter extension with configurable headers and footers, live inline editing, token substitution, and PDF export parity.

**@scrivr/plugins** — New `HeaderFooter` extension: doc-level `headerFooter` policy, per-page slot resolution (`differentFirstPage`, `differentOddEven` reserved), `pageNumber`/`totalPages`/`date` inline atom tokens with dynamic `measure()`, headless `HeaderFooterController` for building settings UI, surface-based live editing with undo/redo history, restricted schema (no tables/page breaks), and PDF chrome + token export handlers.

**@scrivr/core** — Surface-aware command routing (`_getActiveState`/`_dispatchToActive`), `chromeClick` event, `PageChromePaintContext` gains `measurer`/`markDecorators`/`blockRegistry`/`inlineRegistry`, `ChromeContribution` gains `replacesTopMargin`/`replacesBottomMargin`/`topBandStart`/`bottomBandStart`, `EditorSurface` accepts plugins, `IEditor` exposes `surfaces`/`invalidateLayout`/`getPageScreenPosition`, `InlineStrategy` type exported from layout index, and `addCommands` signature widened to support typed command parameters.

**@scrivr/export-pdf** — Chrome payload image scanning for `embedImages`, WinAnsi sanitizer expanded to cover smart quotes and em/en dashes.

**@scrivr/react** — New `HeaderFooterRibbon` component (Google Docs-style ribbon bar with "Different first page" toggle, margin controls, token insert buttons, and remove header/footer actions).
