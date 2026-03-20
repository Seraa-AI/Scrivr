# Canvas Editor — Project Plan

A canvas-based document editor built for legal document workflows.
Designed as a standalone open-source package, with a known production use case (legal SaaS) to validate decisions against.

---

## Why Canvas Over DOM

| Problem | DOM / contenteditable | Canvas |
|---|---|---|
| Pagination | Browser controls layout | We control layout |
| Cross-browser rendering | Each browser differs | Pixel-identical everywhere |
| PDF fidelity | Re-render in headless Chrome | Same render code → PDF |
| Font metrics | Browser-dependent | We measure, we decide |

The core thesis: **the layout engine runs once, output goes anywhere** — screen, PDF, DOCX.

---

## Known Use Case (Legal SaaS)

Building against a real use case prevents designing in a vacuum.

Document types:
- Contracts, briefs, pleadings
- Templates with variable substitution
- Form-driven documents consumed through workflows

Hard requirements:
- Pagination must be exact and consistent across browsers
- PDF export must be pixel-identical to screen
- DOCX export must include track changes (OOXML `<w:ins>` / `<w:del>`)
- Form fields (text inputs, checkboxes) embedded within document flow
- Comments and annotations
- Signature capture

---

## Package Structure

```
canvas-editor/ (pnpm workspace)
├── packages/
│   ├── core/          — model, layout, renderer, input
│   ├── plugins/       — track-changes, comments, form-fields, signatures
│   ├── export/        — pdf, docx
│   └── react/         — React bindings
└── docs/              — this plan and architecture notes
```

### Dependency graph

```
react  →  core
plugins →  core
export  →  core
```

`core` has zero dependencies. Everything else depends on it.

---

## Architecture

### Data flow

```
Document Model
      ↓
 Layout Engine        ← the hard part; owns all text measurement
      ↓
  Render Tree         ← positioned boxes, glyphs, page assignments
      ↓
 ┌────┴────┐
Canvas   PDF/DOCX     ← same render tree, different output targets
```

### Core subsystems

#### 1. Document Model (`core/model`)
- Powered by `prosemirror-model`, `prosemirror-state`, `prosemirror-transform`
- `prosemirror-view` is **never used** — we never give ProseMirror a DOM node
- We define a ProseMirror Schema: paragraph, heading (h1–h6), list, table, page-break, form-field nodes
- Marks: bold, italic, underline, strikethrough, link, font-size, font-family, color
- `EditorState` holds the doc + selection as ProseMirror integer positions
- All edits go through ProseMirror `Transaction`s dispatched to `EditorState`
- Undo/redo via `prosemirror-history` plugin
- The layout engine reads the ProseMirror doc tree — it never writes to it

#### 2. Layout Engine (`core/layout`)
- **TextMeasurer**: wraps `canvas.measureText()`, caches by font+text key
- **LineBreaker**: greedy word-wrap algorithm, respects inline span boundaries
- **BlockLayout**: stacks lines vertically, applies paragraph spacing
- **PageLayout**: assigns blocks to pages, handles orphans/widows, headers/footers
- Input: document model + page config (width, height, margins)
- Output: render tree (all positions absolute, all text measured)

#### 3. Renderer (`core/renderer`)
- Accepts a render tree + `CanvasRenderingContext2D`
- Draws text spans at their absolute positions
- Draws selection rectangles (semi-transparent overlay)
- Draws cursor (1px vertical line, blinks via `requestAnimationFrame`)
- Dirty region tracking — only redraws changed areas

#### 4. Input Handler (`core/input`)
- **Hidden textarea (the bridge)**: an invisible `<textarea>` positioned at the virtual cursor. The browser handles all native input, autocomplete, and IME composition into it. We read the value and dispatch ProseMirror transactions. This is exactly how Google Docs handles input.
- **Keyboard**: `keydown` on the hidden textarea → ProseMirror `Transaction` → new `EditorState` → re-render
- **IME**: `compositionstart` / `compositionupdate` / `compositionend` on the hidden textarea. Show in-progress composition on canvas; commit on `compositionend`.
- **Mouse**: click gives `(x, y)` → `CharacterMap.posAtCoords()` → ProseMirror position → `EditorState` selection update
- **Clipboard**: intercept `copy`/`cut`/`paste` on the hidden textarea, serialize/deserialize doc slice

---

## Roadmap

### Phase 1 — Proof of Concept ✅ COMPLETE
**Goal:** Render a document on canvas with correct pagination. No editing yet.

- [x] Define core TypeScript types: `Doc`, `Block`, `Span`, `Mark`, `PageConfig`
- [x] Implement `TextMeasurer` with caching (`measureWidth`, `measureRun`, `getFontMetrics`)
- [x] Implement `LineBreaker` — greedy word wrap, `measureWidth` for decisions, `measureRun` for CharacterMap
- [x] Implement `BlockLayout` — lay out a paragraph's lines, empty-paragraph virtual span, alignment offset
- [x] Implement `PageLayout` — assign blocks to pages, margin collapsing, hard/soft page breaks, version counter
- [x] Implement `CanvasRenderer` — `setupCanvas` (DPR scaling), `renderPage` with stale-render guard
- [x] `CharacterMap` — glyph index for hit testing and cursor placement, JIT population in renderer
- [x] `StyleResolver` — font string builder from ProseMirror marks
- [x] `FontConfig` — typography constants per block type
- [x] ProseMirror schema — all legal document node types and marks
- [x] `Editor` class — hidden textarea input bridge, keyboard handling, undo/redo
- [x] Virtual page rendering — IntersectionObserver + 500px overscan, placeholder divs, Option C
- [x] Demo app wired up — `App.tsx`, `PageView.tsx`, `useVirtualPages.ts`
- [x] 107 unit/integration tests passing (vitest + happy-dom)
- [x] pnpm workspace + Vite aliases + tsconfig paths all aligned

**Success criteria:** ✅ Same pixel output across all three browsers for a static document.

**Key bets validated:**
- ✅ `canvas.measureText()` gives accurate enough metrics for sub-pixel line decisions
- ✅ `fontBoundingBoxAscent` (constant per font) prevents jiggling lines vs `actualBoundingBoxAscent`
- ✅ Virtual rendering (Option C) handles large documents without canvas memory limits

---

### Phase 2 — Interactive Editing (~6–8 sessions)
**Goal:** A user can type, select, and edit text.
**Detailed plan:** See `docs/phase-2.md`

- [ ] Fix editor container positioning (textarea must track cursor, not sit at absolute 0,0)
- [ ] Cursor rendering — dual-canvas overlay approach (content canvas + cursor canvas per page)
- [ ] Cursor blink — `requestAnimationFrame` timer, only runs when editor is focused
- [ ] Click → hit test → cursor placement via `CharacterMap.posAtCoords()`
- [ ] Arrow key navigation (← → ↑ ↓ with correct line/page crossing)
- [ ] Click + drag → selection
- [ ] Shift+click, double-click (word), triple-click (line) selection
- [ ] Selection rectangle rendering on overlay canvas
- [ ] Copy/paste (plain text first)
- [ ] Bold/italic toolbar with active-state detection

**Success criteria:** Type a paragraph, bold some words, select text, delete it, undo.

---

### Phase 3 — Legal Document Primitives (~4–6 sessions)
**Goal:** Feature parity with a standard legal document schema.

- [ ] Headings (h1–h6) with correct spacing
- [ ] Ordered and unordered lists with indentation
- [ ] Tables (fixed column widths, border rendering)
- [ ] Page headers and footers (with page number token)
- [ ] Embedded form fields (text input, checkbox, date picker) within document flow
- [ ] Comments/annotations (sidebar annotations linked to doc ranges)
- [ ] Track changes model (insert/delete marks with author + timestamp)

**Success criteria:** Reproduce a standard contract with headings, clauses, signature lines, and form fields.

---

### Phase 4 — Collaboration (~2–3 sessions)
**Goal:** Real-time multi-user editing via Hocuspocus + Y.js, as an opt-in extension.

- [ ] `Collaboration` extension — wraps `y-prosemirror` (`ySyncPlugin`, `yCursorPlugin`, `yUndoPlugin`)
- [ ] Swap `History` for Y.js `UndoManager` when collaboration is active (`StarterKit.configure({ history: false })`)
- [ ] `HocuspocusProvider` wired into the extension options
- [ ] Awareness — other users' cursors rendered as canvas overlays on the overlay canvas
- [ ] Offline-first: editor works without collaboration extension, no code change required

**Key decisions:**
- Collaboration is a single `Extension.create()` — consumers opt in by adding it to the extensions array
- `addProseMirrorPlugins` is the only hook needed — schema, input handling, and rendering are unchanged
- One Hocuspocus room = one document ID = all sections of that document (future: named sections per `Y.XmlFragment`)

**Named sections (deferred — design only):**
Headers, footers, footnotes, and endnotes are each a separate `Y.XmlFragment` within the same `Y.Doc`. A future `CanvasDocument` wrapper will coordinate multiple `Editor` instances (one per section) sharing a single `Y.Doc` and `pageConfig`. The current `Editor` class stays as-is — `CanvasDocument` sits above it. Not built now, but the architecture supports it without changes.

**Success criteria:** Two browser tabs editing the same document simultaneously, changes appear in real time, undo only affects your own changes.

---

### Phase 5 — Export Layer (~3–4 sessions)
**Goal:** PDF and DOCX output that matches screen exactly.

#### PDF
- [ ] Use the same layout engine output (render tree) as the canvas renderer
- [ ] Write a `PDFRenderer` that accepts render tree → outputs PDF using `pdfkit` or raw PDF primitives
- [ ] Embed fonts to guarantee fidelity
- [ ] No headless Chrome dependency — layout is already done

#### DOCX
- [ ] Map document model → OOXML XML structure
- [ ] Handle track changes: insertions as `<w:ins>`, deletions as `<w:del>`
- [ ] Use `pizzip` for building the `.docx` zip archive
- [ ] Test round-trip: export → open in Word/LibreOffice → verify

**Success criteria:** Export a tracked-changes document to DOCX, open in Microsoft Word, accept/reject changes correctly.

---

### Phase 6 — Open Source Release
- [ ] Write API documentation
- [ ] Build a demo/playground (Vite app in `/demo`)
- [ ] Write migration guide from ProseMirror
- [ ] Publish packages to npm under `@canvas-editor/*`
- [ ] Evaluate bringing into the production legal SaaS app

---

## Decisions Log

| Decision | Choice | Reason |
|---|---|---|
| Monorepo tool | pnpm workspaces | Lightweight, fast, good workspace protocol support |
| Language | TypeScript strict mode | Legal SaaS context; type safety is non-negotiable |
| Document model | `prosemirror-model` + `prosemirror-state` + `prosemirror-transform` | Battle-tested position tracking, schema validation, undo history — free. We only drop `prosemirror-view`. |
| `prosemirror-view` | Not used | This is the part that touches the DOM. Dropping it means we never fight the browser for layout control. |
| Input bridge | Hidden `<textarea>` | Browser captures keystrokes and IME composition; we read from it and dispatch ProseMirror transactions. Exactly how Google Docs works. |
| Hit testing | CharacterMap (glyph index) | Layout engine writes every glyph's `(x, y, width, docPos)` into a lookup structure. Click → page → line → closest char → ProseMirror position. |
| PDF strategy | Same layout engine → PDFRenderer | Eliminates fidelity gap; no headless Chrome needed |
| DOCX strategy | Custom OOXML serializer | Full control over track changes format |
| React bindings | Separate package, peer dep | Core stays framework-agnostic |
| Fabric.js / Konva.js | Not used as core | No text flow engine; would still need to build layout ourselves |
| Paste handling | Hidden textarea `paste` event → ProseMirror DOMParser | Textarea is a real DOM element that receives clipboard events; ProseMirror DOMParser handles a decade of HTML edge cases we'd otherwise have to solve ourselves |
| Block extensibility | `BlockRegistry` with measure+render strategies | Avoids hardcoding block types in core; lets consumers register image, code_block, etc. without forking |
| Lifecycle hooks | `onLayout`, `onBeforeRenderPage`, `onAfterRenderPage`, `transformPaste` | Watermarks, page numbers, word count, paste filtering — all without touching core |
| Theme system | `Theme` object into renderer (additive to `FontConfig`) | `FontConfig` = type metrics for layout; `Theme` = visual presentation; kept separate to preserve layout purity |
| Collaboration | `Collaboration` extension wrapping `y-prosemirror` + Hocuspocus | Opt-in via extensions array; swaps `History` for Y.js `UndoManager`; `addProseMirrorPlugins` is the only hook needed |
| Named sections (future) | `CanvasDocument` wrapper, one `Y.XmlFragment` per section | Headers/footers/footnotes are full editable ProseMirror docs, not render callbacks; deferred to post-Phase 4 |

---

## Open Questions

- Should `TextMeasurer` fall back gracefully if a font hasn't loaded yet, or block layout until fonts are ready?
- How do we handle bidirectional text (RTL) for international legal documents?
- Collaborative editing (OT vs CRDT) — out of scope for v1, but model should not make it impossible
- Accessibility: what is the minimum viable hidden DOM / ARIA implementation?
- Should the demo app be a separate package in the workspace or a standalone Vite app?

---

## Working Sessions Log

| Date | Phase | What was done |
|---|---|---|
| — | Setup | Project scaffolded, plan written |
| Session 1–2 | Phase 1 | pnpm workspace, tsconfig, vitest, schema, model commands |
| Session 3–4 | Phase 1 | TextMeasurer, LineBreaker, StyleResolver, FontConfig, BlockLayout |
| Session 5–6 | Phase 1 | PageLayout, CharacterMap, CanvasRenderer, Editor class |
| Session 7 | Phase 1 | Virtual rendering (Option C), demo app, all 104 tests passing |
