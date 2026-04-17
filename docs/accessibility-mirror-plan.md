# Accessibility Mirror Plan

> Status: **design complete** — ready for implementation as its own PR.  
> Trigger: before public release. Earlier is cheaper — each new feature adds retrofit surface.

## Core principle

**Canvas = paint what the user sees. A11y mirror = say what the user meant.**

The canvas renders pixels. Screen readers need DOM. The accessibility mirror is a hidden semantic DOM tree kept in sync with the ProseMirror document. It reuses `DOMSerializer.fromSchema()` — the same serializer `ClipboardSerializer` already uses for copy/paste — so every node's `toDOM` spec produces the right HTML automatically. Not a new rendering path. A fifth projection of the same document model.

This fits the existing multi-surface pattern:

| Surface  | Model                 |
|----------|-----------------------|
| Canvas   | layout → pixels       |
| PDF      | layout → imperative   |
| Markdown | tree → string         |
| DOCX     | tree → structured XML |
| **A11y** | **tree → semantic DOM (live, reactive)** |

### What "reuse DOMSerializer" means (and doesn't)

We reuse **node-level serialization** — each node's `toDOM` spec produces the right HTML element. We do NOT reuse the clipboard code path itself. The clipboard model is stateless, one-shot, and discards its output. The mirror requires stable identity, incremental updates, and ARIA wiring. `ClipboardSerializer.ts` is the proof that `toDOM` specs produce good HTML. `AccessibilityMirror` is a different consumer of the same specs.

## What the current architecture already solves

- **`DOMSerializer.fromSchema(schema)`** — already serializes PM doc → semantic HTML for clipboard. Every node/mark defines `toDOM`. Zero new serialization code needed.
- **`SelectionSnapshot`** — already computed in `_viewDispatch()` with block type, active marks, cursor position. Feeds status announcements directly.
- **RAF flush pipeline** — `ensureLayout()` → subscribers → TileManager paint. The mirror slots in after `ensureLayout()`, before `_notifyListeners()`. Naturally batches rapid transactions.
- **`contain: strict`** — CSS containment prevents the hidden mirror from triggering reflow in the visible document.

## Architecture

### Three DOM elements, three concerns

```
container (app-provided)
  ├─ tilesContainer (existing — canvases)
  └─ a11yRoot (NEW — screen-reader-only)
       ├─ a11yContent  role="document"       Full semantic DOM mirror
       ├─ a11yStatus   role="status"         Cursor/selection announcements (polite)
       └─ a11yAnnounce role="log"            Action feedback (assertive)
```

**`a11yContent`** — the document mirror.
- `role="document"`, `aria-label="Document content"`
- Visually hidden: `clip: rect(0,0,0,0); position: absolute; overflow: hidden; width: 1px; height: 1px;` — NOT `display: none` (screen readers skip that)
- Contains real semantic HTML: `<h1>`, `<p>`, `<ul>`, `<a href>`, `<strong>`, `<em>`
- Each top-level block gets a stable ID: `a11y-block-0`, `a11y-block-1`, ...

**`a11yStatus`** — cursor position, announced politely.
- `role="status"`, `aria-live="polite"`, `aria-atomic="true"`
- Updated on selection change: "Line 42, column 8. Heading 2, bold."
- Updated on page change: "Page 3 of 12"
- Polite = screen reader announces when idle, doesn't interrupt

**`a11yAnnounce`** — action feedback, announced assertively.
- `role="log"`, `aria-live="assertive"`
- Flashes on editing actions: "Bold applied", "3 characters deleted", "Pasted 2 paragraphs"
- Assertive = interrupts current speech. Used sparingly.

### Sync strategy

```
dispatch(tr)
  → _viewDispatch()
    → lc.invalidate()
    → _scheduleFlush()
      → RAF:
          lc.ensureLayout()                                    // existing
          a11yMirror.sync(state, snapshot, activeSurface?)     // NEW
          _notifyListeners()                                   // existing
```

`sync()` has two paths:

1. **Doc changed** (`tr.docChanged`): identify affected top-level blocks from the transaction's changed range, re-serialize only those blocks via `DOMSerializer`, replace their DOM nodes in `a11yContent`. Unaffected siblings stay alive — screen reader position is preserved.

2. **Selection only**: update `a11yStatus` text with cursor position from `SelectionSnapshot`. Update `aria-activedescendant` on the InputBridge textarea to point at the current block's stable ID. Cheap — no serialization.

### Why block-level patching, not innerHTML replacement

NVDA and JAWS track their reading position by DOM node reference. Replacing `innerHTML` on the entire mirror destroys those references — the screen reader loses its place on every keystroke, either jumping to the top or going silent.

Block-level patching preserves siblings. ProseMirror transactions carry the changed range. Map that range to top-level block indices → replace only those blocks' DOM nodes. Cost: ~30-50 lines of range-mapping logic. Benefit: the mirror actually works with real screen readers.

```ts
// Conceptual — not final API
const { from, to } = tr.mapping.mapResult(0);
const startBlock = doc.childBefore(from).index;
const endBlock = doc.childBefore(to).index;
// Replace a11yContent.children[startBlock..endBlock] with fresh serialization
```

### Stable IDs: prefer node identity, fall back to index

`aria-activedescendant` needs a target ID that doesn't vanish on character edits. Pure block indices work for typing within a block, but break on split/merge — pressing Enter shifts every subsequent block's index, and the screen reader's `aria-activedescendant` target may point to the wrong block or a node that no longer exists.

**Strategy: two-tier identity.**

1. If the node has a stable attr (e.g., `node.attrs.blockId` from UniqueId extension), use it: `a11y-block-${blockId}`
2. Otherwise, fall back to index: `a11y-block-${index}`

Index-based IDs shift on structural edits (split, merge, delete). That's acceptable — those are meaningful events where screen reader repositioning is expected. What we avoid is *every keystroke* scrambling IDs, which is what raw PM positions would cause.

```ts
// On sync: assign IDs to top-level blocks
doc.forEach((node, _offset, index) => {
  const id = node.attrs.blockId ?? index;
  a11yContent.children[index].id = `a11y-block-${id}`;
});

// On selection change: point textarea at current block
const { index, node } = state.doc.childBefore(snapshot.head);
const blockId = node?.attrs.blockId ?? index;
textarea.setAttribute("aria-activedescendant", `a11y-block-${blockId}`);
```

If the schema doesn't have `blockId` attrs today, the index fallback is fine for Phase 1. When UniqueId extension is wired up, identity survives splits automatically.

### The announce() API

```ts
editor.announce(message: string, options?: {
  type?: "format" | "navigation" | "system";  // default: "system"
  priority?: "polite" | "assertive";           // default: per-type (see below)
  dedupe?: boolean;                            // default: true
}): void
```

Writes to `a11yAnnounce` (assertive) or `a11yStatus` (polite).

**Type-based defaults** (lets us tune behavior per category without changing callers):

| Type | Default priority | Rationale |
|------|-----------------|-----------|
| `navigation` | polite | Cursor movement — don't interrupt reading |
| `format` | polite, batched | "Bold on" — collapse rapid toggles |
| `system` | assertive | Errors, AI suggestions — needs attention |

Types are cheap to add now and let us tune behavior later without touching every call site. Extensions pass the semantic type; the mirror decides priority and batching.

**Debounce contract** (defined here, enforced in AccessibilityMirror):
- Messages are queued, deduplicated within a 300ms window
- Identical consecutive messages are collapsed
- Maximum delivery rate: 1 assertive announcement per 500ms
- Extensions call `editor.announce()` without implementing their own debounce

This contract must be stable before Phase 3 extensions (AI suggestions, collaboration, track changes) start calling it.

## Where it lives

**Core, not extension.** Three reasons:

1. **InputBridge owns the textarea.** `aria-activedescendant` must point into the mirror. InputBridge must know about it — an extension can't inject this retroactively.

2. **Selection announcements need `SelectionSnapshot`.** This is computed inside `Editor._viewDispatch()`. An extension would have to reverse-engineer it.

3. **Must work by default.** If accessibility is opt-in, devs forget to add it and the product ships inaccessible. Core with opt-out is the right default.

```ts
new Editor({
  extensions: [StarterKit],
  accessibility: true,   // default — set false to disable
})
```

## What extensions contribute (automatically)

Every extension already defines `toDOM` on its node/mark specs for clipboard serialization. Those specs produce the a11y mirror HTML with no additional work.

```ts
// Image extension — alt text flows into the mirror automatically
image: {
  toDOM(node) {
    return ["img", { src: node.attrs.src, alt: node.attrs.alt }];
  },
}
```

For overlay-only features (AI suggestions, collaboration cursors, track changes), extensions call `editor.announce()`:

```ts
// In AiSuggestion onEditorReady:
editor.announce("AI suggestion available. Press Tab to accept.");

// In TrackChanges overlay handler:
editor.announce("Insertion by Alice, 3 words", { priority: "polite" });
```

## Known friction points (resolved)

### SurfaceRegistry integration

When the user enters a header surface, `editor.state` stays on the main doc (by design). Without integration, `a11yMirror.sync()` only mirrors the main doc — a screen reader user editing a header types blind.

**Resolution:** `sync()` accepts an optional surface state. `Editor._viewDispatch()` passes the active surface's state when one is active. When a surface activates, the mirror announces "Editing header" via `a11yStatus`. When it deactivates, "Returned to document body."

**Invariant: only ONE semantic root at a time.** When a surface is active, `a11yContent` reflects *only that surface's content* — not the main doc plus the header, and not a merged tree. Screen readers navigate a single document stream. Mixing trees creates confusion. Treat surfaces as "temporary document override" in the mirror.

This is Phase 2 scope — surfaces are a plugin feature, and Phase 1 handles the flow document correctly.

### Performance on large, heavily formatted documents

`DOMSerializer.serializeFragment()` is fast (~2-5ms for 10k words) because it creates detached DOM. But attaching to a live document triggers style resolution even inside `contain: strict`.

**Mitigations (all in Phase 1):**
- Block-level patching: only the changed block touches the live DOM
- Use `DocumentFragment` before replacing: serialize into detached fragment, then `parent.replaceChild(frag, oldNode)` — minimizes layout churn even inside containment
- Debounce during rapid typing: serialize at most once per 100ms
- Skip entirely when doc hasn't changed (selection-only updates)

### Screen reader compatibility

Tested behaviors to verify in Phase 1:
- **VoiceOver (macOS)**: `aria-activedescendant` + `role="document"` focus tracking
- **NVDA (Windows)**: block replacement doesn't reset reading position
- **JAWS (Windows)**: `aria-live` region announcements respect debounce timing
- **Mobile (TalkBack/VoiceOver iOS)**: basic document reading works

## Implementation phases

### Phase 1: Foundation (PR scope)

**New file:** `packages/core/src/renderer/AccessibilityMirror.ts` (~200-250 lines)

```ts
export class AccessibilityMirror {
  private root: HTMLElement;
  private content: HTMLElement;     // role="document"
  private status: HTMLElement;      // role="status", aria-live="polite"
  private announcer: HTMLElement;   // role="log", aria-live="assertive"
  private serializer: DOMSerializer;
  private lastDoc: Node | null = null;
  private announceQueue: { message: string; time: number }[] = [];

  constructor(schema: Schema, container: HTMLElement) { ... }

  /** Called in RAF flush after ensureLayout(). */
  sync(state: EditorState, snapshot: SelectionSnapshot): void { ... }

  /** Public API for extensions. Queued + debounced. */
  announce(message: string, options?: AnnounceOptions): void { ... }

  /** Returns the current block's stable ID for aria-activedescendant. */
  activeDescendantId(snapshot: SelectionSnapshot): string | null { ... }

  destroy(): void { ... }
}
```

**Changes to existing files:**

`Editor.ts` (~20 lines):
- Construct `AccessibilityMirror` in constructor (gated on `accessibility` option)
- Call `a11yMirror.sync()` in `_scheduleFlush()` RAF callback
- Expose `editor.announce()` method
- Destroy mirror in `editor.destroy()`

`InputBridge.ts` (~5 lines):
- Accept `getActiveDescendant?: () => string | null` callback
- Set `aria-activedescendant` on textarea after each sync

`TileManager.ts` (~10 lines):
- Mount `a11yRoot` element in the container during `mount()`
- Remove in `destroy()`

`EditorOptions` type (~5 lines):
- Add `accessibility?: boolean | AccessibilityOptions`

**What Phase 1 delivers:**
- Screen readers can read the full document content
- Cursor position announced on navigation ("Line 12, Paragraph, bold")
- Block-level patching keeps screen reader position stable during editing
- `editor.announce()` API ready for extensions
- Opt-out via `accessibility: false`

**What Phase 1 does NOT deliver:**
- Surface editing (headers/footnotes) — screen reader users can't edit those yet
- DOM selection tracking — screen reader cursor is independent of canvas cursor
- Extension announcements — API exists but no callers yet

### Phase 2: Selection, navigation & mark diffing

- Map canvas selection to DOM range in mirror (screen reader tracks cursor)
- Announce block type transitions ("Entering heading level 2", "Entering list")
- Announce mark changes ("Bold on", "Link: example.com")
- SurfaceRegistry integration: `sync()` accepts active surface state, single-root invariant
- Surface activation/deactivation announcements
- **Inline mark diffing**: when only marks changed within a block (bold toggle, color change), patch inline children instead of replacing the entire block element. Naive diff: compare text content equality + mark ranges. Avoids screen readers re-reading the whole paragraph for a single-word bold toggle. (~30-40 lines in the patch logic)

### Phase 3: Interactive features

- AI suggestion announcements ("Suggestion available. Tab to accept.")
- Track changes announcements ("Insertion by Alice", "Deletion by Bob")
- Collaboration cursor announcements ("Alice editing line 12")
- Table cell navigation ("Row 2, column 3, header row")
- Image descriptions (read alt text on focus)

### Phase 4: Optimize & advanced

- Fine-grained `contain` strategy per block
- Skip serialization entirely when doc unchanged + selection in same block
- Profile and reduce style resolution cost on large documents
- **DOM selection mode** (optional): move real DOM selection into the mirror, sync back to canvas. Some screen readers prefer actual DOM focus over `aria-activedescendant` virtual cursor. This is an alternative input mode, not a replacement — keep the virtual cursor as default, offer DOM selection as opt-in. Requires bidirectional sync: DOM selection → PM selection → canvas cursor. Not needed for v1 but the architecture should not preclude it.

## Files touched

| File | Phase | Lines | Change |
|------|-------|-------|--------|
| `renderer/AccessibilityMirror.ts` | 1 | ~200-250 | New file |
| `Editor.ts` | 1 | ~20 | Construct, sync, announce, destroy |
| `input/InputBridge.ts` | 1 | ~5 | aria-activedescendant callback |
| `renderer/TileManager.ts` | 1 | ~10 | Mount/unmount a11yRoot |
| `types/augmentation.ts` | 1 | ~5 | AccessibilityOptions type |
| `surfaces/SurfaceRegistry.ts` | 2 | ~10 | Expose active surface state to flush |
| `plugins/*/` | 3 | ~2-5 each | announce() calls in overlay features |

## Testing strategy

Automated tests can verify:
- Mirror DOM structure matches PM doc structure after transactions
- Block-level patching: only changed blocks are replaced (spy on replaceChild)
- Split/merge: pressing Enter creates two blocks with correct IDs; Backspace at block start merges and preserves sibling IDs
- Stable IDs: block IDs don't change on character edits within a block
- Stable IDs with blockId attr: IDs survive split when UniqueId extension provides `blockId`
- Status text updates on selection change
- Announce queue deduplicates within window
- Announce type-based priority defaults apply correctly
- Mirror disabled when `accessibility: false`
- DocumentFragment used for DOM replacement (no direct innerHTML writes)

Manual testing required:
- VoiceOver + Safari: document reading, cursor tracking, live region announcements
- NVDA + Chrome/Firefox: same
- JAWS + Chrome: same
- TalkBack + Chrome Android: basic reading

## Resolved questions

1. **Page breaks: ignore in the mirror, announce on cursor crossing.** The document mirror is a continuous semantic flow — no `<hr>` or separator elements for page boundaries. Screen reader users navigate by headings and structure, not visual pages. When the cursor crosses a page boundary, announce "Page 3 of 12" via `a11yStatus` (polite). This is handled by the existing `SelectionSnapshot` → `a11yStatus` path in `sync()`.

2. **Table accessibility: standard `<table>` markup, no `role="grid"`.** Assistive technologies have decades of refined shortcuts for native HTML tables (NVDA: Ctrl+Alt+arrows, JAWS: Alt+Ctrl+arrows, VoiceOver: VO+arrows). The `toDOM` spec for table nodes must produce `<table><tr><td>` — which is what ProseMirror's table schema already does. Using `role="grid"` would force manual focus management for every cell. Avoid it.

3. **RTL/LTR: `dir="auto"` on `a11yRoot`.** The container-level direction must be aware of the document's global direction. Set `dir="auto"` on `a11yRoot` so the browser infers direction from content. Individual nodes inherit `dir` from their `toDOM` specs. For mixed-direction documents, ProseMirror handles per-node direction attributes — those flow into the mirror automatically.
