# 00 — Anchored Objects: The Model

## Thesis

> An image with a non-inline wrapping mode is not "lifted out of the
> document flow." It becomes an **anchored object** — a document-flow
> participant that exposes effects which shape the content around it.

The CSS-float mental model — "remove from flow, paint as overlay,
patch collisions afterwards" — is explicitly rejected. Every other
document in this directory inherits the vocabulary and rules below.

## Two orthogonal axes: wrap × position

The anchored-object model follows Word's separation: **wrap behavior**
and **horizontal placement** are independent concerns.

```
wrapMode      = how surrounding text is shaped around the image
positionMode  = how the image's anchor moves with the document
xAlign + x    = where the image sits horizontally in the content area
```

In v1, only one `positionMode` is supported: `move-with-text`. The
image's vertical position derives from its anchor; horizontal position
is user-controlled per `xAlign` / `x`.

### `wrapMode` table

| Mode | Flow effect | Wrap effect | Paint effect |
|---|---|---|---|
| `inline` | counts as inline content in its line | participates in line layout | inline rendering |
| `square` | anchor stays in flow; image does NOT add a full-height object block | wrap zone at the image's actual painted rectangle; overlapping lines are constrained to the side(s) with available space | normal layer |
| `top-bottom` | anchored-object block at `anchor.y → anchor.y + image.height + margin` across full flow width | text in that Y range is excluded by the object block; following flow starts below it | normal layer |
| `behind` | anchored-object block at `anchor.y → anchor.y + image.height` | none | painted **behind** text |
| `front` | anchored-object block at `anchor.y → anchor.y + image.height` | none | painted **over** text |

`xAlign` applies to `square`, `top-bottom`, `behind`, and `front`. Values:

| `xAlign` | Image X (within the page content area) |
|---|---|
| `"left"` | `contentX` |
| `"center"` | `contentX + (contentWidth - image.width) / 2` |
| `"right"` | `contentX + contentWidth - image.width` |
| `"custom"` | `node.attrs.x` (clamped to keep image inside the content area) |

`xAlign` is a **structural** attribute — drag updates it (as `"custom"`
plus the resolved `x`); toolbar buttons set it (`left` / `center` /
`right`); layout reads it. There is no separate paint-only X offset.

Detailed semantics, geometry, and wider-side wrap rules per mode live in
[`01-placement-and-wrap-policies.md`](./01-placement-and-wrap-policies.md).

## Vocabulary

| Term | Meaning |
|---|---|
| **anchored object** | A document node (currently `image`) whose `wrapMode` is anything other than `inline`. |
| **`wrapMode`** | How surrounding text is shaped around the image: `inline`, `square`, `top-bottom`, `behind`, `front`. |
| **`positionMode`** | How the anchor moves with the document. v1 supports `"move-with-text"` only. `"fix-on-page"` is deferred. |
| **`xAlign`** | Horizontal placement intent: `"left"`, `"center"`, `"right"`, `"custom"`. |
| **`x`** | Custom horizontal position (used when `xAlign === "custom"`). Content-area-relative. |
| **`margin`** | Per-image breathing room around the wrap zone, in CSS px. |
| **anchor docPos** | The ProseMirror document position of the object's node. |
| **anchor paragraph** | The PM paragraph containing the anchor docPos. |
| **flow effect / flow contribution** | The vertical space the object occupies in flow. Mode-dependent (see Rule 1). |
| **wrap effect / wrap footprint** | The constraint the object imposes on surrounding text. |
| **paint effect** | How the object is rendered, including layer order. |
| **anchored-object block** | A flow block produced by the layout pipeline to represent the object's flow contribution. Emitted only for modes whose flow contribution is non-zero. |
| **wrap zone** | A rectangular region where text is excluded or narrowed — derived from the image's actual painted rectangle. |

> **Naming.** "Float" is a legacy / user-facing term. Internally — and
> in every doc in this directory — the engine uses **anchored object**.
> Do not let "float" leak into design discussions; the old mental
> model creeps back with it.

> **Legacy attrs.** `wrappingMode` (single attribute), `square-left`,
> `square-right`, and `floatOffset` are legacy from the CSS-float-style
> implementation. The new model uses `wrapMode` + `xAlign` + `x`. A
> normalization layer maps legacy values to the new model on read so
> existing documents don't break, but nothing in the layout pipeline
> branches on `wrappingMode` directly.

## Core rules

### Rule 1 — Anchored objects participate in flow

Every non-inline anchored object has its **vertical position**
derived from its anchor's flow position. The engine never
computes a separate "where the object should go" decision
independently of the document. The flow effect — whether the
object adds height to its anchor paragraph's slot — is mode-
dependent:

- `square` — anchor paragraph stays in flow at its natural
  text height. The image does **not** add a full-height block
  slot; instead it imposes a wrap zone at its actual
  painted rectangle. Following content may wrap beside the
  image until the image's bottom is reached.
- `top-bottom` — emits an anchored-object block of height
  `image.height` across the full flow width, with `image.margin`
  as block spacing after it. Following content must start past
  the block.
- `behind` / `front` — emits an anchored-object block of
  height `image.height`. Following content stacks below normally.
  No wrap effect; differs from `top-bottom` only in paint order.

The image's **horizontal position** is independent of flow:
it comes from `xAlign` / `x` on the node attrs and is the
same expression for every non-inline mode. There is no "image
is pinned to the left side" mode — that's `square` with
`xAlign: "left"`.

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

This rule applies to wrap modes whose flow contribution is
non-zero — `top-bottom`, `behind`, `front`. It removes the
chicken-and-egg problem of "the image is inside a paragraph
but the paragraph's height depends on the image's flow effect."

`square` does **not** split its anchor paragraph. The anchor
paragraph stays in flow at its natural text height; the image
is placed at the user's `xAlign` / `x` position with the anchor's
flow Y, and creates a wrap zone that constrains overlapping
lines (in this paragraph and any following paragraphs whose Y
range overlaps the zone).

`inline` of course never splits — the image is part of the line.

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

### Rule 4 — Position is structural; there is no paint-only X/Y offset

The image's position is expressed entirely by `xAlign` / `x` (horizontal)
and the anchor's flow position (vertical). Both are read by the layout
solver. There is **no** paint-only offset attribute that lets the image
render at a position different from where the wrap zone was solved.

Drag mechanics:
- **Horizontal drag** → set `xAlign: "custom"` and `x` to the new content-
  area-relative position. Layout reflows; wrap zone is computed at the
  new rectangle.
- **Vertical drag** → move the PM image node to the docPos of the
  paragraph nearest the painted Y. The anchor docPos and the image's
  visual Y stay co-located by construction.
- **Diagonal drag** → both, atomically in one transaction.

This subsumes the legacy `floatOffset.x` / `floatOffset.y` attributes,
which are retired. Layout never reads them.

### Rule 5 — Anchor and image stay co-located

By construction (Rule 4 drag mechanics) the anchor docPos always sits
in (or directly adjacent to) the paragraph nearest the image's painted
position. The user never observes "the image is here but its docPos is
elsewhere." Click-the-image targets the same docPos that vertical drag
would resolve to.

For pagination, this also means: if a `top-bottom` / `behind` / `front`
object cannot fit on its anchor's page, the anchor moves to the next
page too, taking the object with it. (The `square` case is handled by
the wrap zone — text wraps; nothing is "pushed.")

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

- **Fix Position on Page** (`positionMode: "fix-on-page"`) — image
  pinned to a page rather than tracking the anchor through flow.
- **Image splitting** — taller-than-page images visually splitting
  across pages.
- **Anchor independent of the cursor's paragraph** — Word lets users
  move the anchor without moving the image's visual position.
- **Tight / through wrap** — non-rectangular wrap zones following
  the image's alpha shape; user-edited wrap boundary.
- **Two-sided wrap** — text simultaneously on both sides of an image
  in the same line (a line with a "hole" in the middle). v1 uses
  wider-side wrap: each line picks the side with more available
  space.

These are documented in `05-future.md` as deferred work. The v1
contract assumes:
- Every anchored object has exactly one anchor in flow.
- `positionMode === "move-with-text"` — anchor and image stay
  co-located by drag mechanics (Rule 5).
- Oversized objects render at their anchor and accept visual overflow.
- Wrap zones are rectangular.
- Lines that overlap a `square` wrap zone wrap on a single side
  (the side with more available width).

## OOXML mapping

The v1 model is a strict subset of Word's anchored-object model from
ECMA-376 / OOXML. Names line up so future import/export work doesn't
need translation:

| Our model | OOXML / Word |
|---|---|
| `wrapMode: "inline"` | image is a normal inline run; no `<wp:anchor>` |
| `wrapMode: "square"` | `<wp:wrapSquare wrapText="…"/>` |
| `wrapMode: "top-bottom"` | `<wp:wrapTopAndBottom/>` |
| `wrapMode: "behind"` | `<wp:wrapNone/>` + `behindDoc="1"` on `<wp:anchor>` |
| `wrapMode: "front"` | `<wp:wrapNone/>` + `behindDoc="0"` on `<wp:anchor>` |
| `xAlign: "left"` | `<wp:positionH relativeFrom="margin"><wp:align>left</wp:align></wp:positionH>` |
| `xAlign: "center"` | `<wp:positionH relativeFrom="margin"><wp:align>center</wp:align></wp:positionH>` |
| `xAlign: "right"` | `<wp:positionH relativeFrom="margin"><wp:align>right</wp:align></wp:positionH>` |
| `xAlign: "custom"`, `x` | `<wp:positionH relativeFrom="margin"><wp:posOffset>…</wp:posOffset></wp:positionH>` |
| `wrapText` | `wrapText` attribute on `<wp:wrapSquare/>` (`largest` / `left` / `right` / `bothSides`) |
| `positionMode: "move-with-text"` | implicit when `<wp:positionV>` is anchor- or paragraph-relative |
| (deferred) `positionMode: "fix-on-page"` | `<wp:positionV relativeFrom="page">` |
| (deferred) tight wrap | `<wp:wrapTight>` + `<wp:wrapPolygon>` |
| (deferred) through wrap | `<wp:wrapThrough>` + `<wp:wrapPolygon>` |

The hard-coded `relativeFrom="margin"` for v1 means our `x` is
content-area-relative. When F1 (page-anchored objects) ships, the
attribute set extends with `relativeFrom: "page" | "margin"` — the
existing v1 attrs remain valid, and the new value adds page-anchored
support without breaking documents.

> **Avoid: `shapeLayoutLikeWW8`.** The OOXML compat flag that lets
> text flow under a wrapped image when its anchor would push to the
> next page is **the exact pattern we ripped out of v2**. It exists
> in Word for backward compatibility; we have no such constraint.
> Permanently rejected — see `05-future.md` § Permanently out of scope.

## Document map

| Doc | Role |
|---|---|
| [`00-model.md`](./00-model.md) | (this) the model and vocabulary — spine |
| [`01-placement-and-wrap-policies.md`](./01-placement-and-wrap-policies.md) | per-mode placement and wrap mechanics |
| [`02-layout-pipeline.md`](./02-layout-pipeline.md) | how the engine produces layouts |
| [`03-test-contract.md`](./03-test-contract.md) | invariants and the test contract |
| [`04-edit-ux.md`](./04-edit-ux.md) | drag, click, resize, mode toggle |
| [`05-future.md`](./05-future.md) | explicitly-deferred work |
