# 00 — Anchored Objects: The Model

## Thesis

> An image with a non-inline wrapping mode is not "lifted out of the
> document flow." It becomes an **anchored object** — a document-flow
> participant that exposes effects which shape the content around it.

The CSS-float mental model — "remove from flow, paint as overlay,
patch collisions afterwards" — is explicitly rejected. Every other
document in this directory inherits the vocabulary and rules below.

## The three independent effects

An anchored object has three orthogonal effects, chosen by its
`wrappingMode`:

1. **Flow effect** — where the object occupies vertical space.
2. **Wrap effect** — how surrounding text is constrained around it.
3. **Paint effect** — how it is rendered.

Each effect is independent. A mode is a chosen combination of the three.

### Mode table

| Mode | Flow effect | Wrap effect | Paint effect |
|---|---|---|---|
| `inline` | counts as inline content in its line | participates in line layout | inline rendering |
| `square-left` | footprint at `anchor.y → anchor.y + height` on the left side | text in the same vertical range narrows to the right of the object | normal layer |
| `square-right` | footprint at `anchor.y → anchor.y + height` on the right side | text in the same vertical range narrows to the left of the object | normal layer |
| `top-bottom` | footprint at `anchor.y → anchor.y + height` across full content width | text in the same vertical range is excluded; following flow starts at object.bottom | normal layer |
| `behind` | footprint at `anchor.y → anchor.y + height` (block takes its slot) | none | painted **behind** text |
| `front` | footprint at `anchor.y → anchor.y + height` (block takes its slot) | none | painted **over** text |

Detailed semantics, geometry, and stacking rules per mode live in
[`01-placement-and-wrap-policies.md`](./01-placement-and-wrap-policies.md).

## Vocabulary

| Term | Meaning |
|---|---|
| **anchored object** | A document node (currently `image`) whose `wrappingMode` is anything other than `inline`. |
| **anchor docPos** | The ProseMirror document position of the object's node. |
| **anchor paragraph** | The PM paragraph containing the anchor docPos. |
| **flow effect / flow contribution** | The vertical space the object occupies in flow. Always `image.height` for non-inline modes. |
| **wrap effect / wrap footprint** | The constraint the object imposes on surrounding text. |
| **paint effect** | How the object is rendered, including layer order. |
| **anchored-object block** | A flow block produced by the layout pipeline to represent the object's flow contribution. |
| **wrap zone** | A rectangular region where text is excluded or narrowed. |
| **flow clearance** | A vertical Y barrier requiring following content to start at or below it. |

> **Naming.** "Float" is a legacy / user-facing term. Internally — and
> in every doc in this directory — the engine uses **anchored object**.
> Do not let "float" leak into design discussions; the old mental
> model creeps back with it.

## Core rules

### Rule 1 — Anchored objects participate in flow

An anchored object is a flow participant for every non-inline
mode — `square-left`, `square-right`, `top-bottom`, `behind`,
and `front` alike. There is no "lifted out of flow" overlay
model. The layout pipeline materializes an **anchored-object
block** of height `image.height` at the anchor's flow position
for every non-inline mode. The object's vertical position
derives from its anchor's flow position; the engine never
computes a separate "where the object should go" decision
independently of the document.

The wrap effect varies by mode. The flow contribution is
uniform — every non-inline anchored object occupies its slot
in flow.

### Rule 2 — Inline-anchored objects split their paragraph

If a paragraph contains:

```
text-before + non-inline image + text-after
```

the layout pipeline normalizes it into three flow blocks:

```
fragment(text-before)
anchored-object-block(image)
fragment(text-after)
```

This rule applies to **any non-inline wrap mode**. It removes the
chicken-and-egg problem of "the image is inside a paragraph but the
paragraph's height depends on the image's wrap zone."

The split is purely a **layout-time normalization**. The ProseMirror
document is not modified — the source paragraph remains a single
node. The cursor still navigates the source paragraph as one
logical unit. Only the layout engine sees the three fragments.

How the three fragments are positioned relative to the
anchored-object-block (stacked vs. side-by-side) is mode-dependent
and detailed in `01-placement-and-wrap-policies.md`.

### Rule 3 — The anchor docPos identifies the object, not its position

The anchor docPos is the cursor target for selecting the object
(clicking the image jumps the cursor here). It does **not** define
the object's visual position — the object's position derives from
its flow placement. The anchor span itself is zero-width and
zero-height and carries no layout weight.

### Rule 4 — `floatOffset` is a visual nudge, not a structural position

`floatOffset.x` and `floatOffset.y` move the **paint position** of
the object relative to its flow position. They do **not** change
the object's flow effect or wrap effect. Wrap geometry is solved
against the structural flow position, not the offset position.

This means: dragging an image with the mouse must update the
**structural anchor** (re-insert the node at the new doc position,
possibly into a different paragraph), not push `floatOffset.y` to
a large value. Edit UX details live in `04-edit-ux.md`.

### Rule 5 — The anchor moves with its containing paragraph

When pagination places the anchor paragraph on a page, the
anchored object goes with it. There is no "fix to page" toggle in
v1 (deferred — see `05-future.md`). Consequence: if a wrapping
object cannot fit on its anchor's page, the **anchor moves to the
next page too**, taking the object with it.

## The strongest invariant

```
For any anchored object O at docPos D, no document content with a
docPos > D may render at a (page, y) earlier than the position
where O's flow effect has been satisfied.
```

In words: following content never appears visually before the
anchored object it follows in document order. This is the main
bug-killer — once it holds by construction, the entire class of
"image and text detached" / "text appears above its image after
pagination" / "click-the-image-jumps-to-wrong-page" bugs is
eliminated.

`03-test-contract.md` pins this as the universal contract test.

## Out of scope for v1

These exist in Word/Docs but are explicitly **not** part of the v1 model:

- **Page-anchored objects** — objects pinned to a page rather than
  to flow content.
- **Image splitting** — taller-than-page images visually splitting
  across pages.
- **Anchor independent of the cursor's paragraph** — Word lets users
  move the anchor without moving the image's visual position.
- **Tight / through wrap** — non-rectangular wrap zones following
  the image's alpha shape.

These are documented in `05-future.md` as deferred work. The v1
contract assumes:
- Every anchored object has exactly one anchor in flow.
- The anchor moves with its containing paragraph (Rule 5).
- Oversized objects render at their anchor and accept visual
  overflow.
- Wrap zones are rectangular.

## Document map

| Doc | Role |
|---|---|
| [`00-model.md`](./00-model.md) | (this) the model and vocabulary — spine |
| [`01-placement-and-wrap-policies.md`](./01-placement-and-wrap-policies.md) | per-mode placement and wrap mechanics |
| [`02-layout-pipeline.md`](./02-layout-pipeline.md) | how the engine produces layouts |
| [`03-test-contract.md`](./03-test-contract.md) | invariants and the test contract |
| [`04-edit-ux.md`](./04-edit-ux.md) | drag, click, resize, mode toggle |
| [`05-future.md`](./05-future.md) | explicitly-deferred work |
