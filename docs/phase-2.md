# Phase 2 — Interactive Editing

**Goal:** A user can click to place a cursor, type, delete, select, and apply bold/italic.
**Prerequisite:** Phase 1 complete — document renders correctly on canvas, CharacterMap is populated JIT during rendering.

---

## Mental Model

Phase 1 made the canvas a **display surface**. Phase 2 makes it an **editing surface**.

The core loop we are building:

```
User input (keyboard / mouse)
        ↓
ProseMirror Transaction
        ↓
New EditorState  →  layoutDocument()  →  new DocumentLayout
        ↓
Re-render pages  →  re-populate CharacterMap
        ↓
Draw cursor / selection rectangles on overlay canvas
```

Every step of this loop already exists in skeleton form from Phase 1. Phase 2 wires them together and fills in the missing pieces.

---

## Step 1 — Fix Editor Container Positioning

**Problem:** The hidden `<textarea>` currently sits at `position: absolute; top: 0; left: 0` and is invisible. This is fine for input, but the browser's native spell-check, autocomplete, and virtual keyboard on mobile all position relative to the textarea's bounding rect. If the textarea doesn't move with the cursor, these UI elements appear in the wrong place.

**What to do:**

1. After every cursor move, compute the cursor's pixel position via `CharacterMap.coordsAtPos(selection.head)`.
2. Translate that position from page-local coordinates to scroll-container coordinates (add the page's `offsetTop` + the scroll container's `scrollTop`).
3. Move the textarea to that position: `textarea.style.transform = "translate(x px, y px)"`.

This keeps the textarea at the cursor without affecting layout (transforms don't trigger reflow).

**Files to touch:**
- `packages/core/src/Editor.ts` — `updateTextareaPosition()`
- `apps/demo/src/App.tsx` — pass scroll container ref to Editor so it can compute offsets

**Test:** Click in the middle of a word. Open DevTools → inspect the textarea element. Its transform should match the cursor pixel position.

---

## Step 2 — Cursor Rendering

**Architectural decision: dual-canvas overlay per page**

Each `PageView` gets **two stacked canvases**:

```
┌─────────────────────────┐
│  content canvas         │  ← text, background (redrawn on doc change)
│  ┌───────────────────┐  │
│  │  overlay canvas   │  │  ← cursor + selection (redrawn on cursor/selection change)
│  └───────────────────┘  │
└─────────────────────────┘
```

Both canvases are `position: absolute; top: 0; left: 0` inside the page div. The overlay canvas has `pointer-events: none` so clicks pass through to the page div below.

**Why dual canvas, not redrawing everything on blink?**
Blinking the cursor at 530ms intervals means potentially 2 redraws per second per visible page. Redrawing full pages (text, backgrounds) for a blink is wasteful and can cause flicker. The overlay canvas is cheap — it only draws a 1–2px line or selection rectangles.

**Cursor rendering algorithm:**

```typescript
function renderCursor(overlayCtx, selection, charMap, pageNumber, dpr) {
  clearOverlay(overlayCtx);   // transparent clear
  if (selection.empty) {
    const coords = charMap.coordsAtPos(selection.head);
    if (!coords || coords.page !== pageNumber) return;
    overlayCtx.save();
    overlayCtx.scale(dpr, dpr);
    overlayCtx.strokeStyle = "#000";
    overlayCtx.lineWidth = 1.5;
    overlayCtx.beginPath();
    overlayCtx.moveTo(coords.x, coords.y - coords.ascent);
    overlayCtx.lineTo(coords.x, coords.y + coords.descent);
    overlayCtx.stroke();
    overlayCtx.restore();
  }
}
```

**Blink timer:**

```typescript
// In Editor.ts
private blinkHandle = 0;
private cursorVisible = true;

startBlink() {
  this.stopBlink();
  this.cursorVisible = true;
  const tick = () => {
    this.cursorVisible = !this.cursorVisible;
    this.onCursorBlink?.(this.cursorVisible);
    this.blinkHandle = window.setTimeout(tick, 530);
  };
  this.blinkHandle = window.setTimeout(tick, 530);
}

stopBlink() {
  clearTimeout(this.blinkHandle);
  this.cursorVisible = true;  // always show immediately on interaction
}
```

Reset the blink timer on every keypress and click so the cursor is always solid after an action.

**Files to create/touch:**
- `packages/core/src/renderer/OverlayRenderer.ts` — `renderCursor()`, `renderSelection()`, `clearOverlay()`
- `packages/core/src/Editor.ts` — blink timer, `onCursorBlink` callback
- `apps/demo/src/PageView.tsx` — add overlay `<canvas>`, call `renderCursor` on blink and selection change

**Test:** Focus the editor. A blinking cursor should appear at position 0 (start of the first paragraph). It should blink at approximately 1Hz.

---

## Step 3 — Click-to-Cursor Hit Testing

**What we have:** `CharacterMap.posAtCoords(x, y, pageNumber)` already exists and returns a ProseMirror integer position.

**What we need:** Wire the mouse click on a page div to call it and update the ProseMirror selection.

**Algorithm:**

```typescript
// In PageView.tsx (or bubbled up through a callback prop)
function handleClick(e: MouseEvent) {
  const rect = pageDiv.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const docPos = charMap.posAtCoords(x, y, page.pageNumber);
  if (docPos !== null) {
    editor.setSelection(docPos, docPos);  // collapsed = cursor
  }
}
```

**`Editor.setSelection(anchor, head)`** — new method:

```typescript
setSelection(anchor: number, head: number) {
  const { tr } = this.state;
  tr.setSelection(TextSelection.create(this.state.doc, anchor, head));
  this.dispatch(tr);
}
```

**What `posAtCoords` does (for reference):**

1. Find all glyphs on the given page.
2. Find the line whose y-range contains the click y.
3. Within that line, find the glyph whose midpoint (`x + width/2`) is closest to click x.
4. Return that glyph's `docPos`.

**Edge cases:**
- Click above all content → position 0
- Click below all content → last position in doc
- Click on an empty paragraph → return the virtual `\u200B` glyph's position (which maps to the paragraph's start)

**Files to touch:**
- `packages/core/src/layout/CharacterMap.ts` — verify `posAtCoords` handles edge cases
- `packages/core/src/Editor.ts` — add `setSelection()`, expose selection via `getState()`
- `apps/demo/src/PageView.tsx` — add `onClick` handler, pass `editor` ref or callback

**Test:** Click on a word in the middle of the document. The cursor should appear inside that word, at the character boundary closest to where you clicked.

---

## Step 4 — Arrow Key Navigation

**Horizontal arrows (← →):**

```typescript
case "ArrowRight":
  const pos = Math.min(state.selection.head + 1, state.doc.content.size);
  editor.setSelection(pos, pos);
  break;
```

Simple position increment/decrement respects ProseMirror's position model — it naturally skips node boundaries (e.g., stepping from the last character of paragraph 1 into paragraph 2 takes 2 increments: one to cross the paragraph closing token, one into the next paragraph's content).

**Vertical arrows (↑ ↓) — the tricky part:**

1. Get current cursor pixel coords from `CharacterMap.coordsAtPos(head)`.
2. Target y = `coords.y ± lineHeight` (use `line.height` from the LayoutBlock).
3. Call `charMap.posAtCoords(coords.x, targetY, pageNumber)`.
4. If `targetY` is above the first line of the page, move to previous page and use `posAtCoords` at the bottom of that page.

**Shift + arrow = extend selection:**

```typescript
case "ArrowRight":
  const anchor = e.shiftKey ? state.selection.anchor : newHead;
  editor.setSelection(anchor, newHead);
  break;
```

**Files to touch:**
- `packages/core/src/Editor.ts` — `handleKeydown` extended with arrow key cases

**Test:** Place cursor in the middle of a paragraph. Press ↓ three times. Cursor should move down 3 lines, maintaining approximate x position. At the last line of a page, pressing ↓ should move to the first line of the next page.

---

## Step 5 — Selection Model and Rendering

**ProseMirror selection is already a range:** `state.selection.anchor` and `state.selection.head`. When `anchor !== head`, we have a text selection.

**Rendering selection rectangles:**

```typescript
function renderSelection(overlayCtx, selection, charMap, pageNumber, dpr) {
  clearOverlay(overlayCtx);
  if (selection.empty) return;

  const from = Math.min(selection.anchor, selection.head);
  const to = Math.max(selection.anchor, selection.head);
  const glyphs = charMap.glyphsInRange(from, to, pageNumber);

  // Group glyphs by line, draw one rect per line
  const lineRects = groupGlyphsByLine(glyphs);
  overlayCtx.save();
  overlayCtx.scale(dpr, dpr);
  overlayCtx.fillStyle = "rgba(0, 120, 215, 0.25)";
  for (const rect of lineRects) {
    overlayCtx.fillRect(rect.x, rect.y - rect.ascent, rect.width, rect.ascent + rect.descent);
  }
  overlayCtx.restore();
}
```

**Click + drag:**

```typescript
pageDiv.addEventListener("mousedown", (e) => {
  const startPos = posAtClick(e);
  editor.setSelection(startPos, startPos);

  const onMove = (e: MouseEvent) => {
    const endPos = posAtClick(e);
    editor.setSelection(startPos, endPos);
  };

  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
});
```

**Files to touch:**
- `packages/core/src/renderer/OverlayRenderer.ts` — add `renderSelection()`
- `packages/core/src/layout/CharacterMap.ts` — add `glyphsInRange(from, to, page)`
- `apps/demo/src/PageView.tsx` — `mousedown`/`mousemove`/`mouseup` handlers

**Test:** Click and drag across two lines. Blue highlight should cover the exact characters selected, breaking correctly at line ends. Shift+click should extend the selection from the original anchor.

---

## Step 6 — Bold/Italic Toolbar

**What "active state" means:** If the ProseMirror selection covers text where every character has the bold mark, the bold button should appear pressed.

**Detecting active marks:**

```typescript
function isMarkActive(state: EditorState, markType: MarkType): boolean {
  const { from, to, empty } = state.selection;
  if (empty) {
    return markType.isInSet(state.storedMarks ?? state.selection.$from.marks()) !== null;
  }
  return state.doc.rangeHasMark(from, to, markType);
}
```

**Toolbar component (React):**

```tsx
function Toolbar({ editorRef }: { editorRef: React.RefObject<Editor> }) {
  const [boldActive, setBoldActive] = useState(false);
  const [italicActive, setItalicActive] = useState(false);

  // Subscribe to selection changes via Editor.onSelectionChange callback
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.onSelectionChange = (state) => {
      setBoldActive(isMarkActive(state, schema.marks.bold));
      setItalicActive(isMarkActive(state, schema.marks.italic));
    };
  }, [editorRef]);

  return (
    <div style={toolbarStyle}>
      <button
        style={boldActive ? activeStyle : buttonStyle}
        onMouseDown={(e) => { e.preventDefault(); editorRef.current?.toggleBold(); }}
      >
        B
      </button>
      <button
        style={italicActive ? activeStyle : buttonStyle}
        onMouseDown={(e) => { e.preventDefault(); editorRef.current?.toggleItalic(); }}
      >
        I
      </button>
    </div>
  );
}
```

Note: `onMouseDown` + `e.preventDefault()` prevents the editor from losing focus when clicking toolbar buttons.

**Files to create/touch:**
- `apps/demo/src/Toolbar.tsx` — new component
- `packages/core/src/Editor.ts` — `onSelectionChange` callback, `toggleBold()`, `toggleItalic()` public methods
- `apps/demo/src/App.tsx` — render `<Toolbar>` above the main area

**Test:** Select "hello". Click B. "hello" should appear bold in the canvas. Click B again. Bold removed. With no selection, position cursor inside a bold word — B button should appear active.

---

## Commit Plan

| Commit | What's in it |
|---|---|
| `feat: fix textarea positioning to track cursor` | Step 1 — textarea tracks cursor pixel position |
| `feat: dual-canvas overlay with cursor rendering and blink` | Step 2 — overlay canvas, OverlayRenderer, blink timer |
| `feat: click-to-cursor via CharacterMap hit testing` | Step 3 — mouse click → ProseMirror position → cursor |
| `feat: arrow key navigation with selection support` | Step 4 — ← → ↑ ↓ and shift variants |
| `feat: text selection model, drag select, selection rendering` | Step 5 — selection rectangles, drag, shift+click |
| `feat: bold/italic toolbar with active-state detection` | Step 6 — toolbar component, mark detection |

---

## Step 7 — Paste Handling (The "Portal" Pattern)

The hidden `<textarea>` is our input bridge. Because it's a real DOM element, it naturally receives `paste` events — we just need to intercept and route them.

**Why this is different from a normal editor:**
A DOM editor can intercept paste on the `contenteditable` div and let the browser handle HTML-to-DOM conversion. We can't do that on a canvas. The textarea bridge solves this because the browser fires `paste` on focused form elements, giving us access to `event.clipboardData`.

**Implementation:**

```typescript
// In Editor.ts — mount() setup
this.textarea.addEventListener("paste", this.handlePaste);

private handlePaste = (e: ClipboardEvent) => {
  e.preventDefault(); // never let the browser insert into the textarea

  const clipData = e.clipboardData;
  if (!clipData) return;

  // Priority: HTML > plain text
  const html = clipData.getData("text/html");
  const text = clipData.getData("text/plain");

  let slice: Slice;

  if (html) {
    // ProseMirror's DOMParser turns clipboard HTML into a valid Slice
    // It handles nested marks, lists, tables — a decade of edge cases solved
    const dom = new DOMParser().parseFromString(html, "text/html");
    slice = ProseMirrorDOMParser
      .fromSchema(schema)
      .parseSlice(dom.body, { preserveWhitespace: true });
  } else {
    // Plain text: split on newlines → paragraphs
    slice = plainTextToSlice(text, schema);
  }

  // Allow the paste to be filtered before it hits the doc
  const filtered = this.options.transformPaste?.(slice) ?? slice;

  const tr = this.state.tr.replaceSelection(filtered);
  this.dispatch(tr);
};
```

**`plainTextToSlice` helper:**

```typescript
function plainTextToSlice(text: string, schema: Schema): Slice {
  const paragraphs = text.split(/\r?\n/).map((line) =>
    schema.nodes.paragraph.create(
      null,
      line ? [schema.text(line)] : []
    )
  );
  return new Slice(Fragment.from(paragraphs), 1, 1);
}
```

**`transformPaste` hook — extensibility point:**

```typescript
// Editor options
interface EditorOptions {
  onChange?: (state: EditorState) => void;
  transformPaste?: (slice: Slice) => Slice;  // NEW
}

// Consumer example: strip colors but keep bold
const editor = new Editor({
  transformPaste: (slice) => stripMarks(slice, ["color", "font_family"]),
});
```

This is the hook that makes paste useful for open source consumers. A legal SaaS app can strip all formatting from pasted content. A rich editor can preserve everything.

**Files to touch:**
- `packages/core/src/Editor.ts` — `handlePaste`, `transformPaste` option
- `packages/core/src/model/` — `plainTextToSlice` helper
- `packages/core/src/index.ts` — export `plainTextToSlice` for consumers who build their own `transformPaste`

**Test:** Copy a paragraph from a web page (with bold, links, etc.). Paste into the editor. Text should appear. With `transformPaste: stripAllMarks`, it should paste as plain text. With no filter, bold should be preserved.

---

## Commit Plan

| Commit | What's in it |
|---|---|
| `feat: fix textarea positioning to track cursor` | Step 1 — textarea tracks cursor pixel position |
| `feat: dual-canvas overlay with cursor rendering and blink` | Step 2 — overlay canvas, OverlayRenderer, blink timer |
| `feat: click-to-cursor via CharacterMap hit testing` | Step 3 — mouse click → ProseMirror position → cursor |
| `feat: arrow key navigation with selection support` | Step 4 — ← → ↑ ↓ and shift variants |
| `feat: text selection model, drag select, selection rendering` | Step 5 — selection rectangles, drag, shift+click |
| `feat: bold/italic toolbar with active-state detection` | Step 6 — toolbar component, mark detection |
| `feat: paste via textarea portal with transformPaste hook` | Step 7 — HTML + plain text paste, filter hook |

---

## What We Are NOT Doing in Phase 2

These are deferred to Phase 3 unless they block the success criteria:

- Double-click word selection, triple-click line selection
- IME composition display (in-progress characters shown on canvas)
- Scroll-to-cursor (auto-scroll when cursor moves off screen)
- Home/End keys
- Tables, lists, headings formatting
- `BlockRegistry` for custom block types (design is in `docs/extensibility.md`)

---

## Success Criteria

> Type a paragraph, bold some words, select text with mouse, delete it, undo.

Concretely:
1. Click anywhere in the document → cursor appears at that position
2. Type characters → text appears, cursor advances
3. Backspace → character before cursor deleted
4. Click and drag → text highlights
5. Click B in toolbar → selected text goes bold (canvas re-renders with bold font)
6. ⌘Z → undo restores previous state
7. Arrow keys move cursor line by line

---

## Open Questions for Phase 2

- **Scroll-to-cursor:** When pressing ↓ past the visible area, should we auto-scroll? Probably yes — needs `scrollIntoView` equivalent on the scroll container. Defer to after basic navigation works.
- **Selection across pages:** `glyphsInRange` must handle selections that span multiple pages. Each page's overlay renders its own slice of the selection. The anchor and head may be on different pages.
- **Cursor on page boundary:** If cursor is at the last position of page 1, should it render at the bottom of page 1 or the top of page 2? Convention: render at the top of page 2 (same as how Google Docs handles it). `coordsAtPos` should return page 2 coords for this position.
