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
pnpm dev              # Start the docs app (hosts the playground at /playground)

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
- `TileManager` — DOM bridge for both paged and pageless modes: recycles a fixed pool of tiles (2 canvases each — content + overlay) as the user scrolls, so tile count follows the viewport rather than the document. Scroll listener + `ResizeObserver`; pointer handling lives in `PointerController`
- `PageRenderer` — paints one `LayoutPage` onto its canvas; populates `CharacterMap` on first paint
- `OverlayRenderer` — cursor and selection rendering; extend via `addOverlayRenderHandler`
- `CursorManager` — 530ms blink timer

**Input (`input/`)**
- `InputBridge` — hidden textarea with 8 DOM event listeners → ProseMirror transactions
- `PasteTransformer` — clipboard → transaction. Cleans pasted HTML (incl. Google Docs and Word `mso-list` lists), decides slice openness, converts markdown, and inserts image files. `transform()` is sync; `transformFiles()` is async because image bytes must be read or uploaded first
- `ClipboardSerializer` — serializes selection to `text/plain` + `text/html`, recording the slice's open depths in `data-pm-slice` so a paste back into an editor rebuilds the exact slice
- URL-bearing attrs pass a per-sink gate on ingestion: `safeUrl` for link `href`, `safeImageUrl` for image `src` (raster `data:` allowed, `svg+xml` not)

**Model (`model/`)**
- `schema.ts` — nodes: `doc`, `paragraph`, `heading`, `bulletList`, `orderedList`, `listItem`, `codeBlock`, `horizontalRule`, `pageBreak`, `image`, `hardBreak`, `text`; marks: `bold`, `italic`, `underline`, `strikethrough`, `highlight`, `color`, `fontSize`, `fontFamily`, `link`, `trackedInsert`, `trackedDelete`

**Extensions (`extensions/`)**
- `Extension` base class with `create`/`configure` config-object pattern
- `ExtensionManager` — Phase 1 collects nodes/marks, Phase 2 builds plugins/commands/keymaps after schema is constructed
- `StarterKit` — default bundle of 17 built-in extensions
- Each extension can register: ProseMirror nodes/marks, commands, keymaps, `BlockStrategy`, `InlineStrategy`, `MarkDecorator`

### React Adapter (`packages/react/src/`)

React is a thin shell. The engine owns layout and rendering.
- `useScrivrEditor` — creates and manages `Editor` lifecycle
- `Scrivr` — mounts `TileManager` in `useEffect`
- `useScrivrState` (exported as `useEditorState`) — subscribes to editor state without importing ProseMirror directly

### Plugins (`packages/plugins/src/`)
- **Collaboration** — Yjs + HocusPocus provider
- **AI Toolkit** — `GhostText`/`AiCaret`/suggestion overlay using `addOverlayRenderHandler`; streaming is cosmetic (overlay only), document unchanged until `acceptSuggestion`
- **Track Changes** — split ranges + `excludes: ""` + `isConflict` flag; spec at `docs/multi-author-tracked-changes.md`

### Export (`packages/export/src/`)
- PDF via `pdf-lib` (renders `LayoutPages` directly); inline object image rendering is incomplete
- Markdown via `prosemirror-markdown`

## Test Setup

- Environment: `happy-dom` (core), `node` (plugins)
- `vitest.setup.ts` wires **real** Skia font metrics (`@napi-rs/canvas`) into `getContext("2d")`. Measurement is never mocked — see `createMeasurer()` / `createTestEditor()` in `src/test-utils.ts`
- **Text measures differently on different machines.** Linux CI fonts are not macOS fonts, so a string can wrap to a different number of lines there. Never assert a layout value that depends on wrap count, and never assert a real-font width tighter than ~1px. Assert relationships between measured values (`float.y === anchor.y`) or derive the expected value from the same measurer the code uses
- ~1590 tests in core across ~90 test files

## Key Conventions

- **No `as` type assertions.** Never use `as X` to narrow types. Write runtime predicate/guard functions that validate shape and return typed values. A single `as` inside a guard (after an `in`/`typeof` check) is acceptable — scattered `as` casts at call sites are not. Use `satisfies` when validating a value matches a type without widening. Module augmentation (`Commands`, `NodeAttributes`) should make consumer casts unnecessary.
- Match Word/Google Docs/Pages conventions for cursor behavior, shortcuts, paste, formatting by default
- Layout pipeline is being refactored toward explicit named stages (`buildBlockFlow` → `applyFloatLayout` → `paginateFlow` → `buildFragments`) — follow this pattern when touching `PageLayout.ts`
- Float y-delta pushes long paragraphs past `pageBottom` → split at boundary (`splitBlockAtBoundary`), do not move wholesale
- Zero-width caret sentinel on last line of each block prevents scroll-to-top bug in `coordsAtPos`

## gstack

Use the `/browse` skill from gstack for all web browsing. Never use `mcp__claude-in-chrome__*` tools.

Available skills: `/office-hours`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/design-consultation`, `/design-shotgun`, `/design-html`, `/review`, `/ship`, `/land-and-deploy`, `/canary`, `/benchmark`, `/browse`, `/connect-chrome`, `/qa`, `/qa-only`, `/design-review`, `/setup-browser-cookies`, `/setup-deploy`, `/retro`, `/investigate`, `/document-release`, `/codex`, `/cso`, `/autoplan`, `/plan-devex-review`, `/devex-review`, `/careful`, `/freeze`, `/guard`, `/unfreeze`, `/gstack-upgrade`, `/learn`.

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

**Before any ship or merge: `scrivr-review` runs first.** Every time — before
`/ship`, before merging a PR, before pushing a release. It runs seven
specialized reviewers over the diff (data flow, conditions, readability,
comments, public API surface, typing discipline, repo conventions) and returns
a ranked verdict. Blockers get fixed before the merge, not after.

Key routing rules:
- Ship, deploy, merge, release → invoke scrivr-review FIRST, then ship
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke scrivr-review (gstack `review` is the generic fallback)
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
