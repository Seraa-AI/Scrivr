# Paragraph Borders & Shading RFC

> Status: **design / RFC** — not started (2026-07-27). Proposes Word-class
> paragraph borders (`w:pBdr`) and paragraph shading (`w:shd`) for Scrivr:
> a semantic attribute on paragraph-like nodes, resolved into border groups
> and page fragments at layout time, painted as pure geometry on canvas and
> PDF, round-tripped through DOCX. Grounded to the current engine; the
> external behaviour reference is
> [ooxml.dev — Paragraph Borders](https://ooxml.dev/docs/paragraph-borders/)
> and Word's *Borders and Shading* dialog (Apply to: **Text / Paragraph**).

## Direction

A paragraph border is formatting attached to the **paragraph**, not an
independent line, shape, or text box. Word paints it around the paragraph's
*block bounds*, can combine consecutive same-bordered paragraphs into one
continuous box, keeps side borders running through the inter-paragraph gap and
across page breaks, and stores it in `pPr/w:pBdr` (`top`/`bottom`/`left`/
`right`/`between`/`bar`) with widths in eighths of a point and text spacing in
whole points.

Scrivr is uniquely positioned to get the hard cases right *if* we resist the
trap of treating a paragraph border as four CSS-like lines glued to each
paragraph. That naive model works for one paragraph and breaks on grouping,
inter-paragraph spacing, page fragmentation, lists, tables, and DOCX fidelity.
The `CodeBlock` strategy (`packages/core/src/extensions/built-in/CodeBlock.ts:42`)
is exactly that naive model — a per-block `fillRect`+`strokeRect` — and it
already demonstrates two of the bugs we must avoid (§7).

### The core invariant

> The paragraph node stores **semantic** border formatting. Layout resolves
> **border groups** and **page fragments** and produces exact geometry.
> Rendering (canvas + PDF) paints **only resolved geometry** — it makes no
> document-model decisions.

```
paragraph.attrs.borders / .shading   (semantic, in the PM doc)
        ↓ resolveParagraphStyle()      (defaults → style → direct)
        ↓ resolveBorderGroups()        (Stage 1.5, over FlowBlock siblings)
        ↓ paginateFlow()               (per-page fragments; existing engine)
        ↓ ParagraphBorderPass          (fragment-visible sides → paint commands)
        ↓ canvas / pdf-lib             (stroke/fill only)
```

## Non-goals (v1 / Phase 1)

- **Border grouping** (`between`, continuous side borders across paragraphs).
  Deferred to Phase 2 — but the data model reserves it from day one so we don't
  lose grouping information on round-trip (§1), and Phase 1 preserves it through
  DOCX without rendering it (§10).
- **`bar` border** (vertical line outside the paragraph). Phase 3.
- **Double / dotted / dashed / shadow** styles. Phase 1 is `single` only; the
  paint layer is a style registry so the rest slot in (§9).
- **Independent right indent** (`w:ind w:right`). The geometry model has **no
  right indent** today (§5); v1 draws borders *outward* from the text box, so it
  doesn't need one — a distinct right indent is its own Phase 3 change.
- **List-container borders** and **table-container borders** — those are a
  different node's formatting (§11); v1 is the paragraph's own box only.

## Standards baseline — OOXML

```xml
<w:pPr>
  <w:pBdr>
    <w:top    w:val="single" w:sz="6" w:space="4" w:color="FF0000"/>
    <w:bottom w:val="single" w:sz="6" w:space="4" w:color="FF0000"/>
    <w:left   w:val="single" w:sz="6" w:space="4" w:color="FF0000"/>
    <w:right  w:val="single" w:sz="6" w:space="4" w:color="FF0000"/>
    <w:between w:val="single" w:sz="6" w:space="1" w:color="auto"/>
  </w:pBdr>
  <w:shd w:val="clear" w:color="auto" w:fill="FFF2CC"/>
</w:pPr>
```

- `w:sz` — border width in **eighths of a point** (`6` = 0.75pt).
- `w:space` — text-to-border spacing in **whole points**.
- `w:between` — presence is meaningful **even when `w:val="none"`**: it marks
  that adjacent matching paragraphs *group* (draw the box around the run) but
  paint no internal separator. Normalising that to `undefined` loses grouping.
- `w:between/@w:space` — **ignored** per ISO/IEC 29500. The between border sits
  at the paragraph bottom by line pitch + spacing; its `space` does not offset
  it. We preserve the value for round-trip and drop it from layout (§1).

Scrivr already speaks this dialect in three places we will mirror rather than
reinvent:

| Precedent | File:line | What it gives us |
|---|---|---|
| `w:pBdr` on an empty paragraph = horizontal rule | `packages/core/src/extensions/built-in/HorizontalRule.ts:104` | the exact `xml("w:pBdr", …, [xml("w:bottom", {…})])` emit shape |
| Table `w:tblBorders` per-edge elements | `packages/core/src/table/docxExport.ts:38` | `w:top`/`w:left`/`w:bottom`/`w:right` edge shape, `w:sz` eighths, `BORDER_COLOR` |
| Cell `w:shd` fill + import parse | `docxExport.ts:103`, `packages/docx/src/import/parser.ts:333` | the `w:shd` element + its round-trip parse |

## Where this lives in the engine

Scrivr has no `model/schema.ts`; the schema is assembled from extensions, and a
block node's `attrs` are the single source — one extension **cannot** inject
attrs into another extension's node spec. So the feature splits into:

1. **Attrs on the owning nodes** — `borders` / `shading` added to the `attrs`,
   `parseDOM`, and `toDOM` of `Paragraph.ts` **and** `Heading.ts` (both carry
   the identical block-attr shape today: `align`, `indent`, `textIndent`,
   `fontFamily`, `nodeId`, `dataTracked`).
2. **A cross-cutting `ParagraphBorders` extension** (modelled on
   `Alignment.ts` / `Indent.ts`) that owns commands, keymaps, the border-group
   layout pass, and the border paint pass.
3. **Export handlers** on the block extensions' `addExports`/`addImports`
   (DOCX), plus a new `pdf.nodes.paragraph` contribution.

This mirrors how `Alignment` and `Indent` are cross-cutting behaviours over
attrs that physically live on `Paragraph`/`Heading`.

---

## 1. Document model

Stored on the paragraph/heading node. Units are **CSS pixels** to match the
layout engine (see §6 — the layout package has no `pointsToPx`; it works
entirely in px). OOXML eighths-of-point / whole-point conversion happens **only
at the DOCX import/export boundary**, using the existing `twipsToPx`/`emuToPx`
neighbours in `packages/core/src/exports/docx.ts:343`.

```ts
type BorderLineStyle =
  | "none" | "single" | "double" | "dotted" | "dashed"
  | "dashSmallGap" | "dotDash" | "dotDotDash";

type ParagraphBorderSide = {
  style: BorderLineStyle;
  width: number;    // px  (import: w:sz eighths → pt → px)
  color: string;    // resolved CSS color (see resolveTheme.ts safety note)
  space: number;    // px, inner-edge → content (import: w:space pt → px)
  shadow?: boolean;
  /**
   * OOXML has both `none` and `nil` for "no border" — they render alike but
   * carry different override/inheritance intent. Preserve the source token so
   * an untouched side round-trips byte-faithfully; layout treats both as absent.
   */
  sourceStyle?: "none" | "nil";
};

type ParagraphBorders = {
  top?: ParagraphBorderSide;
  right?: ParagraphBorderSide;
  bottom?: ParagraphBorderSide;
  left?: ParagraphBorderSide;
  /**
   * The *presence* of `between` is itself the grouping signal — no separate
   * boolean. `style: "none"` means "group, but draw no internal separator."
   * Its `space` is round-tripped but IGNORED by layout (see standards note).
   * Absent = no grouping. Inherited-absence vs. explicit-removal is a
   * style-resolution concern (§4 cascade), not a field here.
   */
  between?: ParagraphBorderSide;
  bar?: ParagraphBorderSide;   // Phase 3
};

// Node attr shape (both nodes):  borders: ParagraphBorders | null
//                                shading: { fill: string } | null
```

**`between.space` is layout-ignored.** ISO/IEC 29500 specifies that a between
border's `space` is **ignored** — Word positions the between border at the
paragraph bottom, driven by line pitch and paragraph spacing, not by `space`. We
keep the raw imported value on the side (for byte-faithful export) but never feed
it into geometry. This is the one side where `space` does not mean inner-edge→text.

**Why px, not pt, in the model:** every layout coordinate in Scrivr is CSS px
(`defaultPageConfig` is `794×1123` px, margins `72`px). Storing pt would force
a conversion at every geometry site. We convert once, at the DOCX seam, exactly
as `align`/`indent` already do nothing special and spacing lives in px on
`BlockStyle`. If byte-exact OOXML round-trip of odd `w:sz` values becomes a
requirement, we keep the original eighths on an optional `_ooxml` sidecar field
rather than polluting the geometry model — deferred, flagged in Open Questions.

**No `as` casts** (project rule): `readParagraphBordersFromDOM` /
`normalizeBorders` are runtime guards returning typed values, and `NodeAttributes`
is augmented so consumers read `node.attrs.borders` typed — mirroring the
`Paragraph.ts:224` / `Heading.ts:302` augmentation blocks.

---

## 2. Schema (ProseMirror)

Added to the existing `attrs` object in `Paragraph.ts:107` and `Heading.ts:63`
(cannot be injected from the borders extension — §"Where this lives"):

```ts
attrs: {
  // …existing: align, indent, textIndent, fontFamily, nodeId, dataTracked…
  borders: { default: null },
  shading: { default: null },
},
```

`toDOM` (`Paragraph.ts:137`) serialises them as `data-*` JSON for
clipboard/HTML/a11y only — the canvas renderer reads `node.attrs.borders`
directly, never the DOM. `parseDOM` (`Paragraph.ts:115`) reads them back for
paste. This matches how `align`/`indent`/`textIndent` are already round-tripped
through the `style` attribute for clipboard fidelity.

**Enter-split inheritance.** `splitBlockInheritAttrs` (`Paragraph.ts:76`, bound
to `Enter`) copies `fontFamily`/`align`/`indent`/`textIndent` onto the new
paragraph. `borders`/`shading` are **added to that copy list** so pressing Enter
inside a bordered paragraph yields two same-bordered paragraphs — which, once §8
grouping ships, render as one continuous box; without grouping (Phase 1) they
render as two adjacent boxes.

"Matches Word" here is an **assumption to fixture-test**, not a settled fact:
Word may copy paragraph properties verbatim, apply the style's *next-paragraph
style*, or adjust grouping from the resulting effective properties. Verify
against Word across: Enter at start / middle / end of a bordered paragraph;
direct-formatted vs. style-inherited borders; a paragraph with `between`; a
bordered list item; a heading with a bottom border. Encode the verified matrix as
tests before claiming parity.

---

## 3. Commands & toolbar

A `setParagraphBorders` command follows the canonical cross-selection pattern
from `Alignment.ts:24` / `Indent.ts:22` — `nodesBetween` + `node.isTextblock` +
`"borders" in node.attrs` + `setNodeMarkup`:

```ts
function setParagraphBorders(borders: ParagraphBorders | null): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection;
    let tr = state.tr, changed = false;
    state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
      if (!node.isTextblock || !("borders" in node.attrs)) return;
      tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, borders });
      changed = true;
    });
    if (!changed) return false;
    dispatch?.(tr);
    return true;
  };
}
```

Toolbar presets (`none`/`top`/`bottom`/`left`/`right`/`all`/`outside`/`inside`)
merge **one side at a time** — never replace the whole `borders` object when
toggling a single edge (`mergeBorderSide`, collapsing to `null` when empty).
`inside` sets a `between` border (its mere presence enables grouping) and adds
no outer sides; `outside` across a multi-paragraph selection gives every
paragraph a shared grouping definition (Phase 2) so the run round-trips to DOCX
as one box. Mixed-selection state uses a `ToolbarValue<T> = value | mixed | unset`
tri-state (`getCommonBottomBorder` deep-equals across selected nodes).

Commands are registered on the new `ParagraphBorders` extension via
`addCommands()`/`addKeymap()`; `Commands`/`NodeAttributes` are augmented there
(the `augmentation.ts` pattern).

**Track-changes interaction.** `borders`/`shading` are node-attr changes;
paragraph nodes already carry `dataTracked`. Node-attr tracking is out of scope
for v1 (see `todo_nodeid_for_node_level_track_changes`), so a border change is a
plain attr edit for now — noted so we don't silently assume it's tracked.

---

## 4. Style resolution

Do not let layout or the renderer read raw attrs. Resolve once, defaults →
paragraph style → direct formatting, so border behaviour is identical whether it
came from a style or direct formatting:

```ts
type ResolvedParagraphStyle = {
  borders: ParagraphBorders | null;
  shading: { fill: string } | null;
  indentLeft: number;      // px, from `indent * LIST_INDENT`
  spaceBefore: number;     // px, from BlockStyle
  spaceAfter: number;      // px, from BlockStyle
  // (no independent right indent today — §6)
};
```

Scrivr's current split is: `indent`/`textIndent` are node attrs resolved in
layout; `spaceBefore`/`spaceAfter` come from `BlockStyle`
(`FontConfig.ts` `getBlockStyle`, compound key e.g. `heading_1`). v1 reads
`borders`/`shading` straight off attrs (no style-level border inheritance);
Phase 3 adds style-level borders through the same `BlockStyle` resolution so
`DocxStyleSpec` can carry them.

**Cascade, not a `grouping` flag.** The distinction between "no `between`
inherited" and "`between` explicitly removed" belongs here, in resolution — not
as a field on the border object (§1). When style-level borders land (Phase 3),
model it as a cascaded value, e.g.
`CascadedValue<T> = { kind: "inherit" } | { kind: "unset" } | { kind: "value"; value: T }`,
resolving to the flat `ParagraphBorders` the rest of the pipeline consumes. v1
has no style layer, so every side is either present or absent — the cascade type
is introduced with Phase 3.

---

## 5. Layout geometry — block bounds, not longest line

The border spans the paragraph's **block bounds**, which the engine already
computes at `PageLayout.ts:1407`:

```ts
const blockX     = margins.left + flow.indentLeft;   // left outer edge
const blockWidth = flow.availableWidth;              // right = blockX + width
```

So `borderLeft = block.x`, `borderRight = block.x + block.width`. Never derive
the right edge from the longest line — that is the classic paragraph-border bug.
`block.{x,y,width,height}` on `LayoutBlock` (`BlockLayout.ts:112`) are the
geometry we draw against; **`height` is lines-only and excludes
`spaceBefore`/`spaceAfter`** (`BlockLayout.ts:124`).

**Border box vs. text box — do not reflow text in v1.** Keep two rects
explicit and resolve them independently:

```ts
type ParagraphBorderGeometry = { textBox: Rect; borderBox: Rect };
```

The text box is the existing block bounds (`blockX`, `availableWidth`,
line-broken as today). The border box is derived **outward** from the text box
by `space` + half the stroke:

```
borderLeft  = textBox.x      - left.space  - left.width / 2
borderRight = textBox.right   + right.space + right.width / 2
```

This is the key correction from the review. The naive model — "reduce
`availableWidth` by `left.space + right.space` before line-breaking" — is
**unverified against Word and probably wrong**: Word draws left/right borders
*outside* the text/indent boundary and does **not** narrow the line box for
border space. Changing `availableWidth` would silently alter line wrapping,
pagination, and every downstream fragment, so v1 does **not** touch it. The
border simply extends toward the margin; overflow past the page/container edge is
clamped in the border pass, not by reflowing text.

> **Open investigation (blocks any width change):** generate Word DOCX fixtures
> for left/right border `space` at varying indents and near the page edge, and
> confirm whether Word (a) extends the border outward (assumed), (b) consumes
> paragraph width, or (c) varies by available space. Do not alter line-breaking
> until a fixture proves it. Until then, borders are horizontally **paint-only**.

**Geometry precision — one resolved edge type, both axes.** Model every side as:

```ts
type ResolvedBorderEdge = {
  outer: number;        // border box outer edge
  strokeCenter: number; // where ctx strokes (outer ∓ width/2)
  inner: number;        // outer ∓ width
  contentEdge: number;  // inner ∓ space  (text starts here)
};
```

Use this for **top/bottom as well as left/right** so the stroke-center
convention is consistent and nothing double-counts half a stroke (see §6). The
canvas context is pre-scaled by `dpr` (`canvas.ts:66`), so coordinates are CSS
px; a crisp hairline needs device-pixel alignment of `strokeCenter`
(`alignStrokeToDevicePixel(coord, widthPx, dpr)` / the `Math.round(x)+0.5` and
`snapRect` idioms in `OverlayRenderer.ts:398`).

**Known gap — right indent.** There is still **no independent right indent** in
the geometry model (`w:ind w:right`); the text right edge is always
`pageWidth - margins.right`. Because v1 draws the border *outward* rather than
insetting text, this doesn't block right borders — but a true right indent is a
separate feature (Open Question).

---

## 6. Vertical layout & the flow

Unlike the horizontal axis (borders extend *outward*, §5), the top/bottom border
+space is **additive vertical padding that reserves real flow height** — a
bordered paragraph is taller than its lines. Total footprint:

```
spaceBefore  (BlockStyle, collapsed)
  top.width + top.space
    line content  (block.height)
  bottom.space + bottom.width
spaceAfter   (BlockStyle, collapsed)
```

`spaceBefore`/`spaceAfter` are **outside** `block.height` and **margin-collapsed**
with neighbours via `collapseMargins = Math.max(...)` (`PageLayout.ts:2181`,
applied at `:1398`). The top/bottom border+space are **not** collapsed — they are
inside the box. So the flow grows each bordered block's occupied height by
`top.width + top.space + bottom.space + bottom.width`, added at the seam that
consumes `block.height` (`y = targetY + block.height`, `PageLayout.ts:1479`).
This reserves real space rather than painting into the margin gap the way
`CodeBlock` cheats (`CODE_PAD` into the collapsed margin, reserving nothing).

**Avoid double-counting the stroke.** Reserve height and paint from the **same**
`ResolvedBorderEdge` (§5): the box's outer top is `spaceBefore` below the
previous content; `contentEdge = outer + width + space` is where lines start;
the stroke paints at `strokeCenter = outer + width/2`. Do not add `width + space`
to reserve height in one place and then center the stroke on a different edge
elsewhere — that reserves (or paints) half a stroke twice. The height a border
adds and the coordinate it strokes at must both come from the resolved edge.

Because spacing collapsing is `Math.max`, grouped-paragraph gap-bridging (§8)
must reason about the *collapsed* gap between members, not the sum of margins.

---

## 7. Pagination — fragment-visible borders

A paragraph can split across pages. There is **no `splitBlockAtBoundary`
function** (the name in `CLAUDE.md:102` is aspirational) — the split is an
inline branch in `paginateFlow` (`PageLayout.ts:1520`). It produces N sibling
`LayoutBlock`s that share `sourceNodePos` and carry:

- `isContinuation: true` on parts 2..N (`PageLayout.ts:1608`)
- `continuesOnNextPage: true` on parts 1..N-1 (`:1609`)
- `fragmentIndex` + `sourceNodePos` (`:1611`); `spaceBefore` suppressed on
  continuations, `spaceAfter` kept only on the tail (`:1603-1604`)

These flags are precisely the fragment-visibility signal borders need:

```
drawTop    = !block.isContinuation        // top only on the first fragment
drawBottom = !block.continuesOnNextPage   // bottom only on the last fragment
drawLeft = drawRight = true               // sides on every fragment
```

giving a continuous logical box down the page and across the break. This is the
identical ownership model tables already use — `isLastRow` "drives table bottom-
border ownership" (`PageLayout.ts:274`). The forthcoming
`fragmentIndex`/`fragmentCount` formalisation
([layout-fragment-architecture.md](./layout-fragment-architecture.md)) makes
`isFirst = fragmentIndex === 0` / `isLast = fragmentIndex === fragmentCount-1`
unambiguous for the same logic; borders should consume whichever is canonical
when they land (the flags today, the indices after Phase 2 of that doc).

**Why the naive `CodeBlock` approach is wrong here:** its strategy `strokeRect`s
the full block box per `LayoutBlock`. A code block split across a page would get
a *full four-sided box on each page* (bottom of page 1 + top of page 2 spurious).
Paragraph borders must be fragment-aware, which is why they cannot be a plain
per-block `strokeRect`.

---

## 8. Border groups (Phase 2)

Grouping is a **layout-time pass over sibling FlowBlocks, before pagination** —
group on the document-model paragraphs, then split into fragments, so a page
break never terminates a group:

```
resolveParagraphStyles → resolveBorderGroups (Stage 1.5) → paginateFlow (fragments) → paint
```

Consecutive paragraphs group when their grouping signature matches. Grouping is
gated on `between` **presence** (no boolean — §1), and the signature is a stable
stringify of the **complete resolved border object** — `{top, right, bottom,
left, between, bar, shadow}` — not just the four sides. ISO/IEC 29500 compares
*all* paragraph border information for adjacency, so unsupported-but-preserved
properties (`bar`, `shadow`, and any theme-resolved colour detail imported from
DOCX before Scrivr renders them) must still influence grouping, or an imported
run would regroup differently than Word intended. A `null` signature (no
`between`) = standalone.

```ts
function borderGroupingSignature(b: ResolvedParagraphBorders): string | null {
  if (b.between === undefined) return null;   // presence is the signal
  return stableStringify({
    top: b.top, right: b.right, bottom: b.bottom, left: b.left,
    between: b.between, bar: b.bar,            // include unsupported-but-preserved
  });
}
```

Each member gets a role:

| Role | top | bottom | left | right |
|---|---|---|---|---|
| `standalone` | ✓ | ✓ | ✓ | ✓ |
| `first` | ✓ | ✗ | ✓ | ✓ |
| `middle` | ✗ | ✗ | ✓ | ✓ |
| `last` | ✗ | ✓ | ✓ | ✓ |

The `between` separator is drawn after each non-last member (skip when
`between.style` is `none`/`nil` — grouping without a visible rule), positioned at
the member's bottom by spacing (its `space` is ignored — §1). The group's side
edges bridge the collapsed inter-paragraph gap (§6) so left/right run unbroken
between members. Group identity uses stable paragraph `nodeId`s, not array
offsets.

**Resolve grouping globally; paint fragments locally.** The semantic group is a
document-global object; its *geometry* must be sliced into page-/tile-local
paint fragments, because a group can span multiple pages, multiple tiles, and
partially-dirty or off-screen tile ranges under the tile renderer:

```ts
type BorderGroup = { id: string; members: NodeId[] };

type BorderGroupFragment = {
  groupId: string;
  page: number;
  rect: Rect;                    // page-/tile-local
  drawTop; drawBottom; drawLeft; drawRight: boolean;  // role ∧ fragment visibility
  separators: BorderPaintCommand[];
};
```

`drawTop = isFirstFragment && roleAllowsTop`, `drawBottom = isLastFragment &&
roleAllowsBottom`. Painting at the group-*fragment* level (not one global box) is
what keeps the group correct across page breaks and answers the tile-renderer
concern in Open Question 3.

---

## 9. Rendering — content paint, fragment-aware, group-hoisted

The renderer is **fully imperative** — there is no retained paint-command /
display-list abstraction; each block strategy calls `ctx.fillRect`/`ctx.stroke`
directly in one top-down pass over `page.blocks` (`PageRenderer.ts:129`). The
direct precedent for what we need is **`TableRowStrategy.paintRowGrid`**
(`renderer/TableRowStrategy.ts:26`): it fills cell backgrounds, then strokes
**per-edge** lines (`beginPath`/`moveTo`/`lineTo` — not a full `strokeRect`, so
each side is independent), then paints child text — and it already carries
per-edge **ownership** logic (cell owns left/top, row owns right, last row owns
bottom, `:45`) which is exactly the grouped/fragment border-ownership model.

Two-tier plan, matching the two-tier problem:

- **Phase 1 (standalone).** A fragment-aware paragraph `BlockStrategy` that
  wraps `TextBlockStrategy` — the way `ListItemStrategy` wraps it
  (`ListItemStrategy.ts:30`) — registered via `addLayoutHandlers`. It draws
  shading fill → delegates text → strokes the **fragment-visible** sides (§7),
  mirroring `paintRowGrid`'s fill→stroke→text order. Per-block is sufficient
  here because a standalone paragraph's fragments are self-contained.
- **Phase 2 (grouping).** Grouped paragraphs are **separate `LayoutBlock`s**, so
  a per-block strategy cannot span them. Grouping hoists side-drawing to a pass
  over the resolved `BorderGroupFragment`s (§8), keyed by `nodeId`, run after the
  block loop on the same content canvas. The per-block strategy then only draws
  role-permitted sides.

**One resolver, two backends.** The step that decides *what* to draw — group
role, fragment-visible sides, `ResolvedBorderEdge` offsets, shading rects,
stroke style — is **backend-neutral** and runs once, producing a list of
paint commands. Canvas and PDF then differ only in the primitive draw. This is
the RFC's core invariant made literal, and it stops canvas and PDF from
independently (and divergently) re-deriving grouping/fragment geometry:

```ts
type ParagraphPaintCommand =
  | { kind: "shading"; rect: Rect; fill: string }
  | { kind: "horizontal"; x1; x2; y; border: ParagraphBorderSide }
  | { kind: "vertical";   x; y1; y2; border: ParagraphBorderSide };

resolveParagraphPaint(fragment): ParagraphPaintCommand[]   // shared
paintCanvas(cmd, ctx)                                       // ctx.stroke / fillRect
paintPdf(cmd, pdfCtx)                                       // drawLine / drawRectangle
```

Scope note: this shared list covers **borders + shading only** — it does not
absorb text rendering, which already has two mature, separate paths
(`TextBlockStrategy` on canvas, `ctx.draw.lines` on PDF). `resolveParagraphPaint`
composes with those; it does not replace them.

The canvas backend reuses the `save → setLineDash([...]) → stroke →
setLineDash([]) → restore` idiom from `TableRowStrategy`/`OverlayRenderer.ts:270`
with the crisp-1px `Math.round(x)+0.5` convention (`OverlayRenderer.ts:506`) /
device-grid `snapRect` (`OverlayRenderer.ts:398`) so hairlines don't blur.

**Shading geometry (define before the pre-pass).** `shading: { fill }` needs an
explicit rect, and Word does not make it obvious. v1 fills the **border box**
(the outer border rect, so the fill sits under the stroke and spans the full
block width including line gaps and empty space), and shading **continues across
page-split fragments** (each fragment fills its own slice) and **bridges the
inter-paragraph gap within a group** (one continuous region). Confirm the
remaining choices against Word fixtures before implementing:

- Does left/right border `space` widen the shaded rect (border box) or stop at
  text (content box)?
- Does the fill extend *under* the border stroke or up to its inner edge?
- Continuation fragments and grouped-gap bridging: fill the gap, or only line
  boxes?
- Indent vs. line extents for the shaded width.

**Theme tokens.** `ResolvedTheme` (`model/theme.ts:79`) has no border/shading
tokens today (`TableRowStrategy` hardcodes `#9ca3af`). Add
`paragraphBorder`/`paragraphShading` defaults there; `BlockRenderContext`
(`BlockRegistry.ts:81`) already threads `theme` to every strategy, so the pass
reads tokens without capturing the editor. Explicit `borders[side].color` /
`shading.fill` always win over the token default.

**Paint order** (shading must sit under text; borders over text but on the
**content** canvas, not the overlay):

```
1. page background        (PageRenderer.ts:176 analogue)
2. paragraph shading      (fillRect, before text)
3. text selection
4. text + inline content  (existing block strategies)
5. paragraph borders      (stroke pass)
6. cursor / selection overlay  (OverlayRenderer — separate canvas, above all)
```

**Not the overlay handler.** `addOverlayRenderHandler`
(`extensions/types.ts:54`) draws on a *separate overlay canvas after* cursor and
selection — wrong layer for borders/shading, which belong in the content paint
between shading-under-text and cursor-over-text. Implementation: extend
`PageRenderer` with a shading pre-pass and a border post-pass driven by the
resolved geometry the `ParagraphBorders` extension produces, rather than routing
through `addLayoutHandlers` (which would re-introduce the per-block limitation).

**Double / dotted / dashed** are a `Record<BorderLineStyle, BorderPainter>`
registry; Phase 1 registers `single` (and `none`); the rest slot in (double =
two thirds-width strokes offset ±⅓; canvas has no native double).

---

## 10. Export & import

Everything is extension-owned — no changes to the `@scrivr/docx` or
`@scrivr/export-pdf` pipeline code beyond one new PDF node contribution.

**Phase 1 preserves what it can't render.** DOCX import stores `between`, `bar`,
`shadow`, and non-`single` styles onto the node even though Phase 1 renders
none of them; export re-emits them from the stored attrs. So Phase 1 is a
**lossless-where-feasible** round-trip that *renders* only standalone single-line
sides + shading — it does not silently drop grouping data. (This is why the model
reserves those fields from day one and why the grouping signature hashes them,
§8.) Genuinely unrepresentable OOXML is dropped and noted, not silently eaten.

### DOCX export — `Paragraph.ts:175` / `Heading.ts:175` `addExports`

Today the handler emits only `w:jc`. Extend the `pPr` `lead` to append
`w:pBdr` (mirror `HorizontalRule.ts:104` and the per-edge shape of
`table/docxExport.ts:38`) and `w:shd` (mirror `docxExport.ts:103`), converting
px→pt→eighths for `w:sz` and px→pt for `w:space` at this boundary. `w:between`
re-emits its preserved `space` verbatim even though layout ignored it (§1).
Follow the `List.ts:28` pattern for *appending into an existing* `w:pPr` rather
than rebuilding it.

### DOCX import — `parser.ts:351` `parseParagraphProperties` + `Paragraph.ts:189`

Add `w:pBdr` / `w:shd` reads to `parseParagraphProperties` (mirror the cell
`w:shd` parse at `parser.ts:333`), storing onto a new `border?`/`shading?` field
on `DocxParagraphAttrs` (`packages/core/src/exports/docx.ts:435`), then copy
them onto the PM node in the paragraph block-transform.

**Collision to guard — HR misdetection.** `isHorizontalRuleParagraph`
(`parser.ts:203`) treats an **effectively-empty** paragraph carrying a
`w:pBdr/w:bottom` as a horizontal rule. Tightening the heuristic (empty **and**
bottom-only, no other sides/between/shading) reduces false positives but does
**not** eliminate them — a user can legitimately make an empty paragraph with
only a bottom border, which is genuinely ambiguous. So the heuristic is not the
primary mechanism:

- **Scrivr-authored HRs carry a marker.** The HR exporter (`HorizontalRule.ts`)
  emits an ignorable, round-trippable marker (e.g. a `w:bookmark`/custom
  attribute the importer recognises). Import promotes to `<hr>` on the **marker**,
  losslessly — a bordered empty paragraph is never mistaken for one.
- **Third-party DOCX** (no marker) still uses the tightened heuristic, but that
  path is **explicitly lossy** and documented as such: some empty bottom-bordered
  paragraphs from other tools will become HRs. This is the one accepted
  ambiguity, and it only affects marker-less foreign files.

### PDF — new `pdf.nodes.paragraph` handler consuming the shared resolver

Paragraphs currently have **no** PDF node handler (text is drawn generically),
and `CodeBlock` has no PDF handler at all — so code-block backgrounds already
don't render in PDF today. Add a `pdf.nodes.paragraph` contribution
(`export-pdf` handler shape `PdfNodeHandler = (block, ctx) => void`,
`augmentation.ts:20`) that (a) runs the **shared** `resolveParagraphPaint` (§9)
and draws the resulting shading/border commands via `paintPdf`
(`ctx.page.drawRectangle`/`drawLine`, px→pt via `PT_PER_PX`, Y-flip), then (b)
delegates text with `ctx.draw.lines(block, ctx)`. Because this handler becomes
the sole paragraph path, it owns text drawing — no double-draw against the
generic path.

**Group sides in PDF.** A paragraph-local handler cannot paint a group's shared
side borders that span multiple paragraph blocks — same limitation as canvas
(§9). So grouped side/shading commands come from the group-fragment resolver, not
the per-node handler; the PDF pipeline draws them in a group pass mirroring the
`stroke`+`flipY`+edge-ownership model in `packages/core/src/table/pdfExport.ts`.
Canvas and PDF share the resolver, so group roles and fragment sides are computed
once, not twice.

### Markdown

No affordance — borders/shading are silently dropped (`Paragraph.ts:212`),
which is correct.

---

## 11. Lists & tables

- **Lists:** the border belongs to the `paragraph` inside the `listItem`, drawn
  from the paragraph's resolved indentation geometry (`indentLeft` already
  includes list indent, `PageLayout.ts:2068`) — *after* the marker, not around
  the whole `listItem`. Keep `paragraph.attrs.borders` distinct from a future
  `listItem.attrs.containerBorders`.
- **Tables:** a paragraph border inside a cell is still a paragraph border,
  drawn against the cell's content width (each cell is laid out by
  `layoutBlock` per cell, `BlockLayout.ts:409`). It composes with — does not
  replace — the cell's own `w:tcBorders`.

Both reduce to "the paragraph's block bounds within whatever container it sits
in," which the fragment/geometry model already provides.

---

## 12. Hit-testing

Borders are **not** selectable objects. Hit-testing returns the owning
paragraph (`{ kind: "paragraph-border"; nodeId; side }`) only to drive the
toolbar / context menu / (optional) space-dragging / debug overlay. No
`NodeSelection` is created around a border line. This stays clear of the
selection-system rework (`docs/selection-rfc.md`).

---

## 13. Phasing

**Phase 0 — Word fixture study (gate).** Before any layout change, generate
Word DOCX fixtures and lock the behavioural unknowns: horizontal border-space
(outward vs. width-consuming, §5), shading rect (border box vs. content box,
§9), Enter-split inheritance matrix (§2). Small, but it de-risks everything
downstream — the one decision that ripples into wrapping, pagination, and every
fragment is §5, and it must be measured, not assumed.

**Phase 1 — standalone borders + shading.**
`top`/`bottom`/`left`/`right`, `single` style, width/color/per-side space,
paragraph shading, fragment-visible sides across page splits. No grouping, no
line-wrapping change (borders extend outward, §5). Touches: attrs on
`Paragraph`+`Heading`; `ParagraphBorders` extension (command/keymap); the shared
`resolveParagraphPaint` resolver + canvas/PDF backends; vertical-footprint growth
in the flow; DOCX + PDF round-trip (preserving unsupported fields); HR marker +
tightened heuristic.

**Phase 2 — grouping.**
`between` (incl. `style:"none"`/`"nil"` grouping-only), border-group resolution
pass, `BorderGroupFragment` painting bridging the collapsed inter-paragraph gap,
mixed toolbar tri-state, `outside`/`inside` presets, DOCX `w:between` render
fidelity, Enter-split producing a live group.

**Phase 3 — fidelity.**
Dashed/dotted/double/`dashSmallGap`/`dotDash`/`dotDotDash`, `bar` border,
`shadow`, style-level borders via `BlockStyle`/`DocxStyleSpec`, true right
indent (`w:ind w:right`), list/table-container borders.

---

## 14. Open questions

1. **Horizontal border-space behaviour (blocks §5, highest risk).** Fixtures
   must confirm whether Word extends left/right borders *outward* from the text
   box (RFC assumption → borders stay horizontally paint-only), consumes
   paragraph width, or varies by indent/available space. No line-wrapping change
   until proven. This is the single decision that ripples into wrapping,
   pagination, and every fragment calculation.
2. **Right indent.** `w:ind w:right` doesn't exist in the geometry model. v1
   doesn't need it (borders draw outward), but symmetric right *indent* parity
   with Word is a separate Phase 3 change — pull forward if a consumer needs it.
3. **Byte-exact OOXML round-trip.** Store px in the model and accept lossy
   eighths↔px, or keep an `_ooxml` sidecar of original `w:sz`/`w:space` (plus the
   `sourceStyle` none/nil already reserved, §1)? Lean px-only unless a consumer
   needs exact re-serialisation.
4. **Group pass vs. tile renderer.** Confirm the `BorderGroupFragment` pass
   composes with the tile renderer's per-fragment draw
   (`TileManager.fragmentsInTile`) — group geometry is resolved globally but must
   paint per page/tile (§8).
5. **Style-level borders timing.** Defer to Phase 3, or pull forward if a real
   DOCX corpus leans on style-defined paragraph borders?
6. **`bar` semantics.** Left-margin bar is common in legal redlines; is there a
   concrete consumer to justify Phase 3 priority, or drop it?
```
