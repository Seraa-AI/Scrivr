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
  cells. **Copy/cut become free** (delete `serializeCellSelection`).
- `replace()` / `replaceWith()` — typing clears every cell, content lands in the
  anchor. (Replaces the guard's clear logic for the typing case.)
- `eq`, `toJSON`, static `fromJSON`, `getBookmark` (+ `CellBookmark`) — history +
  collab correctness for free. Registered `Selection.jsonID('cell', CellSelection)`
  at module load, before any `EditorState.fromJSON` (new core registration hook;
  none exists today).

Deletes on landing: `cellSelectionPlugin`, `setStoredCellRange`,
`StoredCellRange`, the PointerController collapse-to-caret hack, and the
`selectedCells` shadow branch (becomes `state.selection instanceof CellSelection`).

**Canvas constraint.** `InputBridge.syncPosition` only needs a resolvable
`selection.head` to park the hidden textarea; `CellSelection.head` resolves
inside the head cell, so no shadow caret is needed. Destructive edits in
`model/commands.ts` (which read `.from/.to` today) must route through the
selection's own `replace`/`replaceWith` so subclass semantics apply — this is
the one call-site set that needs auditing, not rewriting.

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

## Migration order

1. Introduce `SelectionDescriptor`, capabilities, and the behavior registry
   (additive; nothing removed yet).
2. Convert the table shadow into a real `CellSelection` (mapping, bookmark, eq,
   JSON). Fixes the undo bug; copy/cut move to `content()`.
3. Move selection geometry behind registered behaviors (emit primitives;
   TileManager renders them).
4. Introduce semantic `HitTarget`s and gesture handlers.
5. Remove image/table branches from PointerController.
6. Make menus, clipboard, deletion, and collaboration consume descriptors and
   capabilities.

Phase 6b (merge/split) builds on step 2 instead of adding shadow reads.

## Decisions (locked)

- **Scope: sequenced PRs.** PR1 = real `CellSelection` in `state.selection`
  (map/content/bookmark/eq/jsonID) + `SelectionDescriptor`, converting cells and
  deleting the shadow. Registries (behavior/geometry/hit-test) land as follow-on
  PRs, converting images too. Each PR reviewable; not a big-bang.
- **Behaviors register via the extension seam** (`addSelectionBehavior`) with a
  **required default fallback** for unregistered selection kinds (Seraa custom
  nodes).

## Open questions (resolve during PR1 design)

- `CellSelection`: rectangle only for v1, or column/row variants now
  (pm-tables `colSelection`/`rowSelection`)?
- Bookmark shape — mirror pm-tables `CellBookmark` (two positions).
- Registry ownership: does the behavior/geometry registry live on `Editor` or
  `TileManager`, and do geometry contexts receive the painted `DocumentLayout`
  (the P3 from the earlier code review, so paint never re-runs layout)?
- Descriptor compatibility window: how long we keep raw `anchor/head/from/to`
  before menus/commands consume capabilities.
- Surfaces: descriptor `surfaceId` vs. the existing `activeSurface` selection
  split (`PointerController.ts:272`).
```
