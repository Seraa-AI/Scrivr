---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
---

Theming: 12 canvas tokens + per-extension theme + PDF override path. Tailwind dark mode (or any CSS-variable-driven theme system) can drive both DOM chrome and canvas paint from a single source of truth. PDF export defaults to a print-ready palette that ignores the canvas theme; callers opt into themed PDF via `exportPdf({ theme })`.

**Note:** This bumps `MarkDecorator`, `InlineStrategy.render`, `OverlayRenderHandler`, `BlockRenderContext`, and `PageChromePaintContext` signatures with new theme/effective-color parameters. Third-party extensions that hook these will pick up TypeScript errors and need to update their signatures (most can ignore the new args; underline/strikethrough-style decorators read `effectiveTextColor`).

**@scrivr/core**

- New `EditorTheme` (input — accepts CSS color strings including `var(--token)` references) and `ResolvedTheme` (output — literal colors only, what render contexts consume). Both exported from `@scrivr/core`. 12 tokens cover cross-cutting paint surfaces: pageBg, pageShadow, defaultText, link, cursor, selectionFill, imagePlaceholderBg/Border/Text, listMarker, hrColor, resizeHandle.
- New constants: `defaultEditorTheme` (matches every hardcoded color used today — zero visual regression for apps that don't pass `theme`) and `defaultPdfTheme` (print-ready palette: white bg, black text, blue link, light placeholders).
- New `EditorOptions.theme` and `EditorOptions.themeRoot`. `themeRoot` defaults to the mounted container, falling back to `document.documentElement` for unmounted instances. `var(--token)` strings resolve against `themeRoot` via a hidden `<div>` probe + `getComputedStyle` (the browser handles every CSS color form for free — `var()`, `var()` with fallback, `color-mix()`, `oklch()`, `calc()`).
- New `editor.setTheme(partial)` API. Partial merge with explicit semantics: `null` resets a token to its default, `undefined` leaves the token alone, any other value overrides. Calling with `{}` is a pure refresh (re-resolves and bumps `renderGeneration`).
- New `editor.getTheme()` and `editor.getResolvedTheme()` accessors.
- Auto-installed `MutationObserver` on `themeRoot` (watching `class`, `style`, `data-theme`) when any theme value contains `var(`. rAF-coalesced — burst mutations produce one re-resolve per frame. Toggling the Tailwind `dark` class triggers a single canvas repaint without explicit calls.
- Theme threaded into every paint surface today: `canvas.ts` clearCanvas (pageBg), `TextBlockStrategy` default text fill (defaultText), `Underline`/`Strikethrough` decorations (effectiveTextColor — color marks win), `Link` decorator (theme.link), `Image` placeholders (3 tokens), `HorizontalRule` (hrColor), `ListItemStrategy` markers (listMarker), `ResizeController` handles (resizeHandle), `OverlayRenderer` cursor + selection (cursor, selectionFill).
- `BlockRenderContext`, `PageChromePaintContext`, `MarkDecorator.decoratePre`/`decoratePost`/`decorateFill`, `InlineStrategy.render`, and `OverlayRenderHandler` now carry/receive a resolved theme (and `effectiveTextColor` for mark decorators) so third-party extensions get dark mode automatically without forking the paint contract.
- `CodeBlock` extension now accepts a `theme: { bg, border }` option for per-extension palette overrides. Other built-ins read from the cross-cutting `ResolvedTheme` directly.
- `ServerEditor` accepts `theme` for type parity with `Editor` but never resolves (no DOM). Constructs warn once via `console.warn` when a theme value contains `var(...)` because the resolver can't run server-side.
- Probe element (the hidden `<div>` used for color resolution) is removed from `themeRoot` on `editor.destroy()`.
- Header/footer surfaces inherit the body's resolved theme via `PageChromePaintContext.theme` — they never store a copy, so `setTheme()` on the body propagates without surface-side refresh.

**@scrivr/export-pdf**

- New `PdfExportOptions.theme` — `Partial<ResolvedTheme>` (literal CSS colors only). Shallow-merged over `defaultPdfTheme`. PDF default is independent of `editor.theme` so a dark canvas still produces a print-ready PDF unless the caller explicitly opts in.
- `editor.commands.exportPdf({ theme, filename })` accepts the same theme override at the command level. Type-safe via the augmented `Commands` interface.
- New `parseCssColor` helper supports `#hex`, `#rgb`, `rgb(...)`, and `rgba(...)` formats — used internally to parse theme tokens into pdf-lib `rgb()` colors.
- `PdfContext.theme` field carries the resolved theme to every PDF handler. Built-in handlers (paragraph/heading/image/hr/codeblock/listItem/underline/strikethrough/link) read from `ctx.theme`; extension-contributed PDF handlers via `addExports().pdf` get the same context shape.

**@scrivr/react**, **@scrivr/plugins**, **@scrivr/export-markdown**

- No code changes. Patch bump only, lockstep versioning. Plugins' header-footer chrome paint reads `paintCtx.theme` to render header/footer body content with the same theme as the page body — surface theme parity with no surface-side state.
