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
| `wrappingMode` | `node.attrs.wrappingMode` | which mode applies |
| `floatOffset.x` | `node.attrs.floatOffset.x` | visual nudge applied to paint X only |
| `floatOffset.y` | `node.attrs.floatOffset.y` | visual nudge applied to paint Y only |
| `anchor docPos` | the node's PM position | the cursor target / flow anchor |

Within a page, content is bounded by the page's content area, defined
by `PageMetrics`:

```
contentX     = margins.left
contentRight = pageWidth - margins.right
contentTop   = margins.top                (+ chrome contributions)
contentBottom = pageHeight - margins.bottom (- chrome contributions)
contentWidth = contentRight - contentX
```

`FLOAT_MARGIN = 8px` is the standard breathing room between an
anchored object's footprint and surrounding content. (Subject to
revisit; small enough to feel tight without text-touching-image.)

## Inline (`wrappingMode: "inline"`)

Not an anchored object — included for completeness.

- **Flow:** the image is a normal inline span; it contributes its
  width to the line and its height to the line's metrics
  (subject to `verticalAlign`).
- **Wrap:** none — line layout treats it as a token.
- **Paint:** rendered inline at its line position.
- **Split:** none — Rule 2 does not apply.

## Square-left (`wrappingMode: "square-left"`)

### Placement

The anchored-object block is placed at:

```
x      = contentX + floatOffset.x        (clamped to ≥ contentX)
y      = anchor.flow_y
width  = node.width
height = node.height
```

The block sits flush left within its anchor's flow position. Its
right edge is `x + width`.

### Wrap effect

The object exposes a **wrap zone**:

```
zone.left   = contentX
zone.right  = x + width + FLOAT_MARGIN
zone.top    = y - FLOAT_MARGIN
zone.bottom = y + height + FLOAT_MARGIN
```

Any line whose Y range overlaps `[zone.top, zone.bottom]` and whose
horizontal extent would intersect the zone gets a **line constraint**:

```
line.startX = zone.right
line.maxWidth = contentRight - line.startX
```

That is: text shifts to the right of the object and uses the
remaining width. Lines outside the zone use full content width.

### Inline-anchored split (Rule 2)

If the anchor lives inside a paragraph that also has text
before/after it:

```
[text-before]  fragment, full width, above the object
[image-block]  the anchored-object block at flow_y
[text-after]   fragment, shares the same flow start as the
               image-block and is constrained by its wrap policy
```

Key consequence: `text-after` does **not** stack below
`image-block`. It starts at the same Y, wraps under the image's
wrap policy, and continues past `image.bottom` at full width if
it has more lines.

### Cross-paragraph wrap

The wrap zone applies to **any** content whose Y overlaps it,
including paragraphs that come *after* the anchor paragraph. A
short anchor paragraph followed by a long paragraph still wraps
the long paragraph beside the image until the image's bottom is
reached.

### Following content

The first flow block whose top is ≥ `image.bottom + FLOAT_MARGIN`
is the first one that uses full content width again.

### Paint

Rendered on the **normal layer** (between behind and front images,
above the page background, below cursor and selection).

`floatOffset.x / floatOffset.y` shift the paint position only. The
flow placement and wrap zone do not move.

## Square-right (`wrappingMode: "square-right"`)

Mirror of square-left.

### Placement

```
x      = contentRight - width + floatOffset.x   (clamped to ≤ contentRight - width)
y      = anchor.flow_y
width  = node.width
height = node.height
```

Flush right within the anchor's flow position.

### Wrap effect

```
zone.left   = x - FLOAT_MARGIN
zone.right  = contentRight
zone.top    = y - FLOAT_MARGIN
zone.bottom = y + height + FLOAT_MARGIN
```

Lines overlapping the zone are constrained to:

```
line.startX = contentX
line.maxWidth = zone.left - contentX
```

Text uses the left side; image sits on the right.

### Inline-anchored split

Same shape as square-left: `text-before` (full width, above);
`image-block` (right side); `text-after` (left side, same Y as
image-block).

### Cross-paragraph wrap, Following content, Paint

Same as square-left, mirrored.

## Top-bottom (`wrappingMode: "top-bottom"`)

### Placement

The block occupies **full flow width (`contentWidth`), regardless
of visual width**. The image inside the block renders at its
intrinsic `node.width` (which may be narrower):

```
block.x      = contentX
block.y      = anchor.flow_y
block.width  = contentWidth          (the FLOW BLOCK reserves the full column)
block.height = node.height

image.x      = contentX + floatOffset.x   (paint position, clamped within content area)
image.y      = block.y + floatOffset.y
image.width  = node.width
image.height = node.height
```

Reserving full flow width is what guarantees following content
must start below — no other content competes for horizontal space
inside this block.

### Wrap effect

A **flow clearance** is emitted at `y + height + FLOAT_MARGIN`.
All following flow blocks must start at or below this Y. There
is no side wrap zone — text never sits beside a top-bottom object.

### Inline-anchored split (Rule 2)

```
[text-before]  fragment, above the image-block
[image-block]  at flow_y, takes full content width
[text-after]   fragment, starts at image-block.bottom + FLOAT_MARGIN
```

All three stack vertically. No side-by-side layout.

### Following content

The first flow block placed past the clearance Y. Margin collapse
applies normally between the clearance Y and the next block's
`spaceBefore`.

### Paint

Normal layer. `floatOffset.y` is a paint nudge; the flow clearance
is computed from the structural `y`, not the offset position.

## Behind (`wrappingMode: "behind"`)

### Placement

Same as `top-bottom` — the block reserves full flow width:

```
block.x      = contentX
block.y      = anchor.flow_y
block.width  = contentWidth
block.height = node.height

image.x      = contentX + floatOffset.x   (paint position)
image.y      = block.y + floatOffset.y
image.width  = node.width
image.height = node.height
```

The block participates in flow as a normal block of height
`node.height`. Following content goes below.

### Wrap effect

None. Text is **never** constrained by a behind anchored object,
even when the image's paint position overlaps a line (via
`floatOffset`). The image just paints behind whatever is there.

### Inline-anchored split (Rule 2)

Applies. A paragraph containing a behind-mode anchor splits into
`text-before / image-block / text-after`. The image-block takes
flow space; text-before and text-after stack vertically around
it like top-bottom.

### Following content

Stacks below the block, exactly as for top-bottom.

### Paint

Rendered **behind** the page's text content. Drawn before the
text painting pass. The visible difference from `top-bottom`
appears only when the user uses `floatOffset` to nudge the image
into overlap with adjacent text — at the overlap pixels, text
wins.

## Front (`wrappingMode: "front"`)

Identical placement, wrap, split, and following-content behavior
as `behind`. Differs only in paint:

- **Paint:** Rendered **above** the page's text content. Drawn
  after the text painting pass. At any pixel where the image
  overlaps text (via `floatOffset` nudges), the image wins.

## Stacking semantics

Multiple anchored objects with non-zero flow effect on the same
page may compete for the same vertical extent.

### Same-side square stack

Two `square-left` objects whose Y ranges overlap, both anchored
to the left side of the content area:

```
The second object is pushed down to start at the bottom of the
first (object1.y + object1.height + FLOAT_MARGIN).
```

The anchor of the displaced object follows it down (Rule 5 from
`00-model.md`): the anchor paragraph's flow position updates to
match the pushed object position so that following content does
not appear before the object.

### Opposite-side square (no overlap)

A `square-left` and a `square-right` at the same anchor Y do not
horizontally overlap, so they coexist at the same Y. Text wraps
in the column between them (or, if no room, falls below both).

### Top-bottom always clears prior anchored objects

A `top-bottom` object placed when one or more `square-*` objects
are still in their vertical extent is pushed below all of them
(its anchor follows). Once placed, its full-width footprint
ensures all subsequent content clears it. **This clearance
applies regardless of side; top-bottom establishes a new vertical
baseline.**

### Behind / front participate in flow stacking

Behind/front blocks take their flow slot like top-bottom; they
stack vertically with adjacent flow blocks under normal block
pagination. They do not impose **wrap** constraints, so they
neither push square-mode objects sideways nor get pushed sideways
by them. Two behind blocks anchored back-to-back stack vertically
in document order.

## Edge cases

### Object wider than the content area

`width > contentWidth`: the object is clamped to `contentWidth`
on placement (the block reserves full width). Visual rendering
crops to the content area; the doc model retains the unclamped
attribute for round-trip integrity.

### Object taller than the page content area

`height > contentHeight`: no anchor-push can help (the object
cannot fit on any page). Place at the anchor's resolved Y on the
anchor's page. The object renders past the page bottom and
visually overflows. This is a v1 limitation; image splitting
would address it (see `05-future.md`).

### Negative or extreme `floatOffset`

`floatOffset` is clamped to `[-contentWidth, +contentWidth]` on X
and `[-pageHeight, +pageHeight]` on Y at the input stage. This
prevents unbounded paint positions; it does **not** shift wrap
geometry, which always uses the structural position (Rule 4 from
`00-model.md`).

### Multiple anchored objects in one paragraph

A paragraph may contain more than one non-inline anchor span.
Each split point produces its own anchored-object block; the
paragraph normalizes into alternating `fragment` and
`anchored-object-block` entries. The split logic is recursive
across all non-inline anchors in the paragraph.

## Mode summary table

| Mode | Splits paragraph? | Flow contribution | Wrap zone | Paint layer |
|---|---|---|---|---|
| `inline` | no | inline | none | inline |
| `square-left` | yes | `image.height` at left | left side | normal |
| `square-right` | yes | `image.height` at right | right side | normal |
| `top-bottom` | yes | `image.height`, full flow width | none (block claims full width) | normal |
| `behind` | yes | `image.height`, full flow width | none | behind text |
| `front` | yes | `image.height`, full flow width | none | over text |

The model is uniform: every non-inline mode produces an
anchored-object block with flow contribution = `image.height`.
The differences between modes are entirely in **wrap effect** and
**paint effect**. There are no special-case flow rules.
