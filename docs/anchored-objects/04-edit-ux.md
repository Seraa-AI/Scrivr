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

A drag updates two channels in **one atomic transaction**:

```
horizontal channel (X)  → setAttrs({ xAlign: "custom", x: <newX> })
vertical channel (Y)    → moveNode to docPos of paragraph nearest the painted Y
```

Pure horizontal drag = setAttrs only.
Pure vertical drag = moveNode only.
Diagonal drag = both, in one transaction.

After the transaction commits, layout reruns. Anchor and image are
co-located by construction (anchor docPos sits in the paragraph
nearest the image's painted Y; image's painted X matches `xAlign` /
`x`). There is no "anchor and image disagreed" intermediate state.

### What a drag MUST NOT do

```
visual drag → floatOffset.x/y = newPosition - oldPosition
```

Layout never reads `floatOffset`. Writing it gives the image a paint
position the layout solver doesn't know about — the wrap zone is
solved against the structural position while the image renders
elsewhere. Same class of bug as the v2 attempt's offset-driven
constraint drift.

### Drag mechanics

1. **Drag start.** Capture the source anchor docPos and the drag
   origin (mouse X / Y) in page-relative coordinates.
2. **Drag move.** Compute the live cursor position. Resolve the
   **target docPos** = the docPos of the paragraph nearest the
   painted Y. Resolve the **target X** = the painted X clamped to
   the content area.
3. **Drag preview.** Render a ghost of the image at the cursor
   position (paint-only, doesn't affect flow).

   **Preview non-interference rule:** the drag preview must not
   influence hit testing for layout, selection, or
   insertion-point resolution. The preview is a paint artifact
   only.
4. **Drag drop.** Issue **one transaction** containing the
   composite update:

   ```
   tr.setNodeAttrs(imagePos, { xAlign: "custom", x: targetX })
     .moveNode(imagePos, targetDocPos)   // only if targetDocPos differs
   ```

   Both channels commit together. If the target docPos equals the
   source, the moveNode is omitted and only the X attrs change.
   If the target X is unchanged (pure vertical drag), the
   setNodeAttrs is omitted.
5. **Layout rerun.** The pipeline runs end-to-end with the new
   attrs. The image renders at the new (X, Y); the wrap zone is
   solved at the same rectangle. Anchor docPos matches the
   painted Y by construction.

### Cross-page drag

Dragging an image to a different page is just a vertical drag whose
target docPos happens to land in a paragraph on a different page.
The transaction moves the node, layout re-runs, the image renders on
the new page. No special "move to page N" handling.

### Drag within the same paragraph

For pure horizontal drag (no vertical component), the docPos doesn't
change — only `xAlign` and `x` update. This is the common
"slide image left/right" interaction and was structurally a no-op in
the legacy `square-left` / `square-right` model. The new model
expresses it cleanly.

For mixed drag where the visual Y crosses a paragraph boundary, the
target docPos changes; both channels commit.

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
- Recomputes the wrap zone for square modes. For top-bottom,
  the anchored-object block's height and `spaceAfter` carry the
  vertical flow.
- Reflows constrained sibling blocks against the new wrap zone.

For square modes: a wider image shrinks the available text
column on the wrap side. A taller image extends the wrap zone's
vertical extent.

For top-bottom: a taller image pushes following content further
down (its block height grows).

For behind/front: same as top-bottom, since the block takes its
slot.

## 4. Mode toggle and align toolbar

User changes `wrapMode` and/or `xAlign` via menu, command, toolbar
button, or keyboard shortcut.

### `wrapMode` transitions

| From → To | Structural change |
|---|---|
| `inline` → any non-inline | `node.attrs.wrapMode` updates; if the new mode has non-zero flow contribution (`top-bottom`, `behind`, `front`), the parent paragraph splits at layout time (Rule 2). For `square`, no split — the anchor span stays inline at its docPos. |
| any non-inline → `inline` | `node.attrs.wrapMode` updates; the parent paragraph stops splitting (if it was) and lays out as a single text block with the image as inline content. |
| `square` → `top-bottom` | Wrap zone replaced with a full-width anchored-object block; the image's flow contribution becomes `image.height + margin`; following paragraphs stack below. `xAlign` / `x` preserved (image renders at the same X within the new full-width block). |
| `top-bottom` → `square` | Full-width anchored-object block removed; wrap zone emitted at the image's painted rectangle; following paragraphs may now wrap beside. `xAlign` / `x` preserved. |
| any non-inline → `behind` / `front` | Wrap zone (if any) removed; flow slot retained at `image.height`; paint layer changes. |
| `behind` ↔ `front` | Paint layer flips; no other change. |

### Align toolbar

Toolbar buttons update `xAlign` directly:

| Button | Sets |
|---|---|
| Left | `xAlign: "left"` (image flush at `contentX`) |
| Center | `xAlign: "center"` |
| Right | `xAlign: "right"` (image flush at right edge) |
| (Drag overrides) | `xAlign: "custom"`, `x: <draggedX>` |

Toggling between the three named alignments is a pure attrs update.
`x` is left untouched (it only takes effect when `xAlign` is
`"custom"`), so a user can drag for fine placement, click "Center"
to snap, then click "Custom" (or drag again) to recall their
custom X if the editor exposes that.

After every transition, the contract from `03` must still hold:
following content does not render before the object's flow
effect is satisfied.

### Wrap-side hint (Square only)

The wrap-mode picker's "Square" entry must communicate that v1 wraps
on the wider side only — not both sides simultaneously. Required
tooltip text:

> Text wraps on the wider side. Two-sided wrap is deferred.

This sets accurate expectations for centered images, where Google
Docs would split text across both sides of the image. v1 leaves the
narrower side empty by design — see `05-future.md` § F7 for the
follow-up that lifts this restriction.

## 5. Position is structural; no paint-only offset

```
xAlign / x are structural attributes.
There is no separate paint-only X or Y offset.
```

The legacy `floatOffset.x` / `floatOffset.y` attributes are retired
in v1. Layout never reads them. Position changes go through `xAlign`
and `x`:

- "Slide image left/right" — drag horizontally → setAttrs(`xAlign:
  "custom"`, `x: <newX>`).
- "Snap to left / center / right" — toolbar button → setAttrs(`xAlign:
  "left" | "center" | "right"`).
- "Fine vertical adjustment" — there is none. Vertical position is
  the anchor's flow Y. To move the image vertically, the user must
  edit document content above it (insert / delete paragraphs) or
  vertically drag the image (which moves the anchor docPos).

This is intentional: the model never has two channels expressing
position. There is no scenario where a paint position differs from
the structural position, so no scenario where wrap geometry and
visible image diverge.

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
✗ Do not let vertical movement update floatOffset (or any paint-only Y).
✗ Do not let horizontal movement update floatOffset (or any paint-only X).
✗ Do not encode horizontal placement in wrapMode (no square-left / square-right).
✗ Do not write attrs in two transactions (X then Y) — combine them so layout sees one consistent state.
✗ Do not let projection repair anchor / image placement disagreements.
✗ Do not snap the anchor to a position other than what the user dragged to.
✗ Do not let layout read `floatOffset` (legacy attribute, retired).
```

The complete forbidden pattern (from v2):

```
user drags image right
  → controller writes floatOffset.x = 200
  → layout re-runs; solver ignores floatOffset (correct)
  → image renders at anchor's flow position + 200px (paint-only)
  → wrap zone solved at original X
  → text wraps as if image was at xAlign:left, but image renders centered
  → visually broken
```

```
user drags image down
  → controller writes floatOffset.y = 300
  → layout re-runs but anchor docPos unchanged
  → solver places image at anchor.flow_y (no Y change)
  → renderer paints image at anchor.flow_y + floatOffset.y
  → image visually distant from wrap zone
  → text and image disagree about page
```

The correct pattern:

```
user drags image right
  → controller commits tr.setNodeAttrs(imagePos, {
      xAlign: "custom",
      x: targetX
    })
  → layout re-runs with new attrs
  → solver places image at targetX, wrap zone at the new rectangle
  → contract holds by construction

user drags image down
  → controller computes target docPos from painted Y
  → controller commits tr.moveNode(imagePos, targetDocPos)
  → layout re-runs with new anchor position
  → solver places image at NEW anchor's flow_y
  → contract holds by construction

user drags diagonally
  → controller commits BOTH in one transaction:
      tr.setNodeAttrs(imagePos, { xAlign: "custom", x: targetX })
        .moveNode(imagePos, targetDocPos)
  → layout re-runs once, image lands at (targetX, new flow_y)
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
| Image extension's mode + align toolbar | Update `node.attrs.wrapMode` (mode buttons) and `node.attrs.xAlign` (align buttons); trigger layout. |

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
