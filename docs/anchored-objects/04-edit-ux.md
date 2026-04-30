# 04 — Edit UX for Anchored Objects

This document defines how users interact with anchored objects:
selecting, dragging, resizing, changing wrap mode, and editing
near anchors.

It follows the model from [`00-model.md`](./00-model.md), the
per-mode behavior from [`01-placement-and-wrap-policies.md`](./01-placement-and-wrap-policies.md),
and the test contract from [`03-test-contract.md`](./03-test-contract.md).

## Core thesis

```
Editing changes structure.
Offsets only change paint.
```

Every editing action — drag, resize, mode toggle, cursor
movement — operates on the **document structure** (the PM doc).
`floatOffset` is reserved for fine visual nudges that the user
chooses not to express structurally. The two channels never
substitute for each other.

The single sharpest expression:

> **Dragging an anchored object edits document structure, not
> visual offset.**

If the engine ever satisfies a drag by writing a large value to
`floatOffset.y`, the model has been violated.

## 1. Selection

| User action | Result |
|---|---|
| Click on the image's painted bounds | Select the anchored object node (NodeSelection) |
| Click on text near the image | Place the cursor in the text, no object selection |
| Click on the anchor span position | Place the cursor at the anchor docPos |
| Shift+click on the image | Extend the selection to include the anchor docPos in the surrounding range |

Hit testing uses the **painted bounds** (object's render rect,
including `floatOffset`). Selection always resolves to the
**structural anchor** — the docPos of the image node — so a
selection survives any subsequent paint nudges.

A consequence: selecting an anchored object whose paint position
has been offset still places the cursor at the anchor's flow
position, not the offset position. This keeps cursor and document
in sync regardless of visual nudges.

## 2. Dragging (the key section)

Dragging is **structural editing**, not visual offset
manipulation.

### What a drag does

```
visual drag → find nearest valid document insertion point
            → move the image node there in the PM doc
            → relayout from scratch
            → floatOffset is left untouched
```

### What a drag MUST NOT do

```
visual drag → floatOffset.x/y = new position - old position
```

Pushing `floatOffset` to track the drag breaks every wrap-mode
contract:

- The solver computes wrap zones from the structural position;
  the painted image ends up far from where text wraps.
- Cross-page drags become impossible (you can't push `offsetY`
  far enough without the image overlapping unrelated content).
- Re-layout doesn't move the image because nothing structural
  changed.

### Drag mechanics

1. **Drag start.** Capture the source anchor docPos and the
   drag origin (mouse Y).
2. **Drag move.** Compute the visual cursor position. Resolve
   the **nearest valid insertion point** — the docPos in the
   document where dropping would put the image. Use the same
   posAtCoords machinery the cursor uses.
3. **Drag preview.** Render a ghost of the image at the cursor
   position (paint-only, doesn't affect flow). Optionally show
   the target anchor position with a caret marker.

   **Preview non-interference rule:** the drag preview must not
   influence hit testing for layout, selection, or insertion-point
   resolution. The preview is a paint artifact only. Without this
   rule, the preview can pick wrong insertion points or flicker
   between the displayed ghost position and the actual resolved
   docPos.
4. **Drag drop.** Issue a transaction: delete the image node
   from its source position, insert it at the resolved target
   position. `floatOffset` is preserved across the move (it's
   the user's nudge preference, not the drag delta).
5. **Layout rerun.** The pipeline runs end-to-end with the new
   anchor position. The contract holds by construction —
   anchor and image land on the same page wherever they go.

### Cross-page drag

Dragging an image to a different page works the same way: the
target docPos lands inside a paragraph on the new page. The
solver places the anchored object at that paragraph's flow
position. No special "move to page N" handling — it's just a
structural move that happens to cross a page boundary.

### Drag within the same paragraph

Dragging within the source paragraph only changes structure if
the anchor crosses a **valid insertion boundary** — e.g. before
or after another inline node, or to a position that changes the
split-fragment ordering. Otherwise the operation is a strict
no-op and **no transaction is emitted**. This prevents
unnecessary reflows when the user lifts the mouse near the
original position.

## 3. Resizing

| User action | What changes |
|---|---|
| Drag a resize handle | `node.attrs.width` and/or `node.attrs.height` |
| Numeric input via panel | same |

**Aspect-ratio rule:** resize must preserve the image's aspect
ratio unless the user explicitly overrides it (e.g. shift-drag,
or unticking a "lock aspect ratio" checkbox). The default
behaviour protects users from accidentally distorting images
when only one dimension is intended to change.

Resize **only changes the node's intrinsic dimensions**. The
layout engine then:

- Updates the anchored-object block's `height` to the new
  `node.height`.
- Recomputes the wrap zone (square modes) or clearance
  (top-bottom) from the new dimensions.
- Reflows constrained sibling blocks against the new wrap zone.

For square modes: a wider image shrinks the available text
column on the wrap side. A taller image extends the wrap zone's
vertical extent.

For top-bottom: a taller image pushes following content further
down (its block height grows).

For behind/front: same as top-bottom, since the block takes its
slot.

## 4. Mode toggle

User changes `wrappingMode` via menu, command, or keyboard
shortcut. Each transition is a structural change:

| From → To | Structural change |
|---|---|
| `inline` → any non-inline | Image stays at its docPos; the anchor span becomes zero-width; the parent paragraph is split at layout time per Rule 2 (no PM doc change, but cursor-position and selection mappings must adapt to the split flow representation — see "Cursor behavior" below). |
| any non-inline → `inline` | The image node's `wrappingMode` updates to `inline`; the parent paragraph stops splitting and lays out as a single text block with the image as inline content. |
| `square-left` ↔ `square-right` | Anchor preserved; flow position preserved; wrap zone moves to the other side. |
| `square-*` → `top-bottom` | Wrap zone replaced with full clearance; following content stacks vertically. |
| `top-bottom` → `square-*` | Clearance replaced with side wrap zone. |
| any wrap → `behind` / `front` | Wrap zone removed; flow slot retained (block still takes its height); paint layer changes. |

After every transition, the contract from `03` must still hold:
following content does not render before the object's flow
effect is satisfied.

## 5. Offset controls

```
floatOffset.x / floatOffset.y are visual-only.
They never change flow, wrap zones, pagination, or anchor
position.
```

UI surfaces (panels, keyboard nudge keys) that adjust offsets
must clamp them to small, sensible ranges (a handful of pixels
in each direction). Large structural moves are NOT offset
adjustments — they are drags or property edits.

If a user wants the image at a different page or at a notably
different vertical position in the page, the right action is
**drag** (or change the anchor docPos directly), not
`floatOffset`.

The pipeline enforces this from the other side: it solves wrap
geometry against the structural position, ignoring `floatOffset`.
A user who pushes `floatOffset.y` past the image's flow position
will see the image render far from its wrap zone — visually
broken, deliberately. This is the model telling the user "use
drag instead."

## 6. Cursor behavior

| User action | Cursor target |
|---|---|
| Cursor before image's anchor docPos | Before the anchor (renders at the anchor span's left edge) |
| Cursor after image's anchor docPos | After the anchor (renders at the anchor span's right edge) |
| Arrow Right past the anchor docPos | Skip past the anchor (treat as one atomic step) |
| Arrow Left past the anchor docPos | Skip past the anchor (treat as one atomic step) |
| Click directly on the painted image | NodeSelection on the image |
| Click in the same line as the anchor span (text content) | Cursor in the text |

Arrow navigation treats the anchored object as **one atomic
unit**, even though Rule 2 splits its parent paragraph into
multiple flow blocks at layout time. The PM doc has the image
as a single inline node; the cursor model respects that.

**Caret-outside rule:** the cursor must never visually appear
inside an anchored object's flow footprint unless the object
mode is `inline`. The caret may render at the anchor span's
left edge (before the image) or right edge (after the image),
but never within the image's painted bounds. This prevents
caret-inside-images, selection glitches, and IME-overlapping-
image artifacts.

For top-bottom, behind, front: the anchor span sits in a
paragraph fragment (text-before or text-after, depending on
where in the source paragraph it lives). Cursor positions
before and after the image map to the docPos before and after
the image node in the source paragraph.

For square modes: same. The anchor span is at the start of the
paragraph (if image is the first child) or wherever the image
is in document order.

## 7. UX anti-rules

These are the things the editor must **never** do. Each anti-rule
exists because the v2 attempt did the opposite and the model
broke.

```
✗ Do not let users move an image without changing its anchor.
✗ Do not create independent page-positioned images.
✗ Do not use floatOffset.y to move an object across pages.
✗ Do not let projection repair bad anchor placement.
✗ Do not silently rewrite floatOffset on layout passes.
✗ Do not snap the anchor to the image's offset position.
```

The complete forbidden pattern:

```
user drags image
  → controller writes floatOffset.y
  → layout re-runs but anchor is unchanged
  → solver places image at anchor.flow_y (no change)
  → renderer paints image at anchor.flow_y + floatOffset.y
  → image visually far from wrap zone
  → text and image disagree about page
```

Every step here is a violation of the model. The drag controller
must instead:

```
user drags image
  → controller computes target docPos from cursor coords
  → transaction moves the image node to target docPos
  → layout re-runs with new anchor position
  → solver places image at NEW anchor.flow_y
  → renderer paints image at solved position
  → contract holds by construction
```

## 8. Edit stability invariant

```
After any edit (drag, resize, mode toggle, offset adjustment),
running the layout pipeline must produce a stable layout —
identical to running the pipeline twice in succession on the
post-edit document.
```

No edit may introduce oscillation or layout drift between
successive pipeline runs. This ties UX back to the solver
guarantees in `02-layout-pipeline.md` (monotonicity,
termination) and the test contract in `03-test-contract.md`
(idempotence). If an edit can be observed to change the layout
on a second pass, either the edit is leaking transient state
into the pipeline, or the solver is non-monotonic — both are
bugs.

This invariant is the bridge between the UX layer and the
engine: it says "nothing the user does should be capable of
producing an unstable layout." Every edit operation defined
above must satisfy it.

## Implementation surfaces

These pieces of the codebase implement the rules above. Naming
matches the current repo:

| Surface | Role |
|---|---|
| `PointerController` (or its replacement) | Hit testing on painted bounds; drag detection. |
| Image extension's drag handler | Resolve cursor coords to docPos; emit `move-anchor` transaction. |
| `InputBridge` | Cursor / arrow navigation; treat image node as atomic. |
| `OverlayRenderer` | Paint drag preview and selection chrome at offset position. |
| Image extension's resize handles | Update `node.attrs.width / height`; trigger layout. |
| Image extension's mode toolbar | Update `node.attrs.wrappingMode`; trigger layout. |

When implementing each surface, refer to:
- this doc for **what** the action does,
- `01-placement-and-wrap-policies.md` for **what wrap/paint
  changes the action causes**,
- `02-layout-pipeline.md` for **what the engine does after the
  edit**,
- `03-test-contract.md` for **what invariants the result must
  satisfy**.

## What this doc does NOT cover

- Touch / pointer specifics (tablet drag, pinch resize) —
  separate input doc.
- Accessibility (keyboard-only object manipulation, screen
  reader announcements) — covered by the broader a11y plan.
- Collaborative editing semantics (concurrent drag from another
  user) — covered by the collaboration doc.

This doc covers the **single-user editing model** for anchored
objects only. Multi-user, multi-modal, and assistive-tech
considerations layer on top of these rules without changing
them.
