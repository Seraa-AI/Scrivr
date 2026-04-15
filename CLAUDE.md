# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Scrivr** — a canvas-based document editor framework. Packages: `@scrivr/core`, `@scrivr/react`, `@scrivr/plugins`, `@scrivr/export`. Apps: `demo`, `docs`, `server`.

## Commands

```bash
# From repo root
pnpm install          # Install all deps
pnpm build            # Build all packages (tsup, ESM only)
pnpm test             # Run all tests (turbo)
pnpm typecheck        # Type-check all packages
pnpm dev              # Start demo app

# Per-package (preferred for development)
cd packages/core && npx vitest run                        # Run all core tests
cd packages/core && npx vitest run src/layout/PageLayout.test.ts  # Run single test file
cd packages/core && npx vitest run -t "should split block"        # Run tests matching name
cd packages/core && npx vitest                            # Watch mode

# Build
cd packages/core && pnpm build    # tsup → dist/index.js + dist/index.d.ts
```

**Critical:** Never run bare `npx vitest run` from repo root — it misses `vitest.config.ts` and `setupFiles`. Always run from the package directory or use `pnpm test` from root.

## Architecture

Four-layer design:

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Model** | ProseMirror | Immutable document tree, schema, history |
| **Layout** | Custom engine | Pagination, line-breaking, text measurement |
| **Renderer** | HTML5 Canvas | Pixel-perfect painting of layout output |
| **Input** | Hidden `<textarea>` | Keyboard/IME/paste → ProseMirror transactions |

### Core Engine (`packages/core/src/`)

**`Editor.ts`** — Orchestrator. Owns `ExtensionManager`, `EditorState`, `InputBridge`, `LayoutCoordinator`, `CursorManager`. Exposes commands API and state subscriptions.

**Layout (`layout/`)**
- `LayoutCoordinator` — owns `DocumentLayout`, `CharacterMap`, measure cache, idle-callback scheduling (first 100 blocks sync, rest via `requestIdleCallback`)
- `PageLayout` — core pipeline: `buildBlockFlow` → `applyFloatLayout` → `paginateFlow` → `buildFragments` → float passes (3/3b split at page boundary) → offset computation
- `BlockLayout` — per-block layout via strategy pattern; delegates to `TextBlockStrategy`, `ImageBlockStrategy`, etc.
- `LineBreaker` — text wrapping with kerning-accurate character positions
- `TextMeasurer` — canvas `measureText` with LRU cache; mocked in tests via `vitest.setup.ts`
- `CharacterMap` — glyph index mapping doc positions ↔ canvas coordinates (used for click hit-testing and cursor placement); uses **char-level span ranges**, not node ranges, so binary search finds the correct page for split paragraphs

**Renderer (`renderer/`)**
- `ViewManager` — DOM bridge: creates page `<div>`s, manages 2 canvases per page (content + overlay), virtual scrolling via `IntersectionObserver`, mouse events
- `PageRenderer` — paints one `LayoutPage` onto its canvas; populates `CharacterMap` on first paint
- `OverlayRenderer` — cursor and selection rendering; extend via `addOverlayRenderHandler`
- `CursorManager` — 530ms blink timer

**Input (`input/`)**
- `InputBridge` — hidden textarea with 8 DOM event listeners → ProseMirror transactions
- `PasteTransformer` — cleans pasted HTML before ProseMirror ingestion
- `ClipboardSerializer` — serializes selection to `text/plain` + `text/html`

**Model (`model/`)**
- `schema.ts` — nodes: `doc`, `paragraph`, `heading`, `bulletList`, `orderedList`, `listItem`, `table`, `tableRow`, `tableCell`, `codeBlock`, `horizontalRule`, `pageBreak`, `image`, `hardBreak`, `text`; marks: `bold`, `italic`, `underline`, `strikethrough`, `highlight`, `color`, `fontSize`, `fontFamily`, `link`, `trackedInsert`, `trackedDelete`

**Extensions (`extensions/`)**
- `Extension` base class with `create`/`configure` config-object pattern
- `ExtensionManager` — Phase 1 collects nodes/marks, Phase 2 builds plugins/commands/keymaps after schema is constructed
- `StarterKit` — default bundle of 17 built-in extensions
- Each extension can register: ProseMirror nodes/marks, commands, keymaps, `BlockStrategy`, `InlineStrategy`, `MarkDecorator`

### React Adapter (`packages/react/src/`)

React is a thin shell. The engine owns layout and rendering.
- `useInscribeEditor` — creates and manages `Editor` lifecycle
- `Inscribe` — mounts `ViewManager` in `useEffect`
- `useInscribeState` — subscribes to editor state without importing ProseMirror directly

### Plugins (`packages/plugins/src/`)
- **Collaboration** — Yjs + HocusPocus provider
- **AI Toolkit** — `GhostText`/`AiCaret`/suggestion overlay using `addOverlayRenderHandler`; streaming is cosmetic (overlay only), document unchanged until `acceptSuggestion`
- **Track Changes** — split ranges + `excludes: ""` + `isConflict` flag; spec at `docs/multi-author-tracked-changes.md`

### Export (`packages/export/src/`)
- PDF via `pdf-lib` (renders `LayoutPages` directly); inline object image rendering is incomplete
- Markdown via `prosemirror-markdown`

## Test Setup

- Environment: `happy-dom` (core), `node` (plugins)
- `vitest.setup.ts` calls `mockCanvas()` which stubs `HTMLCanvasElement.measureText` to return deterministic widths — required for all layout tests
- 459+ tests in core across 17 test files

## Key Conventions

- `PageView.tsx` is deprecated — `ViewManager.ts` is the active renderer
- Match Word/Google Docs/Pages conventions for cursor behavior, shortcuts, paste, formatting by default
- Layout pipeline is being refactored toward explicit named stages (`buildBlockFlow` → `applyFloatLayout` → `paginateFlow` → `buildFragments`) — follow this pattern when touching `PageLayout.ts`
- Float y-delta pushes long paragraphs past `pageBottom` → split at boundary (`splitBlockAtBoundary`), do not move wholesale
- Zero-width caret sentinel on last line of each block prevents scroll-to-top bug in `coordsAtPos`
