# RFC: Unified Semantic Selection System

Status: draft (2026-07-04)

## Problem

Selection is not one system. It is smeared across five places that each know a
different subset of the truth:

- **Text and images** use ProseMirror selections (`TextSelection`,
  `NodeSelection`) in `state.selection`.
- **Tables** keep a *second* selection in plugin state
  (`packages/core/src/table/cellSelection.ts` — `StoredCellRange {anchor, head}`)
  plus a forced collapsed caret so the two don't visually fight.
- **PointerController** directly hardcodes text, cells, inline images, anchored
  images, dragging, and resizing (`instanceof NodeSelection` at
  `PointerController.ts:278,356`; cell drag at `591-613`).
- **TileManager** renders each selection type explicitly
  (`TileManager.ts:703/713/725` — text highlight vs. image handles; cells via a
  separate `runOverlayHandlers` path).
- **SelectionSnapshot** (`Editor.ts`, used at `TileManager.ts:635`) only
  describes text ranges (`{head, from, to, empty}`).

Dual selection state causes conflicting rendering, clipboard, commands, undo
mapping, and collaboration. Concretely from the surface audit: ~40 sites read
`state.selection`; only 4 branch on type; **none** know about cells; and the cell
range **does not survive undo** (`cellSelection.ts:260` clears it on the history
transaction's `selectionSet`) and is invisible to collab (never serialized).

Every feature we add on top (Phase 6b merge/split; future embeds, widgets,
columns, comments) either patches every consumer or deepens the shadow. Adding
more plugin-state selections is the wrong direction.

## The foundation: a semantic selection pipeline

```
Pointer / keyboard
      ↓
extensible hit testing          → HitTarget (semantic, not pixel)
      ↓
selection gesture               → transient drag state (outside editor state)
      ↓
canonical ProseMirror Selection → the ONE source of truth in state.selection
      ↓
selection descriptor + capabilities → public, discriminated, UI-facing
      ↓
geometry primitives             → caret / fill / outline / handles
      ↓
canvas overlay                  → TileManager renders primitives, type-blind
```

The critical decision: **one canonical selection in editor state, with
extensible behavior and geometry around it.**

## 1. One canonical selection state

Every active selection is a ProseMirror `Selection`:

- `TextSelection`, `NodeSelection`, `AllSelection` (built-ins)
- `CellSelection` — a real custom subclass (Scrivr-owned; we don't depend on
  prosemirror-tables)
- Future custom selections registered by extensions

The table range in `table/cellSelection.ts` stops living beside
`state.selection`. A custom selection must implement **mapping, bookmarks,
equality, and JSON serialization** so it survives transactions, undo, and
collaborative changes. This is exactly what prosemirror-tables' `CellSelection`
does and what we mirror:

- `map(doc, mapping)` — remap the two cells; degrade to `TextSelection` if a cell
  is deleted or the endpoints leave the table. (Replaces the plugin's `apply`
  remap.)
- `content()` — the rectangular `Slice`, adjusting colspan/rowspan for clipped
  cells. Copy/cut must be re-pointed to call `state.selection.content()`
  (requirement 2); they read `from/to` today.
- `replace()` / `replaceWith()` — typing clears every cell, content lands in the
  anchor. Reachable only once `insertText` stops passing explicit `from/to`
  (requirement 3).
- `eq`, `toJSON`, static `fromJSON`, `getBookmark` (+ `CellBookmark`) — bookmark
  makes undo correct; collab needs awareness serialization wired separately
  (requirement 10). Registered `Selection.jsonID('cell', CellSelection)` at
  module load, before any `EditorState.fromJSON` (new core registration hook;
  none exists today).

Deletes on landing: `cellSelectionPlugin`, `setStoredCellRange`,
`StoredCellRange`, the PointerController collapse-to-caret hack, and the
`selectedCells` shadow branch (becomes `state.selection instanceof CellSelection`).

**Canvas constraint.** The hidden textarea + cursor paint need a *text* anchor,
and `CellSelection.head` is a structural boundary (before the head cell), not a
caret position — feeding it to `syncPosition`/`coordsAtPos` can land the IME and
cursor in the wrong cell. The selection must expose an explicit insertion anchor
inside the head cell (see review-hardened requirement 4). Destructive edits in
`model/commands.ts` must route through the selection's own `replace`/`replaceWith`
(requirement 3) — `insertText`'s explicit `from/to` is the real gap.

## 2. Public discriminated selection descriptor

Replace the text-only `SelectionSnapshot` (`Editor.ts`) with a discriminated
descriptor:

```ts
type SelectionDescriptor =
  | TextSelectionDescriptor
  | NodeSelectionDescriptor
  | CellSelectionDescriptor
  | CustomSelectionDescriptor;

interface SelectionDescriptorBase {
  kind: string;
  surfaceId: string;          // ties into Scrivr surfaces (header/footer/body)
  empty: boolean;
  capabilities: SelectionCapabilities;
}

interface SelectionCapabilities {
  copy: boolean;
  cut: boolean;
  delete: boolean;
  formatText: boolean;
  drag: boolean;
  resize: boolean;
}
```

Capabilities describe what the UI may offer, so menus/toolbars stop
`instanceof`-ing the selection (e.g. `createImageMenu.ts:66`,
`createBubbleMenu.ts:68`). Keep `anchor/head/from/to` on the descriptor
temporarily for compatibility with the ~40 existing readers; migrate them to
`kind`/capabilities incrementally.

## 3. Extension-owned selection behaviors

Extensions register semantic behavior **through the extension seam**
(`Extension.addSelectionBehavior()`, sibling to `addProseMirrorPlugins` /
`addOverlayRenderHandler`) instead of adding cases to PointerController /
TileManager:

```ts
interface SelectionBehavior<S extends Selection = Selection> {
  kind: string;
  matches(selection: Selection): selection is S;
  describe(selection: S, context: SelectionContext): SelectionDescriptor;
  geometry(selection: S, context: GeometryContext): SelectionPrimitive[];
  beginGesture?(hit: HitTarget, event: PointerEvent): SelectionGesture | null;
}
```

Tables own cell selection. Images own node-selection handles. Future shapes,
embeds, columns, comments, custom nodes provide their own behavior. One
registration point per extension covers describe + geometry + gesture.

**Mandatory default fallback.** The registry MUST resolve a default behavior for
any selection whose `kind` no consumer registered — Seraa layers many custom PM
node types on Scrivr, and a per-type dispatch with no fallback would make a
custom-node selection un-describable / un-paintable / un-copyable (silent
break). Core ships default behaviors for `TextSelection`/`NodeSelection`; an
unmatched custom `Selection` falls back to a generic descriptor + outline
geometry rather than throwing or painting nothing.

## 4. Extensible semantic hit testing

`PointerController` currently hardcodes cells and multiple image modes. Hit
testing returns **semantic targets** instead:

```ts
type HitTarget =
  | { kind: "text"; pos: number }
  | { kind: "node"; pos: number; nodeType: string }
  | { kind: "table-cell"; tablePos: number; cellPos: number }
  | { kind: string; payload: unknown };
```

Extensions register prioritized hit testers. PointerController only manages
pointer capture and delegates to the matched behavior's `beginGesture`.
**Transient drag state stays outside editor state** (as the paint-only
`pendingAnchoredDrag`/`resizeDrag` already do); only the committed selection
belongs in ProseMirror.

## 5. Geometry, not custom painting

Behaviors emit generic overlay primitives; TileManager renders them without
knowing what a table, image, or future object is:

```ts
type SelectionPrimitive =
  | { type: "caret"; x: number; y: number; height: number }
  | { type: "fill"; rects: Rect[]; color: string }
  | { type: "outline"; rect: Rect; style: OutlineStyle }
  | { type: "handles"; handles: Handle[] };
```

`TileManager.ts:703` becomes: get the active `Selection` → matched behavior's
`geometry()` → paint primitives. Existing `renderSelection` (glyph rects),
`renderHandles`, and the cell wash become primitive emitters. Images gain the
selection **outline** they lack today.

## Build order

**On this branch (the seam + images):**
1. `SelectionDescriptor` + capabilities + the `addSelectionBehavior` registry
   with the required default fallback.
2. `SelectionPrimitive` geometry pipeline; `TileManager` renders primitives
   type-blind (behaviors emit; TileManager stops knowing node types).
3. Semantic `HitTarget`s + a prioritized hit-test registry; `PointerController`
   captures and delegates gesture.
4. Convert the built-ins through the seam: `TextSelection` (caret/glyph fills),
   `NodeSelection`/**images** (outline + handles geometry, resize/body-drag
   hit-test + gesture), `AllSelection`. Images are the proof.
5. Wire menus/clipboard/deletion to descriptors + capabilities where they touch
   the converted built-ins; keep raw `from/to` only where a text range genuinely
   means a text range.

**On the tables PR (first extension consumer):**
6. Implement `CellSelection` (map/content/bookmark/eq/JSON) + its registered
   `SelectionBehavior` (geometry = rect fills, hit-test = table-cell, in-cell IME
   anchor, command guards). No seam changes allowed — that is the acceptance
   test. Phase 6b (merge/split) builds on it.

## Decisions (locked)

- **Scope: build the full seam correctly, upfront.** All five pillars
  (canonical selection + descriptor + extension behavior registry + semantic hit
  testing + geometry primitives) as one coherent body of work — not sequenced or
  deferred. Rationale (user): breaking it up loses the cross-cutting learning and
  fine-tuning that only surface when the whole thing is built together.
- **Third-party extensibility is the requirement, not YAGNI.** The explicit goal
  is that any extension can register a selection it drives on its own terms —
  Seraa layers many custom nodes and needs to select them without patching core.
  That is why the extension registry is built now: it is the product, not
  speculation.
- **Behaviors register via the extension seam** (`addSelectionBehavior`) with a
  **required default fallback** for unregistered selection kinds (Seraa custom
  nodes).

### Branch split

- **This branch (`feat/selection-system`) — the seam + proof.** Build the whole
  framework (pillars 1-5) and convert the BUILT-IN selections through it:
  `TextSelection`, `NodeSelection` (images), `AllSelection`. **Images are the
  proving consumer** — they exercise geometry (outline + handles), hit-testing
  (resize handles vs body drag, anchored vs inline), and gesture (resize, move).
  A seam with no non-trivial consumer is unproven; images prove it here. The seam
  APIs are designed against the `CellSelection` (range/rectangle) requirements
  from the pm-tables research so cells drop in with zero seam changes.
- **Tables PR (`feat/tables-phase6-cell-selection`) — first extension consumer.**
  Merge this branch in, then implement `CellSelection` + its registered
  `SelectionBehavior` there. Cells validate that a range selection plugs into the
  seam without core changes; Phase 6b (merge/split) builds on it.
- **Seraa — third-party consumer.** A Claude/Seraa library extension registers
  its own `SelectionBehavior` for its custom nodes. If the tables consumer needed
  a core change, the seam failed; that is the acceptance test for this branch.

## Review-hardened requirements (folded in from the eng + codex review)

These are in scope, not open questions. Each is a thing the naive version breaks.

1. **Baseline.** This branch is off `main`, which never merged the Phase 6a
   shadow (held on PR #123). So there is NO `StoredCellRange` plugin to delete
   here — cells today are the Phase 5 *derived* cross-cell `TextSelection`
   (`cellRangeFromSelection`). The build upgrades that to a real `CellSelection`.
2. **Nothing is "free" — wire it.** `content()` does not auto-route to the
   clipboard: copy/cut read `doc.textBetween(from,to)` (`InputBridge.ts:415`) and
   HTML uses `doc.slice(from,to)` (`ClipboardSerializer.ts:21`); both must call
   `state.selection.content()` and define rectangular plain-text/HTML output.
3. **Typing must invoke the selection's `replace()`.** `insertText` passes
   explicit `from/to` (`commands.ts:21`), bypassing `CellSelection.replace()`.
   Switch to `tr.insertText(text)` (no positions) / `replaceSelectionWith`. IME
   path is the same (`InputBridge.ts:396,405`). Delete/paste already route
   through selection semantics (`commands.ts:27,54,88`, `PasteTransformer.ts:123`)
   — audit + test, but `insertText` is the real gap.
4. **`CellSelection.head` is a structural boundary, not caret geometry.** Feeding
   it to `syncPosition`/`getViewportRect` (`InputBridge.ts:192`) or `coordsAtPos`
   can put the IME/cursor in the wrong cell. The selection must expose an explicit
   text-insertion/IME anchor *inside* the head cell for textarea + cursor paint.
5. **Rendering ships with the selection.** `TileManager` only distinguishes
   `NodeSelection` (`:703/713/725`); an unrendered `CellSelection` paints as one
   contiguous glyph range + caret and highlights intervening cells. Cell/rect
   geometry must land in the same change — this is why geometry primitives are
   pillar 5, not a follow-up.
6. **Command guards.** Keeping raw `from/to` is NOT compatibility for rectangular
   selections — `Alignment.ts:26`, `FontSize.ts:67` et al. would format cells
   *outside* the selection. Gate formatting/structural commands on the selection
   kind (capabilities), and define arrow/Escape (navigation currently coerces any
   custom selection back to `TextSelection`, `SelectionController.ts:234`).
7. **`AllSelection`** is canonical too — include it in the descriptor union and
   give it a default behavior (Cmd-A).
8. **Surfaces are ownership, not decoration.** Input routes to the active surface
   but the layout head stays the root selection (`Editor.ts:420,437`), and
   textarea positioning is disabled for surfaces (`Editor.ts:1127`). Selection
   geometry/context must be surface-scoped before header/footer selection works.
9. **Transient state stays transient.** Resize + anchored-drag ghosts are
   pointer state with their own repaint keys (`TileManager.ts:642,740`), not
   selection-driven — geometry migration must define their ownership,
   cancellation, and invalidation, not fold them into selection state.
10. **History + collab need explicit tests, not faith.** Bookmark covers undo;
    collab needs awareness serialization separately, and endpoint mapping needs
    table-identity validation after concurrent row/cell delete/move. Test
    undo/redo + remote structural remaps.

## Remaining design questions (answer before/while building)

- `CellSelection`: include column/row variants now (pm-tables
  `colSelection`/`rowSelection`) or rectangle-first?
- Bookmark shape — mirror pm-tables `CellBookmark` (two positions).
- Registry ownership: behavior/geometry registry on `Editor` vs `TileManager`;
  geometry contexts receive the painted `DocumentLayout` so paint never re-runs
  layout.
```
