# Inscribe Features Roadmap

Brainstorm of all features expected in a production-grade word processor. Grouped by area. Status column tracks what's done vs. planned.

---

## Paste Quality

### Google Docs Paste Fix

**Status:** Planned

GDocs emits deeply nested `<span>` tags with inline styles. Raw PM DOMParser produces garbled output — extra spacing, lost fonts, alignment ignored.

**Plan:**

1. **`cleanPastedHtml(html: string): string`** — add to `PasteTransformer`, called at the top of `fromHtml()` before `div.innerHTML = html`:
   - Strip Google-specific attributes: `data-docs-*`, `id="docs-internal-*"`, `google-revisions-*`
   - Remove empty `<b>` wrappers GDocs emits around everything (`<b style="font-weight:normal">`)
   - Remove layout-only styles from `<span>` tags: `line-height`, `margin`, `padding`, `vertical-align` — keep only `font-family`, `font-weight`, `font-style`, `text-decoration`, `color`, `font-size`
   - Collapse single-child `<span>` chains: `<span style="a"><span style="b">text</span></span>` → `<span style="a;b">text</span>`
   - Strip empty `<p>` tags that GDocs inserts as spacers

2. **Paragraph `parseDOM` — read alignment:**
   ```typescript
   parseDOM: [{ tag: "p", getAttrs: (dom) => ({ align: (dom as HTMLElement).style.textAlign || null }) }]
   ```

3. **FontFamily mark `parseDOM` — read inline style:**
   ```typescript
   parseDOM: [{
     tag: "span[style]",
     getAttrs: (dom) => {
       const family = (dom as HTMLElement).style.fontFamily;
       return family ? { family: family.replace(/['"]/g, "").split(",")[0]!.trim() } : false;
     },
   }]
   ```

4. **Tests:** Capture a real GDocs HTML payload (with bold, italic, alignment, lists) and snapshot-test the resulting PM slice.

**Also handle:** Word/LibreOffice paste (similar issue — `mso-*` styles, `<o:p>` tags, Word-specific namespace junk). Same `cleanPastedHtml` hook, additional stripping rules.

### Large Paste Optimization

**Status:** Not implemented

**The problem:** Pasting a 50-page Word document or a 10,000-line HTML payload blocks the main thread for several seconds. Three stages all run synchronously and each can independently lock the UI:

1. **`cleanPastedHtml`** — string regex + DOM manipulation on a multi-MB HTML blob
2. **`PMDOMParser.parseSlice`** — walks potentially thousands of DOM nodes to build a PM fragment
3. **`layoutDocument`** — the entire new document re-lays out because the doc changed (full invalidation)

**Stage 1 — HTML size gate before parsing**

Before touching the DOM, check payload size and block count:

```typescript
// In PasteTransformer.fromHtml()
const LARGE_PASTE_BYTES = 200_000; // ~200 KB
const isBig = html.length > LARGE_PASTE_BYTES;
```

For large payloads, strip the HTML to plain text only — no inline styles, no font marks — so the parse is fast. Show a one-time toast: "Large paste: formatting removed to preserve performance."

Alternatively, show a confirmation dialog before pasting: "Paste 847 paragraphs?" — let the user decide.

**Stage 2 — Limit block count in the resulting slice**

After `parseSlice`, count the blocks in the resulting fragment. If the block count exceeds a threshold (e.g. 500 blocks), truncate and warn:

```typescript
const MAX_PASTE_BLOCKS = 500;
const blockCount = slice.content.childCount;
if (blockCount > MAX_PASTE_BLOCKS) {
  // truncate slice to first MAX_PASTE_BLOCKS children
  // dispatch a notice to the UI
}
```

**Stage 3 — Chunked post-paste layout (most important)**

This is the real bottleneck. After paste, `dispatch()` triggers `ensureLayout()` which calls `layoutDocument()` with no `maxBlocks` — full synchronous re-layout of the entire document.

Fix: detect that the document change was a large paste and use the same chunked layout path as initial load.

```typescript
// In Editor.dispatch() or ensureLayout():
const addedBlocks = newDoc.childCount - prevDoc.childCount;
const LARGE_PASTE_THRESHOLD = 50; // blocks

if (addedBlocks > LARGE_PASTE_THRESHOLD) {
  // Use chunked path — paint first INITIAL_BLOCKS immediately
  this._layout = layoutDocument(newDoc, { ..., maxBlocks: Editor.INITIAL_BLOCKS });
  this._layoutIsPartial = true;
  this.scheduleIdleLayout();
} else {
  // Normal sync path — small paste, layout immediately
  this._layout = layoutDocument(newDoc, { ... });
}
```

The chunked path already exists (`scheduleIdleLayout`, `_partialLayoutBlocks`, `_layoutResumption`) — it just needs to be triggered for large pastes, not only on initial load.

**Stage 4 — Measure cache warm-up**

When pasting many paragraphs of the same font/size (common for docs pasted from a single source), the `measureCache` (`WeakMap<Node, ...>`) is cold — every block needs a full measure pass.

Since pasted nodes are NEW PM nodes (different object identity), the cache cannot be reused directly. But we can pre-warm it by measuring unique `(text, font)` pairs before the layout pass:

```typescript
// Pre-measure all unique fonts that appear in the paste slice
const fonts = new Set<string>();
collectFonts(slice, fonts); // walk slice.content, extract span fonts
for (const font of fonts) {
  measurer.measureRun("the quick brown fox", font); // warms LRU cache
}
```

This cuts measure time by ~60% for typical single-font pastes because subsequent characters in the same font hit the LRU instead of calling `ctx.measureText`.

**Stage 5 — Paste progress indicator**

For very large pastes where chunked layout takes several idle callbacks, show a lightweight progress bar in the editor status bar. The `_layoutIsPartial` flag and `_partialLayoutBlocks` counter are already available — surface them via `editor.subscribe()`:

```typescript
editor.subscribe(() => {
  if (editor.isLayoutPartial) {
    showProgressBar(editor.layoutProgress); // 0.0 – 1.0
  } else {
    hideProgressBar();
  }
});
```

`editor.isLayoutPartial` and `editor.layoutProgress` are new read-only getters on `Editor` — trivial to add since the internal state already exists.

**Recommended order of implementation:**
1. Stage 3 (chunked post-paste layout) — biggest user-visible win, reuses existing infrastructure
2. Stage 1 (HTML size gate) — prevents the parser from locking the thread on massive payloads
3. Stage 5 (progress indicator) — makes partial layout visible to the user
4. Stage 2 (block count truncation) — guard rail for extreme cases
5. Stage 4 (measure cache warm-up) — micro-optimization, do last

---

## Paragraph Formatting

### Line Height
**Status:** Not implemented

Line height is currently baked into font metrics (ascent + descent + leading). Users expect a "line spacing" control (1.0, 1.15, 1.5, 2.0, or exact px).

- Add `lineHeight` attribute to paragraph and heading nodes (default `1.15`)
- `layoutBlock` multiplies the raw font line height by this factor
- `BlockStyle` gets an optional `lineHeightMultiplier` that extensions can override
- UI: dropdown with presets (Single / 1.15 / 1.5 / Double / Custom)
- Command: `setLineHeight(value: number)`

### Space Before / Space After
**Status:** Not implemented (hard-coded in `BlockStyle`)

`spaceBefore` and `spaceAfter` are currently static values contributed by extensions via `addBlockStyles()`. Users need per-paragraph control.

- Add `spaceBefore` / `spaceAfter` number attributes to paragraph/heading nodes
- `PageLayout` reads the node attr first, falls back to `blockStyle` default
- UI: "Paragraph spacing" section in a format panel
- Command: `setSpacing({ before?: number, after?: number })`

### First-Line Indent / Hanging Indent
**Status:** Not implemented

- Add `indent` (left indent, in px or pt) and `firstLineIndent` attributes to paragraph
- `layoutBlock` shifts `x` by `indent` and first-line x by `firstLineIndent`
- Hanging indent = positive `indent` + negative `firstLineIndent`
- Already implied by list item rendering — generalize to all blocks

### Indentation (Block Level)
**Status:** Partially done (list items use MARKER_RIGHT_GAP)

- `Indent` / `Outdent` commands for paragraphs (increase/decrease left margin by a tab stop, e.g. 36px)
- Keyboard: Tab / Shift-Tab outside lists

---

## Ruler

**Status:** Not implemented

The horizontal ruler is a DOM overlay (not canvas) above the page — it shows:
- Page margin boundaries (grayed-out non-content zones)
- Left indent marker (triangle pointing down)
- First-line indent marker (triangle pointing up, stacked on left indent)
- Right indent marker
- Tab stops (click to add, drag to move)

**Plan:**
- Render as a `<div>` positioned above the canvas, same width as the page
- Listen for drag events on indent markers → dispatch `setIndent`/`setFirstLineIndent` transactions
- Tab stop markers → `addTabStop` / `removeTabStop` commands (tab stops also need layout engine support)
- Synchronize with cursor position — ruler shows indent values of the paragraph the cursor is in

---

## Text Formatting

### Clear Formatting
**Status:** Not implemented

- Remove all marks from selection
- Command: `clearFormatting()` → `state.tr.removeMark(from, to)` for every mark type in schema
- Keyboard: Ctrl+\\ (standard in Google Docs / Word)

### Format Painter
**Status:** Not implemented

- Copy the marks at the cursor position
- Next selection gets those marks applied
- Two modes: single-use (click once) and persistent (double-click — keep painting until Escape)
- Store copied marks in editor state or a component-level ref

### Font Size (fine-grained)
**Status:** Done (FontSize extension exists)

### Text Color / Highlight
**Status:** Done

### Superscript / Subscript
**Status:** Not implemented

- New marks: `superscript`, `subscript`
- `resolveFont` applies size reduction (0.65×) and vertical offset
- Commands: `toggleSuperscript`, `toggleSubscript`
- Keyboard: Ctrl+Shift+= / Ctrl+=

---

## Find & Replace

**Status:** Not implemented

Must-have for any word processor.

- **Find** (Ctrl+F): search text across the document, highlight all matches, navigate next/prev
- **Replace** (Ctrl+H): replace one or all matches
- Implementation: pure PM model — walk `doc.descendants()` to find text matches, create `Decoration` highlights via a plugin
- Canvas rendering: match highlights drawn as overlay rectangles (similar to CellSelection overlay)
- UI: floating panel (React component), not canvas

---

## Page Setup

### Page Margins
**Status:** Hard-coded in `PageLayout` (`margins` object)

- Add margin settings (top, bottom, left, right) to document-level attrs or a `PageSettings` extension
- `PageLayout` reads from doc attrs instead of constants
- UI: Page Setup dialog or drag-able margin lines on the ruler

### Page Size / Orientation
**Status:** Hard-coded (A4 / Letter)

- Add `pageSize: "A4" | "Letter" | "Legal" | "Custom"` and `orientation: "portrait" | "landscape"` to doc attrs
- `PageLayout` derives `pageWidth`/`pageHeight` from these
- Affects canvas size too — `ViewManager` must resize canvases

### Page Numbering
**Status:** Partially done (page count displayed in demo UI)

- `{PAGE}` / `{PAGES}` fields in headers/footers (see below)
- "Start at" setting, Roman numerals option

---

## Headers and Footers

**Status:** Not implemented

Repeating content drawn at the top/bottom of every page.

- Add a `header` and `footer` PM node (document-level, not part of the flow content)
- `PageLayout` reserves `headerHeight` / `footerHeight` from page margins
- `PageRenderer` draws header/footer on every page using a separate layout pass
- Headers/footers can contain: text, page number fields `{PAGE}`, `{PAGES}`, images, alignment
- "Different first page" and "different odd/even" options

---

## Comments / Annotations

**Status:** Not implemented

Inline comments visible in a sidebar.

- `comment` mark with `id`, `authorId`, `createdAt` attrs (similar to `trackChange` mark)
- Comment thread stored outside the doc (in Y.js awareness or a separate data structure)
- Sidebar panel: shows threads sorted by doc position
- Canvas overlay: draws a bracket or highlight for the commented range

---

## Table of Contents

**Status:** Not implemented

Auto-generated from heading nodes.

- `toc` node — a leaf block that re-renders based on the current heading structure
- `updateToc()` command — scans `doc.descendants()` for heading nodes, builds entries with dotted leaders and page numbers
- Page numbers come from `CharacterMap.posAtPage()` — heading nodePos → page
- Manual update (button) first; auto-update on each render is too expensive

---

## Zoom

**Status:** Not implemented

- `zoom` factor (0.5–2.0) stored in editor state (not doc)
- Affects canvas CSS `transform: scale(zoom)` or canvas pixel dimensions
- ViewManager must account for zoom when translating mouse coords to canvas coords
- Keyboard: Ctrl+= / Ctrl+- / Ctrl+0

---

## Word Count

**Status:** Not implemented

- Live count of words and characters in the document (and in selection)
- Implementation: walk `doc.textContent`, split on whitespace
- Display: status bar or floating badge in the React shell

---

## Spell Check

**Status:** Not implemented (browser native doesn't work on canvas)

- Canvas editors lose browser spell-check because text is not in a `contenteditable`
- Options:
  1. **Browser API:** `Intl.Segmenter` + dictionary lookup (heavy, offline)
  2. **Server-side:** Send words to a spell-check endpoint, receive error ranges
  3. **`typo.js` or similar WASM dict:** runs client-side, no server needed
- Render: red squiggly underline via `decoratePost` in a `SpellCheck` mark decorator

---

## Export

### PDF
**Status:** Shell exists (`@inscribe/export`)

- Wire `PageRenderer` output into a PDF library (jsPDF or pdf-lib)
- Each page → canvas → `toDataURL('image/png')` → embed in PDF
- Preserve text layer for searchability (needs pdf-lib text API)

### DOCX
**Status:** Stub

- Use `docx` npm package (pure JS, no server)
- Walk PM doc → emit DOCX XML nodes
- Handles: paragraphs, headings, bold/italic/underline, lists, images, tables (once implemented)

### Markdown
**Status:** Done (MarkdownSerializer exists)

---

## Context Menu

**Status:** Not implemented

Right-click on the canvas should show a context-sensitive menu. This is a fundamental expectation — users instinctively right-click when they don't know where a command lives.

**What it needs to show (context-sensitive):**

| Context | Items |
|---|---|
| Cursor in text | Cut, Copy, Paste, Select All \| Bold, Italic \| Paragraph style |
| Text selected | Cut, Copy, Paste \| Bold, Italic, Clear Formatting \| Link \| Comment |
| Image selected | Copy, Delete \| Resize options |
| Inside table cell | Cut, Copy, Paste \| Insert Row Above/Below, Insert Column Left/Right \| Delete Row, Delete Column, Delete Table \| Merge Cells, Split Cell |
| Spellcheck squiggle | Suggestions list \| Ignore, Add to dictionary |

**Implementation plan:**

1. **Intercept `contextmenu` event** on the container div — `e.preventDefault()` to suppress the browser default, then show our menu:
   ```typescript
   container.addEventListener("contextmenu", this.handleContextMenu);
   ```

2. **Hit-test the click position** — use `charMap.posAtCoords(x, y, page)` (same as mousedown) to determine what was clicked: text, image, table cell, etc.

3. **Build the menu items** from editor state — check `selection.empty`, active marks, node type at cursor. Same logic the toolbar uses for `isActive`.

4. **Render as a DOM overlay** (not canvas) — a `<div>` with `position: fixed`, `z-index: 9999`, `pointer-events: auto`. Positioned at `(e.clientX, e.clientY)` clamped to viewport edges so it never overflows off-screen.

5. **Dismiss on** click outside, Escape, or scroll.

6. **Extension hook** — `addContextMenuItems()` on the Extension API so extensions (Table, Image, SpellCheck) can contribute their own items without coupling to the core menu:
   ```typescript
   addContextMenuItems?(): ContextMenuItem[]
   ```

**Why DOM, not canvas:** Context menus need to be accessible (keyboard nav, screen readers), need to scroll into view, and need to appear above everything including overlays. A DOM `<div>` is the right tool — the menu is not part of the document content.

**Keyboard equivalent:** Shift+F10 (Windows standard) and the Menu key should also open the context menu at the cursor position.

---

## Editing Quality

| Feature | Status | Notes |
|---|---|---|
| Undo / Redo | ✅ Done | History extension |
| Copy / Cut / Paste | ✅ Done | Rich text + markdown |
| Select All (Ctrl+A) | Likely works via PM default | Verify |
| Delete word (Ctrl+Backspace) | Not implemented | `deleteWordBackward` command |
| Duplicate line | Not implemented | |
| Move line up/down | Not implemented | |
| Smart quotes / em dash | ✅ Done | Typography extension |
| Hard break (Shift+Enter) | ✅ Done | |
| Non-breaking space | Not implemented | Ctrl+Shift+Space → `\u00A0` |
| Tab stops in text | Not implemented | Requires ruler integration |
| Drag to move selection | Not implemented | Mouse drag on canvas |

---

---

## Rendering Architecture

### Rotating Canvas Pool (Virtual Scrolling V2)

**Status:** Optional — current approach is already virtualized

The current `ViewManager` already handles large documents well:
- Creates one wrapper `<div>` per page (stays in DOM for all pages)
- Canvases are **detached** when a page scrolls out of view (`detachCanvases`) and only two live canvas elements exist per visible page
- `IntersectionObserver` drives visibility — async, fires on the next task

For a 120-page document, the current approach has **120 wrapper divs + ~8–12 live canvases** (visible pages only). Wrappers are tiny empty divs — the browser handles thousands of them fine.

**What the rotating pool would actually change:**

| | Current | Rotating Pool |
|---|---|---|
| Wrapper divs | 1 per page (N total) | Fixed 6-8 (pool) |
| Live canvases | 2 × visible pages | 2 × pool size |
| Visibility detection | `IntersectionObserver` (async) | scroll event math (sync) |
| Layout | `flex-direction: column` (browser) | `position: absolute` + spacer div (manual) |
| Complexity | Low | Medium |

**When it matters:** Documents with 500+ pages where the 500 wrapper divs measurably affect layout performance. Below that, the current approach is indistinguishable from a pool.

**Real bottleneck today** is not DOM size — it was the layout engine (fixed with the rAF batching + chunked layout work). Measure before switching.

**If we do implement it, the key changes are:**

1. Replace `flex` layout with a `spacer` div that sets total scroll height:
   ```typescript
   spacer.style.height = `${pages.length * (pageHeight + gap)}px`;
   ```

2. Pool creation at init — fixed N wrappers, all `position: absolute`:
   ```typescript
   for (let i = 0; i < MAX_CANVASES; i++) {
     const entry = createPoolEntry();
     pool.push(entry);
     pagesContainer.appendChild(entry.wrapper);
   }
   ```

3. Visible page calculation on scroll (sync, no observer):
   ```typescript
   const start = Math.max(1, Math.floor((scrollTop - overscan) / stride) + 1);
   const end   = Math.min(totalPages, Math.ceil((scrollTop + viewportH + overscan) / stride));
   ```

4. On each scroll/update, return off-screen entries to pool, assign pool entries to new visible pages:
   ```typescript
   for (const [pageNum, entry] of activePages) {
     if (!visibleSet.has(pageNum)) { pool.push(entry); activePages.delete(pageNum); }
   }
   for (const pageNum of visibleSet) {
     if (!activePages.has(pageNum)) {
       const entry = pool.pop()!;
       assignEntryToPage(entry, pageNum);   // repositions the wrapper via translateY
       activePages.set(pageNum, entry);
     }
   }
   ```

5. `getPageElement(page)` looks up `activePages.get(page)?.wrapper ?? null` instead of the per-page map.

**Watch out for:** the `data-page` attribute on wrappers must be updated when reassigned — mouse events use it for page number resolution. And `editor.setPageElementLookup` must point to `activePages` instead of the old per-page map.

**Recommendation:** Implement only if profiling shows DOM layout is the bottleneck for target document sizes. Defer until after Tables, Find & Replace, and line-height controls.

### Frame-Synchronised Paint Pipeline (rAF scheduling)

**Status:** Not implemented — but `CursorManager.resetSilent()` already anticipates it

**What the current system already does well:**
- `lastPaintedVersion !== layout.version` guard — content canvas only repaints when layout changes, not on every cursor blink
- Overlay-only path on blink — cheap: `clearOverlay` + draw cursor, no text re-render
- `CursorManager.resetSilent()` exists specifically for use inside a scheduled flush

**The one remaining problem:** `update()` fires synchronously on every scroll event, every `setInterval` tick, every `editor.subscribe()` call. If 5 scroll events fire in a single 16ms frame, the content and overlay are repainted 5 times — the browser only shows the last one.

**The fix — a one-line scheduler:**

```typescript
private frameRequested = false;

private scheduleFrame = (): void => {
  if (this.frameRequested) return;
  this.frameRequested = true;
  requestAnimationFrame(() => {
    this.frameRequested = false;
    this.update();        // existing update() runs here, unchanged
  });
};
```

Then replace every `this.update()` call-site with `this.scheduleFrame()`:
- `editor.subscribe(() => this.scheduleFrame())`
- `container.addEventListener("scroll", this.scheduleFrame)`
- `observer` callback → `this.scheduleFrame()`

`update()` itself doesn't change at all — the scheduler is purely additive.

**Why this doesn't introduce ghost cursor:** The browser can't paint until the current JS turn completes. `dispatch()` → `scheduleFrame()` → `rAF` → `update()` → browser paints is equivalent to `dispatch()` → `update()` → browser paints from the user's perspective, because in both cases the canvas pixels are ready before the browser's next paint. The rAF just guarantees we don't repaint 5× per frame.

**One subtlety with cursor blink:** `CursorManager.onTick()` calls `scheduleFrame()` (not `update()` directly). Since blink fires at 530ms intervals there's never more than one pending blink per frame — the `frameRequested` guard handles the coalescing transparently.

**What you'll notice after this change:**
- Scroll on a 100-page doc: 1 paint per frame instead of up to 10
- Fast typing: coalesces rapid dispatch calls into one repaint
- Canvas rotation (rotating pool): new page always shows fresh content, never stale pixels from previous page assignment
- Safari: significant improvement (Safari's `setInterval` fires more aggressively than Chrome's)

**Implementation size:** ~15 lines of new code, 4 call-site changes. Low risk, high payoff. Implement before the rotating canvas pool since the pool assumes frame-synchronised painting for flicker-free rotation.

---

## Sequencing Recommendation

Priority order based on user impact:

1. **GDocs paste fix** — high friction for any user coming from GDocs
2. **Line height + space before/after** — core formatting, expected by every user
3. **Find & Replace** — fundamental editing feature
4. **Clear Formatting** — quick win, one command
5. **Ruler + indent controls** — visual formatting, expected in any serious editor
6. **Zoom** — usability for dense documents
7. **Headers / Footers** — needed for professional documents
8. **Word Count** — small but expected
9. **PDF export** (wire existing shell)
10. **DOCX export**
11. **Table of Contents**
12. **Comments / Annotations**
13. **Spell Check**
