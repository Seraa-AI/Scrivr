# 01 — Placement and Wrap Policies

This document specifies, mode by mode, how an anchored object is
**placed** (its geometry on the page) and how its **wrap effect**
constrains surrounding content.

It assumes the model and vocabulary in [`00-model.md`](./00-model.md).
Pipeline mechanics — the order in which the engine computes these
results — live in [`02-layout-pipeline.md`](./02-layout-pipeline.md).

## Common geometry

Every anchored object has these intrinsic properties from its node:

| Property | Source | Meaning |
|---|---|---|
| `width` | `node.attrs.width` | rendered width, in CSS px |
| `height` | `node.attrs.height` | rendered height, in CSS px |
| `wrapMode` | `node.attrs.wrapMode` | wrap behaviour: `inline`, `square`, `top-bottom`, `behind`, `front` |
| `positionMode` | `node.attrs.positionMode` | v1: `"move-with-text"` only |
| `xAlign` | `node.attrs.xAlign` | `"left"`, `"center"`, `"right"`, `"custom"` |
| `x` | `node.attrs.x` | content-area-relative X when `xAlign === "custom"` |
| `wrapText` | `node.attrs.wrapText` | `"largest"` (default, v1), `"left"`, `"right"`. (`"bothSides"` reserved — see `05-future.md` § F7.) Per-image override of which side text wraps on. |
| `margin` | `node.attrs.margin` | breathing room around the wrap zone, in CSS px (default `FLOAT_MARGIN`) |
| anchor docPos | the node's PM position | the cursor target / flow anchor |

> **Visual extent vs. node bounds.** The wrap zone is computed from
> the image's **visual extent** — `image.bounds + margin` plus any
> per-image `effectExtent` (drop shadows, glows, reflections). v1
> has no image effects, so visual extent equals `image.bounds +
> margin`; the abstraction is in place so future shadow/glow features
> don't break wrap geometry. Conceptually mirrors OOXML's
> `<wp:effectExtent>`.

Within a page, content is bounded by the page's content area, defined
by `PageMetrics`:

```
contentX      = margins.left
contentRight  = pageWidth - margins.right
contentTop    = margins.top                  (+ chrome contributions)
contentBottom = pageHeight - margins.bottom  (- chrome contributions)
contentWidth  = contentRight - contentX
```

`FLOAT_MARGIN = 8px` is the standard breathing room between an
anchored object's footprint and surrounding content. (Subject to
revisit; small enough to feel tight without text-touching-image.
Per-image override via `node.attrs.margin`.)

### Resolved horizontal X (every non-inline mode)

```
function resolveX(width, xAlign, x, contentX, contentWidth):
  switch xAlign:
    "left":   return contentX
    "center": return contentX + max(0, (contentWidth - width) / 2)
    "right":  return contentX + contentWidth - width
    "custom": return clamp(x, contentX, contentX + contentWidth - width)
```

The same expression applies for `square`, `top-bottom`, `behind`, and
`front`. Wrap behaviour, flow contribution, and paint order vary by mode;
horizontal placement does not.

> **Legacy.** A pre-existing node with `wrappingMode: "square-left"` is
> normalized to `wrapMode: "square", xAlign: "left"`. Likewise
> `"square-right"` → `wrapMode: "square", xAlign: "right"`. The
> normalization runs once at attribute read; the layout pipeline never
> sees `square-left` or `square-right`.

## Inline (`wrapMode: "inline"`)

Not an anchored object — included for completeness.

- **Flow:** the image is a normal inline span; it contributes its
  width to the line and its height to the line's metrics
  (subject to `verticalAlign`).
- **Wrap:** none — line layout treats it as a token.
- **Paint:** rendered inline at its line position.
- **Split:** none — Rule 2 does not apply.

## Square (`wrapMode: "square"`)

The product mode. Image sits at the user-controlled X within the
anchor's flow row; surrounding text wraps around the image's actual
painted rectangle.

### Flow effect

The anchor paragraph stays in flow at its natural text height. The
image does **not** add a full-height block clearance. There is no
anchored-object block of `image.height` reserved between the anchor
paragraph and the next paragraph. The image's vertical footprint is
expressed only through its wrap zone.

### Placement

```
imageX = resolveX(width, xAlign, x, contentX, contentWidth)
imageY = anchor.flow_y               (anchor paragraph's natural Y)
```

If the image is taller than the anchor paragraph's natural height, the
extra height is "absorbed" by the wrap zone — following paragraphs
wrap until the image's bottom is reached.

### Wrap effect (the wrap zone)

```
zone.left   = imageX - margin
zone.right  = imageX + width + margin
zone.top    = imageY - margin
zone.bottom = imageY + height + margin
```

The zone is the image's actual painted rectangle plus margin.

For each line of text whose Y range overlaps `[zone.top, zone.bottom]`,
the layout computes the available regions:

```
leftAvail  = max(0, zone.left  - contentX)
rightAvail = max(0, contentRight - zone.right)
```

### `wrapText` selection

The image's `wrapText` attribute selects which side(s) text wraps on:

| `wrapText` | Behaviour |
|---|---|
| `"largest"` (default) | Each line picks the side with more available width. If both sides are exactly equal, picks the right (deterministic tie-break). |
| `"left"` | Lines wrap **only on the left** of the image. If `leftAvail < line.required`, the line clears below the zone. |
| `"right"` | Lines wrap **only on the right** of the image. If `rightAvail < line.required`, the line clears below the zone. |
| `"bothSides"` | (deferred — F7) Single line straddles the image with text on both sides. |

For `"largest"`, lines that don't fit on either side clear past
`zone.bottom`.

In practice with default `"largest"`:
- Image at `xAlign: "left"` → `leftAvail = 0`, lines wrap on the right.
- Image at `xAlign: "right"` → `rightAvail = 0`, lines wrap on the left.
- Image centered → both sides have room; lines pick the wider (or
  right on tie).

A user can override the natural choice by setting `wrapText: "left"`
on a right-aligned image (forcing text on the narrow left strip),
matching Word's per-image wrap-side control.

**`wrapText: "bothSides"` (a single line using both sides simultaneously,
with the image as a hole)** is explicitly deferred — see `05-future.md`
§ F7.

### Cross-paragraph wrap

The wrap zone applies to **any** content whose Y range overlaps it,
including paragraphs that come *after* the anchor paragraph. A short
anchor paragraph followed by a long paragraph still wraps the long
paragraph beside the image until the image's bottom is reached.

### Inline-anchored behaviour (no split)

`square` does **not** invoke Rule 2's paragraph split. The anchor
paragraph stays as one flow block with a zero-width anchor span at
the image's docPos. Paragraph text laid out normally; lines whose Y
falls in the wrap zone get the wider-side constraint.

### Paint

Rendered on the **normal layer** (between behind and front images,
above the page background, below cursor and selection).

## Top-bottom (`wrapMode: "top-bottom"`)

### Placement

```
imageX = resolveX(width, xAlign, x, contentX, contentWidth)
blockY = anchor.flow_y
imageY = blockY
```

The block reserves the **full flow width** (`contentWidth`) regardless
of `image.width`. Following content stacks below `blockY +
image.height`. The image inside the block renders at the resolved
`imageX`.

### Wrap effect

A **flow clearance** is emitted at `blockY + image.height + margin`.
Following flow blocks must start at or below this Y. There is no side
wrap zone — text never sits beside a top-bottom object.

### Inline-anchored split (Rule 2)

```
[text-before]  fragment, above the image-block
[image-block]  at flow_y, takes full content width
[text-after]   fragment, starts at image-block.bottom + margin
```

All three stack vertically.

### Paint

Normal layer.

## Behind (`wrapMode: "behind"`)

### Placement

Same as `top-bottom` — block reserves full flow width with `image.height`:

```
imageX = resolveX(width, xAlign, x, contentX, contentWidth)
blockY = anchor.flow_y
imageY = blockY
```

The block participates in flow as a normal block of height
`image.height`. Following content goes below.

### Wrap effect

None. Text is never constrained by a `behind` anchored object.

### Inline-anchored split (Rule 2)

Applies. Paragraph splits into `text-before / image-block / text-after`
which stack vertically.

### Paint

Rendered **behind** the page's text content. Drawn before the text
painting pass.

## Front (`wrapMode: "front"`)

Identical placement, wrap, split, and following-content behaviour as
`behind`. Differs only in paint:

- **Paint:** Rendered **above** the page's text content. Drawn after
  the text painting pass.

## Stacking semantics

Anchored-object blocks (modes with non-zero flow contribution —
`top-bottom`, `behind`, `front`) stack with adjacent flow blocks
under normal block pagination. They impose no inter-block side
wrap, so they neither push square-mode wrap zones sideways nor get
pushed sideways themselves.

`square` objects do **not** participate in block stacking — they have
zero flow contribution. Two `square` images anchored to the same
paragraph (or to neighbouring paragraphs whose Y ranges overlap) may
collide horizontally if their wrap zones overlap. v1 behaviour:

- If two `square` zones horizontally overlap and both have content
  on the available side: the second image's wrap zone is treated as
  taking precedence in the overlap region (lines reading top-down
  resolve against whichever zone they hit first).
- If a `square` and a non-`square` block overlap in Y range, the
  non-`square` block's flow contribution comes first; the `square`
  zone affects only the `square` image's anchor paragraph's lines
  and any subsequent paragraphs until the zone's bottom.

This is rough but adequate for v1 — adversarial multi-image
overlapping designs are uncommon.

## Edge cases

### Object wider than the content area

`width > contentWidth`: `resolveX` clamps the image to fit, and the
wrap zone collapses to no available width on either side. Lines in
the zone Y range clear below.

### Object taller than the page content area

`height > pageContentHeight`: the image renders at its anchor's page,
overflowing visually. The wrap zone extends past the page bottom.
Following content on subsequent pages is unaffected (the zone doesn't
re-emerge on page N+1). Image splitting is deferred — see `05-future.md`.

### `xAlign === "custom"` with stale `x`

If `x` was set by a drag in a different document state (e.g. content
width changed via margin edits), the placement clamps `x` so the image
remains entirely inside the content area. The PM doc retains the
original `x` value for round-trip integrity.

### Multiple anchored objects in one paragraph

A paragraph may contain more than one non-inline anchor span. For
modes that split (Rule 2), each split point produces its own
anchored-object block. `square` images in the same paragraph contribute
multiple wrap zones; the paragraph's lines are constrained by the
union (for v1's wider-side wrap, by whichever zone overlaps each
specific line's Y range).

## Mode summary table

| Mode | Splits paragraph? | Flow contribution | Wrap zone | Horizontal X | Paint layer |
|---|---|---|---|---|---|
| `inline` | no | inline | none | inline | inline |
| `square` | no | none (anchor stays in flow at text height) | image rectangle | `xAlign` / `x` | normal |
| `top-bottom` | yes | `image.height`, full flow width | none (block claims full width) | `xAlign` / `x` (image renders inside the full-width block) | normal |
| `behind` | yes | `image.height`, full flow width | none | `xAlign` / `x` | behind text |
| `front` | yes | `image.height`, full flow width | none | `xAlign` / `x` | over text |

The differences between the four non-inline modes are entirely in
**flow contribution**, **wrap effect**, and **paint layer**. Horizontal
placement is uniform — every mode resolves X via the same `xAlign` /
`x` expression.
