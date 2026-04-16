# Scrivr Features Roadmap

Production-grade word processor feature plan for Scrivr. Organised into three layers to prevent the common trap of spending weeks on performance while users still can't change line spacing.

---

## Layer 1 — Editing Quality

*Day-to-day improvements users notice immediately. Ship these first — they determine whether the editor feels "real".*

---

### Paste Quality

#### Google Docs Paste Fix

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

#### Large Paste Optimization

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

### Text Formatting

#### Clear Formatting

**Status:** Not implemented

- Remove all marks from selection
- Command: `clearFormatting()` → `state.tr.removeMark(from, to)` for every mark type in schema
- Keyboard: Ctrl+\\ (standard in Google Docs / Word)

*Ship this early — the paste → clear formatting → reformat workflow is the first thing users try after pasting from GDocs.*

#### Format Painter

**Status:** Not implemented

- Copy the marks at the cursor position
- Next selection gets those marks applied
- Two modes: single-use (click once) and persistent (double-click — keep painting until Escape)
- Store copied marks in editor state or a component-level ref

#### Font Size (fine-grained)
**Status:** Done (FontSize extension exists)

#### Text Color / Highlight
**Status:** Done

#### Superscript / Subscript

**Status:** Not implemented

- New marks: `superscript`, `subscript`
- `resolveFont` applies size reduction (0.65×) and vertical offset
- Commands: `toggleSuperscript`, `toggleSubscript`
- Keyboard: Ctrl+Shift+= / Ctrl+=

---

### Paragraph Formatting

#### Line Height

**Status:** Not implemented

Line height is currently baked into font metrics (ascent + descent + leading). Users expect a "line spacing" control (1.0, 1.15, 1.5, 2.0, or exact px).

- Add `lineHeight` attribute to paragraph and heading nodes (default `1.15`)
- `layoutBlock` multiplies the raw font line height by this factor
- `BlockStyle` gets an optional `lineHeightMultiplier` that extensions can override
- UI: dropdown with presets (Single / 1.15 / 1.5 / Double / Custom)
- Command: `setLineHeight(value: number)`

#### Space Before / Space After

**Status:** Not implemented (hard-coded in `BlockStyle`)

`spaceBefore` and `spaceAfter` are currently static values contributed by extensions via `addBlockStyles()`. Users need per-paragraph control.

- Add `spaceBefore` / `spaceAfter` number attributes to paragraph/heading nodes
- `PageLayout` reads the node attr first, falls back to `blockStyle` default
- UI: "Paragraph spacing" section in a format panel
- Command: `setSpacing({ before?: number, after?: number })`

#### First-Line Indent / Hanging Indent

**Status:** Not implemented

- Add `indent` (left indent, in px or pt) and `firstLineIndent` attributes to paragraph
- `layoutBlock` shifts `x` by `indent` and first-line x by `firstLineIndent`
- Hanging indent = positive `indent` + negative `firstLineIndent`
- Already implied by list item rendering — generalize to all blocks

#### Indentation (Block Level)

**Status:** Partially done (list items use MARKER_RIGHT_GAP)

- `Indent` / `Outdent` commands for paragraphs (increase/decrease left margin by a tab stop, e.g. 36px)
- Keyboard: Tab / Shift-Tab outside lists

---

### Find & Replace

**Status:** Not implemented

Must-have for any word processor.

- **Find** (Ctrl+F): search text across the document, highlight all matches, navigate next/prev
- **Replace** (Ctrl+H): replace one or all matches
- Implementation: pure PM model — walk `doc.descendants()` to find text matches, create `Decoration` highlights via a plugin
- Canvas rendering: match highlights drawn as overlay rectangles (similar to CellSelection overlay)
- UI: floating panel (React component), not canvas

---

### Zoom

**Status:** Not implemented

Affects perceived quality for long contracts and dense documents immediately — even if everything else works, the editor feels unfinished without it.

- `zoom` factor (0.5–2.0) stored in editor state (not doc)
- Affects canvas CSS `transform: scale(zoom)` or canvas pixel dimensions
- ViewManager must account for zoom when translating mouse coords to canvas coords
- Keyboard: Ctrl+= / Ctrl+- / Ctrl+0

---

### Word Count

**Status:** Not implemented

- Live count of words and characters in the document (and in selection)
- Implementation: walk `doc.textContent`, split on whitespace
- Display: status bar or floating badge in the React shell

---

### Spell Check

**Status:** Not implemented (browser native doesn't work on canvas)

Canvas editors lose browser spell-check because text is not in a `contenteditable`. Options:

1. **Browser API:** `Intl.Segmenter` + dictionary lookup (heavy, offline)
2. **Server-side:** Send words to a spell-check endpoint, receive error ranges
3. **`typo.js` or similar WASM dict:** runs client-side, no server needed

Render: red squiggly underline via `decoratePost` in a `SpellCheck` mark decorator.

---

### Context Menu

**Status:** Not implemented

Right-click on the canvas should show a context-sensitive menu.

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

### Editing Quality

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

### Mobile / Touch Input

**Status:** Not implemented — editor is mouse-only

Canvas-based rendering means the browser's native selection doesn't apply. All touch selection UI must be built from scratch.

#### Phase 1 — Basic touch mapping (~30 lines)

Map touch events to mouse equivalents in TileManager:

- `touchstart` → `mousedown` (tap to place cursor)
- `touchmove` → `mousemove` (drag to select)
- `touchend` → `mouseup`

Gets tap-to-cursor and drag-to-select working with zero new UI. Uses existing `charMap.posAtCoords()` → `TextSelection.create()` path.

#### Phase 2 — Selection gestures

- **Long press (500ms)** → select word at touch position (find word boundaries via PM `doc.resolve()`)
- **Double tap** → select word (track tap timing)
- **Triple tap** → select paragraph

#### Phase 3 — Selection handles

- Render two draggable handles (anchor + head) on the overlay canvas after selection
- `touchmove` on a handle → extend selection via `charMap.posAtCoords()`
- Handles styled as iOS/Android blue lollipops
- Hide handles on tap outside selection

#### Phase 4 — Context menu

- Floating cut/copy/paste bar above selection (rendered in DOM, not canvas)
- Show after selection via long press or handle drag
- Actions route through existing `ClipboardSerializer` / `PasteTransformer`

#### Files to touch

- `TileManager.ts` — add touch listeners alongside mouse listeners
- `OverlayRenderer.ts` — render selection handles on overlay canvas
- New `TouchHandler.ts` — long-press timer, gesture detection, handle hit-testing
- `InputBridge.ts` — already positions hidden textarea at cursor for IME (mobile keyboards work today)

#### Notes

- `pointer` events API (normalizes mouse + touch + pen) is worth considering instead of separate touch listeners — but requires careful testing on iOS Safari which has quirks with `pointerdown` on canvas
- Image resize handles already exist in `ResizeController.ts` — selection handles can follow the same pattern (overlay canvas + hit-testing)
- Pinch-to-zoom is out of scope until the zoom feature lands

---

## Layer 2 — Document Professional Features

*What makes Scrivr usable for legal and professional documents. These make the difference between a demo editor and a production tool.*

---

### Ruler

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

### Page Setup

#### Page Margins

**Status:** Hard-coded in `PageLayout` (`margins` object)

- Add margin settings (top, bottom, left, right) to document-level attrs or a `PageSettings` extension
- `PageLayout` reads from doc attrs instead of constants
- UI: Page Setup dialog or drag-able margin lines on the ruler

#### Page Size / Orientation

**Status:** Hard-coded (A4 / Letter)

- Add `pageSize: "A4" | "Letter" | "Legal" | "Custom"` and `orientation: "portrait" | "landscape"` to doc attrs
- `PageLayout` derives `pageWidth`/`pageHeight` from these
- Affects canvas size too — `ViewManager` must resize canvases

#### Page Numbering

**Status:** Partially done (page count displayed in demo UI)

- `{PAGE}` / `{PAGES}` fields in headers/footers (see below)
- "Start at" setting, Roman numerals option

---

### Headers and Footers

**Status:** Not implemented

Repeating content drawn at the top/bottom of every page.

- Add a `header` and `footer` PM node (document-level, not part of the flow content)
- `PageLayout` reserves `headerHeight` / `footerHeight` from page margins
- `PageRenderer` draws header/footer on every page using a separate layout pass
- Headers/footers can contain: text, page number fields `{PAGE}`, `{PAGES}`, images, alignment
- "Different first page" and "different odd/even" options

---

### Automatic Clause / Section Numbering

**Status:** Not implemented

**Why this matters for legal:** Legal documents use deeply nested numbering conventions that are impossible to manage manually — clauses are renumbered when sections are inserted, deleted, or reordered. Word processors handle this automatically; Scrivr must too.

**Numbering formats required:**

| Style | Example |
|---|---|
| Decimal | 1. / 1.1 / 1.1.1 |
| Legal outline | 1. / A. / i. / (a) |
| Alphabetic | A. / B. / C. |
| Roman | I. / II. / III. |
| Custom | ARTICLE 1 / Section 1.1 |

**Model:**

Clause numbering is a document-level feature, not a per-paragraph attribute. The numbering is computed from the heading structure on each render — it is not stored in node attributes.

```typescript
// Document-level plugin state
interface NumberingConfig {
  style: 'decimal' | 'legal' | 'alpha' | 'roman';
  levels: number;         // how many nesting levels to number (1–6)
  separator: string;      // '.' for decimal, ')' for (a) style
  prefix?: string;        // 'ARTICLE' for ARTICLE 1 style
  autoRestart: boolean;   // restart counters when a higher level is seen
}
```

**Implementation plan:**

1. **`NumberingPlugin`** — a ProseMirror plugin that walks the doc on each state change, counts headings by level, and stores the computed labels in plugin state:
   ```typescript
   // Walk doc.descendants() — heading nodes at level N increment counter[N-1]
   // and reset all counters for N+1 through max
   // Output: Map<nodePos, label> e.g. { 5 → "1.2.3" }
   ```

2. **Canvas rendering** — `HeadingStrategy` reads the numbering plugin state and prepends the label to the rendered text. This avoids storing numbers in the doc (so they don't appear in JSON exports raw) while keeping the canvas display in sync.

3. **PDF export** — the computed label is included in the pdf-lib text draw call alongside the heading text.

4. **Commands:**
   ```typescript
   editor.commands.setNumberingStyle(config: NumberingConfig): boolean
   editor.commands.clearNumbering(): boolean
   editor.commands.setNumberingStart(level: number, start: number): boolean // manual override
   ```

5. **UI:** A "Numbering" panel in the format toolbar. Level-by-level configuration is advanced — ship single-style doc-level numbering first, per-level config later.

---

### Track Changes

**Status:** Substantially complete — engine, rendering, and AI pipeline are production-ready

Track Changes is one of the most critical features for legal document workflows. Legal professionals collaborate by redlining — insertions and deletions must be visible and attributable.

**What's done:**

The `TrackChanges` extension in `@scrivr/plugins` is far more complete than a typical "in progress" plugin:

- **Schema** — `trackedInsert` and `trackedDelete` marks with `excludes: ""` so multiple authors can stack their marks on the same text segment without collision
- **8 tracked operations** — `insert`, `delete`, `set_node_attributes`, `wrap_with_node`, `node_split`, `reference`, `move`, `structure`
- **All PM step types handled** — `ReplaceStep`, `AttrStep`, `AddMarkStep`, `RemoveMarkStep`, and node-mark variants (only `ReplaceAroundStep` for lift/wrap deferred)
- **Multi-author support** — mark stacking via `excludes: ""` means author A's delete and author B's insert can coexist on the same text; each carries its own `authorID`
- **Conflict detection** — `findChanges()` computes `isConflict: true` at read-time for two pending changes from different authors that overlap with opposing operations; this is not mutated on the marks, computed fresh each render
- **Accept / Reject** — two-pass `applyChanges()` handles text, node attributes, and move operations; `setChangeStatuses(status, ids)` command accepts an array of IDs
- **Canvas rendering** — `onEditorReady` registers an overlay handler that draws inserts in a 6-shade green family (rotated by author ID hash), deletes in a 6-shade red family, and conflicts in amber (rendered on top); deduplicates when two authors share the same pixel
- **Conflict popover** — headless `createChangePopover(editor, callbacks)` controller fires `onShow(rect, info)`, `onMove`, and `onHide`. `info.conflictChanges` carries all overlapping parties so the React layer can render per-author accept/reject buttons
- **AI suggestion pipeline** — `insertAsSuggestion(text, from, to, authorID)` and `applyDiffAsSuggestion({ nodeId, proposedText, authorID })` insert AI edits as tracked changes using a legal-aware LCS tokenizer with character-level refinement and `groupId` pairing so delete + insert pairs can be accepted/rejected atomically
- **`ChangeSet` API** — `changeSet.changes`, `.pending`, `.groupChanges`, `.changeTree`, `.get(id)`, `.hasDuplicateIds`, `.hasInconsistentData`

Configuration:
```typescript
TrackChanges.configure({
  initialStatus: 'tracking' | 'accepting' | 'off',
  userID: string,
  canAcceptReject: boolean,
  skipTrsWithMetas: (PluginKey | string)[],
})
```

Commands: `setTrackingStatus(status?)`, `setChangeStatuses(status, ids)`, `setTrackChangesUserID(userID)`, `refreshChanges()`, `insertAsSuggestion(text, from, to, authorID)`

**What's still needed:**

1. **Review panel UI (React)** — `ChangeSet` provides all the data; the sidebar component itself (list of changes sorted by doc position, author avatars, timestamps, accept/reject buttons, "accept all" shortcut) needs to be built in the React layer. The headless popover controller is already wired — this is a UI-only task.

2. **Batch accept / reject commands** — `setChangeStatuses` supports an array of IDs but there is no `acceptAllChanges()` / `rejectAllChanges()` convenience command yet. Trivial to add.

3. **Move operation canvas rendering** — move changes are tracked and linked via `moveNodeId` but the canvas overlay does not yet render them distinctly from inserts/deletes.

4. **`ReplaceAroundStep` tracking** — lift and wrap operations (e.g. promoting a paragraph into a list) are deferred; they will need a dedicated handler.

5. **Table cell tracking** — will need integration once tables are implemented.

6. **`filterTransaction` composability with Block-Level Access Control** — when both plugins are active, locked blocks must block edits regardless of whether tracking is on. The two `filterTransaction` hooks must be ordered correctly (locking runs first).

---

### Defined Terms / Term Highlighting

**Status:** Not implemented

**Why this matters for legal:** Legal documents define terms once (e.g. `"Effective Date" means...`) and reference them throughout. Today, a drafter has no way to know if a defined term is used inconsistently, undefined, or defined but never referenced. This is a source of legal error and costly negotiation.

**Phase 1 — Term detection and highlighting:**

- User marks a span as a "defined term" via a command or context menu item
- `DefinedTerm` mark stored with `{ term: string, id: string }` attrs
- Canvas: defined terms rendered with a subtle dotted underline (different from regular underline)
- All uses of the same term string (case-insensitive) highlighted automatically via a ProseMirror `DecorationSet`

```typescript
// Example usage:
editor.commands.defineterm('Effective Date');
// → all occurrences of "Effective Date" in the doc get a DefinedTermRef decoration
```

**Phase 2 — Term consistency validation:**

- A `getDefinedTerms()` method returns all terms with definition count and reference count
- If a term is defined but never referenced → warn
- If a term is referenced but not defined → warn
- If a term is defined more than once → error
- Surface warnings in a sidebar panel

**Phase 3 — Navigation:**

- Click a term reference → jump to its definition
- "Find all uses" from the definition → shows all references in a list
- "Rename term" → updates definition and all references in one transaction

**Schema:**

```typescript
// Mark for the authoritative definition site
definedTermDef: { attrs: { term: string, id: string } }

// Decoration (not a mark) for reference sites — so references don't enter the doc model
// They are recomputed from plugin state on every render
```

---

### Block-Level Access Control (Read-Only Ranges)

**Status:** Not implemented

**The problem:** Legal documents are not uniformly editable. A contract template has boilerplate clauses that must stay locked (firm's standard terms, liability caps, governing law) alongside editable fields (party names, dates, deal-specific terms). Today, Scrivr treats the entire document as a single editable surface — there is no way to mark a paragraph or range as read-only while keeping the rest editable.

**Model:**

Locked ranges are stored as node attributes so they persist in the JSON doc and sync across Yjs sessions.

```typescript
// Add to all block nodes:
attrs: {
  locked: { default: false },
  lockedBy: { default: null }, // optional: userId who locked it
}
```

**Implementation plan:**

1. **ProseMirror plugin — transaction filter:**
   ```typescript
   filterTransaction(tr, state) {
     if (tr.getMeta('bypass-lock')) return true; // escape hatch for programmatic edits
     for (const step of tr.steps) {
       const { from, to } = step;
       state.doc.nodesBetween(from, to, (node) => {
         if (node.attrs['locked']) return false; // block the transaction
       });
     }
     return true;
   }
   ```

2. **Visual indicator** — locked blocks draw a subtle background tint (`rgba(0,0,0,0.03)`) and a 2px grey left border stripe so users can see which regions are locked at a glance.

3. **Cursor feedback** — the caret appears in locked blocks (read selection is allowed) but renders grey instead of black. Keyboard input is silently swallowed.

4. **Commands:**
   ```typescript
   editor.commands.lockBlock(pos: number): boolean
   editor.commands.unlockBlock(pos: number): boolean
   editor.commands.lockSelection(): boolean
   editor.commands.unlockAll(): boolean
   ```

5. **Template authoring vs. filling — two modes:**
   ```typescript
   editor.commands.setEditMode('author')  // all blocks editable, can toggle locked attr
   editor.commands.setEditMode('fill')    // locked blocks enforced, free blocks editable
   ```
   In `fill` mode, the lock/unlock commands are disabled and the toolbar hides irrelevant controls.

6. **Track Changes integration:** Locked blocks also suppress track-changes transactions — no tracked insertions or deletions are permitted inside a locked range.

**Inline locked fields (Phase 2):**

Beyond block-level locking, legal templates often have inline placeholders: `[PARTY NAME]`, `[DATE]`. These need a dedicated `lockedField` inline node — a read-only text span that the user can only replace by accepting a structured value (from a form or data merge).

**Sequencing:** Implement after Track Changes stabilises, as both use `filterTransaction` and must compose cleanly.

---

### Comments / Annotations

**Status:** Not implemented

Inline comments visible in a sidebar.

- `comment` mark with `id`, `authorId`, `createdAt` attrs (similar to `trackChange` mark)
- Comment thread stored outside the doc (in Y.js awareness or a separate data structure)
- Sidebar panel: shows threads sorted by doc position
- Canvas overlay: draws a bracket or highlight for the commented range

---

### Table of Contents

**Status:** Not implemented

Auto-generated from heading nodes.

- `toc` node — a leaf block that re-renders based on the current heading structure
- `updateToc()` command — scans `doc.descendants()` for heading nodes, builds entries with dotted leaders and page numbers
- Page numbers come from `CharacterMap.posAtPage()` — heading nodePos → page
- Manual update (button) first; auto-update on each render is too expensive
- When Clause Numbering is active, TOC entries include the computed numbering label

---

### Export

#### PDF — Searchable Text Layer

**Status:** Shell exists (`@scrivr/export`)

Do not use the canvas raster path (`toDataURL → embed as image`) — that produces PDFs where text is baked into pixels: not selectable, not searchable, not court-submittable. Use pdf-lib's text API instead.

Walk `DocumentLayout` (which already knows exactly where every glyph sits) and emit PDF text operations directly:

```typescript
import { PDFDocument } from 'pdf-lib';

const pdfDoc = await PDFDocument.create();
for (const page of layout.pages) {
  const pdfPage = pdfDoc.addPage([pageWidthPt, pageHeightPt]);
  for (const block of page.blocks) {
    for (const line of block.lines) {
      for (const span of line.spans) {
        if (span.kind !== 'text') continue;
        pdfPage.drawText(span.text, {
          x: pxToPt(span.x),
          y: pdfPage.getHeight() - pxToPt(span.y), // flip y-axis
          font: fontMap.get(span.resolvedFont)!,
          size: pxToPt(span.fontSize),
          color: rgb(span.color),
        });
      }
    }
  }
}
```

Marks via pdf-lib drawing primitives:
- Underline / Strikethrough → `pdfPage.drawLine(...)`
- Highlight → `pdfPage.drawRectangle(...)` before the text span
- Color → `color` option on `drawText`

#### PDF Custom Font Embedding

**Status:** Not implemented (canvas rasterizes glyphs — embedded fonts need separate pipeline)

When the document uses a custom font (firm letterhead typeface, specific contract serif), the PDF must embed that font's outlines so text reflows identically when printed or opened on a machine without the font installed.

```typescript
import fontkit from '@pdf-lib/fontkit';

const pdfDoc = await PDFDocument.create();
pdfDoc.registerFontkit(fontkit);

// Per unique font family:
const fontBytes = await fontResolver('MyFont', 'normal', 'normal');
if (fontBytes) {
  const embeddedFont = await pdfDoc.embedFont(fontBytes);
  fontMap.set('MyFont normal normal', embeddedFont);
}
```

**API:**

Phase 1 (standard fonts, fully searchable):
```typescript
exportToPdf(editor: Editor): Promise<Uint8Array>
```

Phase 2 (custom font embedding):
```typescript
exportToPdf(editor: Editor, options?: {
  fontResolver?: (
    family: string,
    weight: 'normal' | 'bold',
    style: 'normal' | 'italic',
  ) => Promise<ArrayBuffer | null>;
}): Promise<Uint8Array>
```

The `fontResolver` is called once per unique `(family, weight, style)` combination and the result is cached for the export. When it returns `null`, fall back to the nearest standard font (Helvetica / Times / Courier).

**Implementation order:**
1. Switch PDF path from canvas raster to pdf-lib text API — produces searchable PDFs with standard fonts
2. Add `fontResolver` option — unlocks custom/branded typefaces
3. Handle marks (underline, highlight, color) via pdf-lib drawing primitives
4. Handle inline images via `pdfDoc.embedPng` / `pdfDoc.embedJpg`

#### DOCX

**Status:** Stub

- Use `docx` npm package (pure JS, no server)
- Walk PM doc → emit DOCX XML nodes
- Handles: paragraphs, headings, bold/italic/underline, lists, images, tables (once implemented)

#### Markdown

**Status:** Done (MarkdownSerializer exists)

---

## Layer 3 — Engine & Performance

*Invisible to users but critical for large documents. Don't spend time here while Layer 1 and 2 features are outstanding.*

---

### Rendering Architecture

#### Frame-Synchronised Paint Pipeline (rAF scheduling)

**Status:** Not implemented — but `CursorManager.resetSilent()` already anticipates it

**What the current system already does well:**
- `lastPaintedVersion !== layout.version` guard — content canvas only repaints when layout changes, not on every cursor blink
- Overlay-only path on blink — cheap: `clearOverlay` + draw cursor, no text re-render
- `CursorManager.resetSilent()` exists specifically for use inside a scheduled flush

**The one remaining problem:** `update()` fires synchronously on every scroll event, every `setInterval` tick, every `editor.subscribe()` call. If 5 scroll events fire in a single 16ms frame, the content and overlay are repainted 5 times.

**The fix — a one-line scheduler:**

```typescript
private frameRequested = false;

private scheduleFrame = (): void => {
  if (this.frameRequested) return;
  this.frameRequested = true;
  requestAnimationFrame(() => {
    this.frameRequested = false;
    this.update(); // existing update() runs here, unchanged
  });
};
```

Then replace every `this.update()` call-site with `this.scheduleFrame()`. `update()` itself doesn't change at all.

**What you'll notice after this change:**
- Scroll on a 100-page doc: 1 paint per frame instead of up to 10
- Fast typing: coalesces rapid dispatch calls into one repaint
- Safari: significant improvement (Safari's `setInterval` fires more aggressively than Chrome's)

**Implementation size:** ~15 lines of new code, 4 call-site changes. Low risk, high payoff. Implement before the rotating canvas pool since the pool assumes frame-synchronised painting for flicker-free rotation.

#### Rotating Canvas Pool (Virtual Scrolling V2)

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

**Recommendation:** Implement only if profiling shows DOM layout is the bottleneck for target document sizes. Defer until after Tables, Find & Replace, and line-height controls.

---

### Typographic Justification Quality

*Moving justified text from "word-spacing only" to TeX-grade margin precision.*

**Status:** Not implemented — current justification stretches spaces only via `spaceBonus` in `computeJustifySpaceBonus()`

The current greedy line breaker + space-only justification produces uneven "grayness" in justified paragraphs: loose lines with rivers of white space next to tight lines. Professional typesetting engines (TeX, InDesign) solve this with five complementary techniques.

#### 1. Soft Hyphenation

**Priority:** High (biggest single improvement)

Long words that miss the line cutoff force the entire word to the next line, leaving a massive gap. A pattern-based hyphenator (e.g. Hypher or TeX hyphenation patterns) inserts soft-wrap opportunities into long words during tokenization.

**Implementation:**
- During `LineBreaker.breakIntoLines()` tokenization phase, run words through a hyphenation engine
- When a word doesn't fit the remaining line width, try hyphenation points before pushing the whole word to the next line
- Insert a visible hyphen (`-`) at the break point
- Reduces `spaceBonus` required to fill lines, immediately improving paragraph density

#### 2. Micro-Typography: Font Expansion/Compression

**Priority:** Medium

Instead of only stretching spaces, slightly stretch or compress the characters themselves. Humans cannot perceive horizontal scaling of ±2%.

**Implementation:**
- In `TextBlockStrategy`, when `spaceBonus` is needed, distribute a portion (up to ±1-2%) as horizontal font scaling via `ctx.setTransform(expansionFactor, 0, 0, 1, charX, baseline)`
- Results in much more even paragraph "grayness" because word spacing stays closer to the font's natural design
- Apply expansion before space-stretching — use space adjustment only for the remainder

#### 3. Optical Margin Alignment (Hanging Punctuation)

**Priority:** Medium

Punctuation characters (`.` `,` `-` `"` `'`) have significant internal white space. When they sit flush at the margin, the visual edge looks ragged even though the bounding box is aligned.

**Implementation:**
- In `TextBlockStrategy`, allow trailing punctuation to overshoot `maxWidth` by 50-100% of the punctuation character's width (~5-8px)
- Leading quotation marks hang into the left margin by a similar amount
- Purely a rendering adjustment — no line-breaking changes needed
- Creates a much harder, cleaner visual edge on justified and left-aligned blocks

#### 4. Flush-Left Threshold (Anti-Blowout)

**Priority:** High (small change, prevents worst-case artifacts)

If a non-last line is less than ~85% full, justifying it produces grotesque spacing. Force these lines to left-align instead.

**Implementation:**
- In `computeJustifySpaceBonus()`, add: if `extraSpace / availableWidth > 0.15`, return `0`
- Prevents "white-space blowouts" where two or three words are stretched across the full line width
- The second-to-last line before a short final line is the most common trigger

#### 5. Multi-Pass Line Breaking (Knuth-Plass)

**Priority:** Low (highest complexity, diminishing returns after hyphenation)

The current greedy breaker fills each line maximally, which can leave subsequent lines in impossible states. A Knuth-Plass-style algorithm minimizes total paragraph "badness" by considering all possible break points simultaneously.

**Implementation:**
- Replace or augment the greedy loop in `LineBreaker.breakIntoLines()` with a dynamic-programming pass
- Define "badness" per line as a function of `spaceBonus` magnitude
- Minimize total badness across all lines in the paragraph
- Falls back to greedy for very long paragraphs (performance bound)

**Recommended implementation order:**
1. Flush-left threshold — 5 lines of code, prevents worst artifacts immediately
2. Soft hyphenation — biggest quality improvement, moderate complexity
3. Hanging punctuation — rendering-only change, no line-breaking risk
4. Font expansion — requires careful per-character rendering changes
5. Knuth-Plass — only after 1-4 are stable; most users won't notice the difference over hyphenation alone

**Key files:**
- `LineBreaker.ts` — tokenization and line-breaking decisions
- `BlockLayout.ts` — `computeJustifySpaceBonus()` for flush-left threshold
- `TextBlockStrategy.ts` — rendering with `spaceBonus`, expansion, and hanging punctuation
- `TextMeasurer.ts` — width measurement (may need ±expansion variant)

---

## Sequencing Recommendation

Priority order for Lexa (legal document editing focus):

**Layer 1 — Ship these first:**

1. **GDocs paste fix** — high friction for any user coming from GDocs or Word
2. **Clear formatting** — users immediately try paste → clear → reformat
3. **Line height + space before/after** — paragraph spacing is how users judge editor quality
4. **Find & Replace** — fundamental; lawyers search contracts constantly
5. **Zoom** — psychological completeness for dense documents
6. **Ruler + indent controls** — visual formatting expected in any serious editor
7. **Headers / Footers + Page Numbering** — the moment page numbers work, the editor becomes "real"
8. **Word Count** — small but expected

**Layer 2 — Professional features (run in parallel where possible):**

9. **PDF export — searchable text layer** (Phase 1: pdf-lib text API, standard fonts)
10. **PDF custom font embedding** (Phase 2: `fontResolver` for firm typefaces)
11. **Automatic Clause / Section Numbering** — the biggest missing legal-grade feature
12. **Track Changes** — complete multi-author support and review panel; lawyers won't switch from Word without this
13. **Block-Level Access Control** — after Track Changes stabilises; unlocks template workflows
14. **Defined Terms / Term Highlighting** — differentiating feature; almost no editors do this
15. **DOCX export** — required for interop with opposing counsel
16. **Comments / Annotations**
17. **Table of Contents**
18. **Spell Check**

**Layer 3 — Engine (only when profiling shows it's needed):**

19. **rAF paint pipeline** — 15 lines, implement early for Safari; doesn't block anything
20. **Typographic justification** — flush-left threshold and hyphenation first; hanging punctuation, expansion, and Knuth-Plass later
21. **Rotating canvas pool** — only if 500+ page documents show DOM bottleneck
