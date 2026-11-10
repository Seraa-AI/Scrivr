# RFC: Hover inspection — popovers that peek on hover and expand on select

Status: v1 shipped (2026-11-02) — see [What shipped](#what-shipped), which
records where the code departs from the proposal below. Decision 8 is
deferred, not built.

## Problem

Hovering over a link, an image or a table in Scrivr tells the user nothing. The
only thing hover does today is pick a mouse cursor:

```ts
// PointerController.handlePointerMove, idle branch
const hit = this.hitTest(e.clientX, e.clientY);
this.setCursorAll(this.hoverCursorFor(hit));
```

That is the whole feature. `hoverCursorFor` asks `resolvePointOwner` whether the
point is text or an object, picks `text` / `move` / a resize cursor, and the
answer is discarded. Nothing in the editor records *what* is under the pointer,
no event fires, and no extension can react to it.

Every popover we ship is driven by the **selection**, not the pointer:

- `menus/createLinkPopover.ts` reads `state.selection.head` and looks for a
  `link` mark there.
- `menus/createImageMenu.ts` reads `getSelectionDescriptor()` and
  `getNodeActions()`.
- `createBubbleMenu`, `createFloatingMenu`, `createSlashMenu` are all selection
  or input driven.

So reading where a link goes means clicking into it, which moves the caret,
which opens the edit popover. Seeing an image's alt text or source means
selecting the image. Tables have no popover at all.

A DOM editor gets hover for free: the browser keeps a hit tree, fires
`mouseenter`, and the app hangs a tooltip off the element. Scrivr paints to a
canvas, so — as `layout/pointOwnership.ts` puts it — every question the
compositor used to answer is code we write. This RFC writes the hover one.

### What exists and why it isn't enough

The parts are mostly there; they were built for clicks and they answer
slightly the wrong question for hover.

| Need | What exists | Gap for hover |
|---|---|---|
| Client point → page point | `PointerController.hitTest` (private) | Returns `{page, docX, docY, gap?}` and almost never null. A pointer in the left margin, past the page edge, or in a header band all come back as an ordinary page point. Click wants that (a click anywhere on a page places a caret); hover must not. |
| Page point → doc position | `CharacterMap.posAtCoords` | Snaps to the *nearest* position. A pointer in the margin beside a link resolves into the link. Click wants nearest; hover wants "the glyph actually under the pointer, or nothing". |
| Is text painted here? | `CharacterMap.hasTextAt` | Right answer, but it is a boolean — it does not say *which* glyph. |
| Who owns the point? | `resolvePointOwner` | Good: text vs. inline object vs. anchored object, z-order correct. Reused as is. |
| Extension targets (table cells) | `editor.resolveHitTarget` → registered `HitTester`s | First non-null wins. That is correct for click routing and wrong for hover: a link inside a table cell is *both* a link and a cell, and hover popovers need both. Adding a link tester to this chain would shadow `cellHitTester` on click too. |
| Hit testing against a surface | `resolveHitTarget` builds its context from `this.getState()` | Always the body. A pointer over an active header resolves against the body doc. |
| Node → screen rect | `getNodeViewportRect` / `getNodeRect` | Only image-like nodes: anchored objects and `charMap.objectRects`. Tables, cells and plain blocks have no rect, and a table split across pages has more than one. |

## The core idea

> **Hover is a transient, read-only target — the same semantic answer click
> routing gets, minus the commitment. Popovers render it as a *peek*; selecting
> the target expands the same popover to its *full* form.**

Three consequences:

**One popover per thing, two presentations.** We do not add a parallel set of
"hover tooltips". `LinkPopover`, `ImageMenu`, and a new table popover each gain
a `presentation: "peek" | "full"`. Peek is compact and read-only (link URL,
image alt + dimensions, table rows × columns). Full is what the popover shows
today plus node actions. The user's mental model is one object, one card that
grows when you commit to it.

**Hover never touches editor state.** Like `resizeDrag` and `anchoredDrag`, the
hover target lives on the pointer controller and is broadcast as an event. It is
not a ProseMirror selection, not plugin state, not undoable, not collaborative.

**Hover resolves a stack, not a winner.** The pointer over a link in a table
cell is over the link, the cell, and the table at once. Hover resolution returns
all of them, innermost first, and each popover picks the layer it serves. Click
routing keeps its first-wins chain unchanged.

```
pointermove (mouse/pen, no drag in flight, rAF-coalesced)
      ↓
resolvePagePoint                → PagePoint { page, x, y, region }       §3
      ↓  region ∉ { content } → empty stack
glyph / ownership / testers     → HoverTarget[] (innermost first)        §2
      ↓  dedupe against last stack
editor.emit("hover", { targets, point })                                  §1
      ↓
popover controllers             → peek / full / hidden                   §5
      ↓  geometry
getNodeViewportRects            → DOMRect[] per page fragment             §4
```

## 1. The hover target and event

```ts
/** One layer of what is under the pointer. */
export interface HoverTarget {
  /**
   * Semantic kind. Uses the SelectionDescriptor.kind vocabulary where one
   * exists ("image", "table-cell") so popovers and the NodeActionRegistry key
   * hover and selection off the same identity. Marks use their mark name
   * ("link").
   */
  kind: string;
  /** Surface that owns `pos` — "body" or a chrome surface id. */
  surfaceId: string;
  /** Node position (or mark range start) within that surface's doc. */
  pos: number;
  /** Mark range end, or pos + node.nodeSize. */
  end: number;
  /** Kind-specific metadata — never a live Node reference (see Decisions). */
  payload?: unknown;
}

export interface HoverEvent {
  /** Innermost first: [link, table-cell, table]. Empty when over nothing. */
  targets: readonly HoverTarget[];
  /** Null when the pointer left the editor. */
  point: PagePoint | null;
}

// augmentation.ts
interface EditorEvents {
  hover: HoverEvent;
}

// IEditor
getHoverTargets(): readonly HoverTarget[];
```

Emission rules (`PointerController`):

- **Only on change.** The stack is compared by `(kind, surfaceId, pos, end)` per
  layer; moving within the same link fires nothing.
- **Empty stack** when: a drag or extension gesture is active, the point is in a
  page gap, outside the page, or in a non-content region (§3), on
  `pointerleave` of the tiles container, on `keydown` (typing hides peeks until
  the next real pointer move), and on `detach()`.
- **Mouse and pen only.** `e.pointerType === "touch"` never produces hover; touch
  users reach the same information via selection (the full presentation).
- **Coalesced to one resolution per animation frame.** `handlePointerMove`
  already does a `hitTest` + ownership pass for the cursor; hover reuses that
  same point and ownership result rather than computing them twice.

## 2. Resolving the stack

Hover resolution is a new editor method that sits beside `resolveHitTarget`,
not inside it:

```ts
resolveHoverTargets(point: PagePoint): HoverTarget[];
```

Order of work, each step only reading geometry that already exists:

1. **Surface.** Pick the state that owns the point (§6).
2. **Ownership.** `resolvePointOwner`. `inlineObject` / `anchored` → push an
   image-like target from the node at `docPos` (`kind` from the node's
   SelectionBehavior, so it is `"image"` for images and the extension's own kind
   for custom nodes). Text → continue.
3. **Glyph.** `charMap.glyphAtPoint(x, y, page)` (§3). For each mark on the
   character under the glyph that a registered hover resolver claims, push a
   target with the mark's contiguous range. Built-in: `link`.
4. **Structure.** Run every registered hit tester with
   `ctx.intent = "hover"` and collect *all* non-null results (not first-wins),
   then walk `$pos` ancestors for registered node kinds (`table`). Push in
   innermost-first order.

Extension seam — hit testers already exist; marks need one small addition:

```ts
interface HitTestContext {
  // existing: editor, state, posAtCoords
  /** "pointerdown" for click routing, "hover" for hover resolution. */
  intent: "pointerdown" | "hover";
}

/** Mark-level hover: links today, comments / tracked changes later. */
export interface MarkHoverResolver {
  mark: string;
  /** Payload for the target; return null to decline this instance. */
  resolve(mark: Mark, range: { from: number; to: number }): unknown | null;
}

addHoverResolvers?(this: Phase1Context<Options>): MarkHoverResolver[];
```

`cellHitTester` works unchanged; `intent` lets a tester answer differently for
hover if it ever needs to. A mark resolver is separate from `HitTester` because
marks have no geometry of their own — they are found through the glyph, after
ownership has said "text".

`findMarkRange` moves out of `createLinkPopover.ts` into `model/` so the link
resolver, the link popover and future mark resolvers share it.

## 3. Page points and regions — extending `hitTest`

`hitTest` becomes a pure, exported function in `layout/` so click, hover and
drags share it, and it reports *where on the page* the point fell:

```ts
export type PageRegion =
  | "content"        // inside the body content box (or an active surface's)
  | "margin"         // page margin outside content: left/right/top/bottom
  | "header"         // chrome band, header
  | "footer"         // chrome band, footer
  | "gap"            // between pages (paged mode)
  | "outside";       // left/right of the page, or past the last page

export interface PagePoint {
  page: number;
  /** Page-local; clamped into the page for click callers (current behaviour). */
  x: number;
  y: number;
  region: PageRegion;
}

export function resolvePagePoint(
  clientX: number,
  clientY: number,
  ctx: PagePointContext, // container rect, slot/tile heights, pageless, metrics, pageConfig
): PagePoint | null;
```

Regions come from data that already exists: `pageConfig.margins`,
`layout.metrics[page]` (`contentTop`, `footerTop`, `headerHeight`,
`footerHeight` — the same bounds `routePageClick` computes), and the slot math
`hitTest` does today. `routePageClick` stops recomputing band bounds and reads
`point.region`.

Click behaviour does not change: click callers ignore `region` except where
they already special-case gaps. Hover requires `region === "content"` (or
`header`/`footer` when that surface is active).

### Exact glyph lookup — extending `CharacterMap`

`posAtCoords` keeps its nearest-position contract. Hover gets a strict sibling:

```ts
/**
 * The glyph painted under (x, y), or null. Never snaps: trailing line space,
 * paragraph spacing, cell padding, list-marker gutters and margins all return
 * null. `docPos` is the character's own position, so marks are read from
 * `doc.resolve(docPos + 1).marks()` — no left/right ambiguity at boundaries.
 */
glyphAtPoint(x: number, y: number, page: number): GlyphEntry | null;
```

It reuses `lineAtPoint` and the `lineExtents` index `hasTextAt` already
maintains, then binary-searches that line's glyphs by `x`. `hasTextAt` becomes
`glyphAtPoint(...) !== null`.

Block-level padding and spacing need no new data: a point in a paragraph's
`spaceBefore`/`spaceAfter` or a cell's padding has no line under it, so
`lineAtPoint` is already undefined there. The tests pin that down (§Build
order) so a future layout change can't quietly make padding hoverable.

## 4. Node geometry — rects for every node, per page

`getNodeRect` knows images. Popovers need any node, and a table or long
paragraph split across pages has one rect per page.

```ts
/** Every painted fragment of the node at `docPos`, in page order. */
getNodeRects(docPos: number, surfaceId?: string): ObjectRectEntry[];
/** Viewport DOMRects for the same fragments. */
getNodeViewportRects(docPos: number, surfaceId?: string): DOMRect[];
```

Resolution order:

1. Anchored object → its placement (as today).
2. `charMap.objectRects` → inline object (as today).
3. **Layout blocks.** Scan `layout.pages[].blocks` for blocks whose
   `sourceNodePos ?? nodePos` equals `docPos` → one rect per fragment
   (`x, y, width, height` are already on `LayoutBlock`).
4. **Tables.** A table is laid out as `kind: "tableRow"` blocks. Group a page's
   row blocks whose row node sits inside the table at `docPos` and union them →
   one rect per page the table touches. Cells come from `CellSubBlock`
   (`x`, `row.y + cell.y`, `width`, `height`) — the same geometry
   `cellAtCoords` already reads.

`getNodeRect` / `getNodeViewportRect` stay, returning the first fragment, so no
existing caller changes. Popovers anchor to the fragment nearest the pointer
for hover (it is the one the user is looking at) and the first visible fragment
for selection.

Lookup cost: step 3/4 is a scan of one page's blocks (the hovered page is
known), so it stays off the hot path for full documents.

## 5. Popovers — extend, don't fork

Each existing controller gains a hover input and a presentation. No new
`createHoverPopover` factory; the node-actions RFC already flags five
hand-written factories as the problem, and a sixth that duplicates three of
them would make it worse.

```ts
export type PopoverPresentation = "peek" | "full";

export interface LinkPopoverInfo {
  href: string;
  from: number;
  to: number;
  /** "peek" when shown from hover, "full" when the selection is in the link. */
  presentation: PopoverPresentation;
}
// ImageMenuInfo and the new TableMenuInfo gain the same field.

interface LinkPopoverOptions {
  // existing callbacks
  /** Enable hover peeks. Default true. */
  hover?: boolean | { showDelay?: number; hideDelay?: number };
}
```

State machine, per controller:

```
          hover enters target (after showDelay)
 hidden ─────────────────────────────────────────▶ peek
   ▲  ◀──────── hover leaves (after hideDelay) ──── │
   │                                                │ selection enters target
   │                                                ▼
   └──────── selection leaves / focus out ─────── full
```

- **Selection wins.** While a controller is `full`, hover for that controller is
  ignored — this is what stops the selection-driven link popover and a hover
  peek from appearing at once. Hovering a *different* link while one is
  selected does nothing until the selection leaves.
- **Peek → full keeps position.** Same anchor, same element; the content
  grows. React renders via the same component, so there is no unmount flash.
- **Grace period.** `hideDelay` (default 150 ms) lets the pointer cross from the
  anchor into the popover. While the pointer is inside an element carrying
  `data-scrivr-popover`, the peek stays open. `showDelay` default 350 ms.
- **Escape** hides a peek without touching the selection.
- **Scroll / reflow** reposition through `subscribeViewUpdates`, as today.

The controllers share the hover plumbing through one helper beside
`subscribeViewUpdates` / `subscribeEditorFocusOutside`:

```ts
/** Debounced hover for one target kind; calls back with the target or null. */
subscribeHoverTarget(
  editor: IEditor,
  kind: string,
  fn: (target: HoverTarget | null) => void,
  opts: { showDelay: number; hideDelay: number; getPopoverElement?: () => HTMLElement | null },
): () => void;
```

What each presentation shows (defaults; consumers override):

| Target | Peek | Full (selected) |
|---|---|---|
| link | host + path, truncated | URL, Open / Edit / Unlink (today's popover) |
| image | alt text, width × height, wrap mode | today's image menu + node actions |
| table | rows × columns, header row on/off | table node actions (new — first table popover) |
| custom node | extension payload via its hover resolver | node actions for its kind |

### React

`useLinkPopover`, `useImageMenu`, and a new `useTableMenu` return
`presentation` alongside today's fields. `<LinkPopover>`, `<ImageMenu>`,
`<TableMenu>` render the peek when `presentation === "peek"` and accept
`renderPeek` / `renderFull` overrides so host apps (Seraa) can show their own
metadata without rebuilding positioning.

## 6. Surfaces

> Not built in v1 — hover resolves against the body only and is empty while a
> surface is active. See [What shipped](#what-shipped).

`resolveHitTarget` and the new `resolveHoverTargets` build their context from
the state that owns the point:

```ts
const surface = editor.surfaces.activeSurface;
const state =
  surface && regionBelongsTo(point.region, surface) ? surface.state : this.getState();
```

- Active header/footer and the point is in its band → the surface's state;
  targets carry its `surfaceId`.
- Otherwise → the body, `surfaceId: "body"`.
- Inactive chrome bands (`region` `header`/`footer`, no surface active) → empty
  stack. They are dimmed and not editable; matching Word, hover does nothing
  there until the surface is activated.

This fixes click routing too: today a cell click inside an active header table
would resolve against the body doc.

## Decisions (locked)

1. **Popovers are extended, not duplicated.** One popover per target kind with
   `peek` and `full` presentations; no standalone hover-tooltip system.
2. **Selection wins.** A controller in `full` ignores hover.
3. **Hover is transient.** Lives on `PointerController`, broadcast by event;
   never in ProseMirror or plugin state, never sent to collaborators.
4. **Hover resolves a stack; click keeps first-wins.** `resolveHitTarget` is
   unchanged for click routing.
5. **`posAtCoords` keeps nearest-snap.** Strict lookup is a new
   `glyphAtPoint`; no flag on the existing method.
6. **`hitTest` becomes `resolvePagePoint` with regions**, shared by click,
   hover and drags.
7. **`getNodeRects` returns fragments.** Single-rect methods stay as
   first-fragment wrappers.
8. **Deferred: surface-owned state, body fallback**, for both hover and
   click hit testing. Not built in v1; see What shipped.
9. **`HoverTarget.payload` never holds a live `Node`.** Positions go stale on
   the next transaction; controllers re-resolve against current state on every
   update, as `createImageMenu` already does.
10. **No hover on touch.** Selection's full presentation is the touch path.

## Build order

1. **`resolvePagePoint` + `PageRegion`.** Move `hitTest` out of
   `PointerController`; `routePageClick` reads `region`. Existing pointer tests
   pass untouched. New tests: each region, page edges, pageless mode.
2. **`CharacterMap.glyphAtPoint`.** Tests: trailing line space, paragraph
   spacing, cell padding, list-marker gutter, margin all return null; boundary
   between two marks returns the right one.
3. **`getNodeRects` / `getNodeViewportRects`.** Tests: image (inline and
   anchored), paragraph split across pages, table on one page, table split
   across pages, cell.
4. **Surface-aware hit-test context**, with `intent` on `HitTestContext`.
5. **`resolveHoverTargets` + `addHoverResolvers` + `hover` event** on
   `PointerController`. Tests: link in a table cell yields
   `[link, table-cell, table]`; dedupe; empty on drag, gap, touch, keydown,
   pointerleave.
6. **`subscribeHoverTarget` + `presentation`** in `createLinkPopover` and
   `createImageMenu`; their existing tests must pass untouched (they only ever
   see `full`). New table menu controller.
7. **React**: hooks + components + `renderPeek` / `renderFull`; playground demo.

Steps 1–3 are independently useful (sharper click geometry, table rects for the
existing image-menu-style popovers) and can land before hover itself.

## Open questions

- **Read-only mode.** Peek is read-only by nature and seems right there; should
  `full` be reachable in read-only (click a link → popover with Open only)?
  Leaning yes, with actions filtered by `disabled()`.
- **Hover outline.** Should the canvas paint a faint outline on the hovered
  object (Docs does for images)? It would be a geometry primitive driven by
  the hover event, not the selection. Leaning: follow-up, not v1.
- **Ctrl/Cmd+click on links.** Peek makes "open link" one hover + one click
  away. Do we also want modifier-click to open directly, like Docs and Word?
  That would be the first `intent: "pointerdown"` mark resolver.
- **Peek for marks beyond links.** Comments and tracked changes are the obvious
  next consumers (`TrackChangesPopover` is selection-driven today). Confirm the
  `MarkHoverResolver` shape fits them before locking it.
- **Delays.** 350 / 150 ms are guesses from Docs' feel; tune in the playground.

## What shipped

Where the code and the proposal above disagree, this section says so rather
than the proposal being quietly rewritten to match.

### v1 — shipped

Build-order steps 1–3 and 5–7 landed together. Step 4 (surface-aware hit
testing) did not.

**Deviation: no surfaces (decision 8 deferred).** Hover resolves against the
body only, and returns an empty stack while a header or footer surface is
active — the body is dimmed then, so there is nothing in it to peek. Click
routing still builds its hit-test context from the body, so the click-routing
fix §6 promises has not happened either. Surface-owned hover needs surface
geometry (`CharacterMap`, layout pages) to resolve against, which chrome
surfaces do not expose yet.

**Deviation: `intent` was dropped.** §2 step 4 runs every hit tester with
`intent: "hover"` and collects them all. In practice structure needs one
position to walk ancestors from, and click routing's first-wins
`resolveHitTarget` already gives it, so hover calls that and nothing reads an
intent.

**Deviation: mark resolvers own their range, and there is no payload.** §1's
`HoverTarget.payload` and §2's `resolve(mark, range)` are gone: every popover
re-derived what it shows from current state, so a payload was computed on
every frame and never read. A mark resolver answers
`range(doc, pos) → { from, to } | null` instead, because only the extension
knows when two adjacent runs are one instance. `Link`'s resolver is `linkAt`,
the same lookup the caret uses, so hover and the caret agree on where a link
starts and ends. `findMarkRange` (§2's last paragraph) is gone: taking the
min/max over every link run in a textblock made two links in one paragraph
read as one.

**Deviation: the region gate applies to text only.** §3 says hover requires
`region === "content"`. That made an anchored image hanging into the margin
show a move cursor but no peek. An
object or a cell claims a point by its own rect, so ownership and hit-tester
claims are kept anywhere on the page; only the glyph lookup — which has no
rect of its own to say the margin is not text — is held to the content box.
A gap or off-page point is still empty.

**Deviation: `resolvePagePoint` never returns null**, and it is internal along
with `pageRegionAt` and their context types. They need tile geometry only the
pointer controller has. `PagePoint` and `PageRegion` stay public because
`HoverEvent.point` is one.

**Deviation: `glyphAtPoint` scans, it does not binary-search**, and
`hasTextAt` is unchanged — `glyphAtPoint` calls it first, not the other way
round. The scan is one line's glyphs after `lineAtPoint` has found the line,
read from a per-line glyph index the map keeps as glyphs register.

**Deviation: node geometry.** `getNodeRects` takes no `surfaceId` and is
private; `getNodeViewportRects(docPos)` is the public form, and
`getNodeViewportRect(docPos)` is its first entry, so the two agree for every
node. The table menu anchors to the table's first fragment on screen, for
hover and selection alike, not the fragment nearest the pointer; the image
menu anchors to `getNodeViewportRect`. The link popover anchors to the line of
the link the pointer rests on (a peek) or the caret is on (full), from
`getRangeViewportRects(from, to)` — one rect per line, `Range.getClientRects()`
for the canvas — and to the first line still on screen when that one has
scrolled away. Body geometry places body positions only: while a header or
footer is edited, a node lookup that is not an image answers nothing rather
than the body node that shares the number. Fragments are found inside table cells too, so a table nested in
another table's cell gets its own menu.

**Deviation: hover positions are mapped.** §1 says positions go stale on the
next transaction. The editor maps the stack through each body transaction
while the pointer rests, dropping a target whose range was deleted, so a
collaborator's edit does not leave a peek on the old range. It maps them with
`deferEdit`'s anchors, before `"update"` is emitted, so whatever wakes on the
update reads the new positions; `"update"` carries the transaction's
`mapping` for popovers that hold one of their own. Hover events from an edit
carry `fromEdit: true`. A target an edit moved is the same target — its wait
goes on, and a shown peek follows it through `onMove`. One the edit deleted
closes at once rather than after the grace period — waiting would leave it
holding positions that now belong to whatever shifted into them.

The pointer crossing from the page onto a popover keeps the stack, so the
editor goes on mapping what that popover shows; leaving for anywhere else
clears it. A target carries `at`, where in it the pointer rests, kept up to
date without an event, so a wrapped link peeks under the line the pointer is
on when the peek opens.

**Deviation: hover is off by default for images and tables.** §5 has
`hover` default true everywhere. Word, Docs and Pages show no card on hovering
an image or table, so `createImageMenu` and `createTableMenu` default to
`hover: false`. Links keep it on: reading where a link goes without moving
the caret is the problem this RFC set out to solve.

**Deviation: existing popover tests changed.** Build order step 6 expected
`createLinkPopover`'s and `createImageMenu`'s tests to pass untouched. The
image menu's do; the link popover's needed `presentation: "full"` added to
their expected info, since the field is required.

**Escape and typing dismiss.** Any key other than a lone modifier (the UI
Events modifier keys, and Firefox's older `"OS"`) clears hover with
`dismissed: true`, which closes a peek at once, even under the pointer. A
modifier alone does not, so a shortcut or a modifier-click can begin over a
peek.

**Table actions are node actions.** The full table menu renders
`editor.getNodeActions()`, which the `Table` extension contributes for the
`table-cell` kind — row and column inserts and deletes, and Delete table. A
non-React consumer gets them the same way.

**Open question answered: read-only.** Node actions that edit are hidden in a
read-only editor, so a cell selection there has nothing to offer: the table
menu shows its peek instead of an empty full menu.

**One answer for who owns a point.** A table's cells are painted content, so
a `behind` image under a table owns no point inside a cell, glyph or not:
`resolvePointOwner` asks for painted regions as well as text, and the
editor's `pointOwnerAt` builds that question once for click, hover, the hover
cursor and drags. A linked inline image is hovered as the image and as the
link; mark resolvers ask about the character under the point, an object
included.

**Crossing to the peek.** While a peek is open, another target of its kind
swaps in after the hide grace period, not at once, and not at all if the
pointer reaches the peek first: on the way down to a link's peek the pointer
can cross the link below.

**Click reads the point's region.** `routePageClick` takes the `PagePoint`
the pointer controller resolved, so click and hover agree on the region; a
double-click in the gap between pages is no header or footer click.

**Popovers know their target across edits.** Each controller holds the
position that identifies what it shows — a link's start, an image's or
table's position — mapped through edits. The same target moved reports
`onMove`; a different one reports `onShow`. The React hooks read that rather
than comparing positions, so a collaborator's edit no longer cancels a link
edit or overwrites an image size being typed.
