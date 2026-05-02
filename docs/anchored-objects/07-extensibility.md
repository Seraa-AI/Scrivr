# 07 — Extensibility: How the anchored-object architecture composes with tables, columns, and other block containers

After the yOffset redesign and the structural cleanup that followed (see [`06-yoffset-redesign.md`](./06-yoffset-redesign.md) and the live record in `project_anchor_yoffset_redesign.md`), the anchored-object layer settled on a small geometry-driven surface:

```
docPos        = ownership / move-with-text anchor
attrs         = placement (x, yOffset, width, height, wrapMode, margin)
LayoutPage.anchoredObjects[]  = geometry source of truth
ExclusionManager              = page-level rect store (one per page)
LineBreaker                   = consumes available segments
PointerController             = edits attrs; docPos relocation only on float→inline or cross-page
```

This note exists because **tables and columns are the next big block-level features**, and we wanted to capture — while the architectural decisions are fresh — what reuses, what extends, and what changes.

The short version: tables and columns get a shorter implementation thanks to this work. There is exactly one architectural extension point.

## The right primitive

The win from this work is that the layout engine now asks one question:

> **What inline segments are available here?**

That single question maps cleanly onto every block-level feature we plan to ship:

| Feature | What "available segments" means |
|---|---|
| **Columns** | Segments are inside the current column's content bounds |
| **Table cells** | Segments are inside the current cell's content bounds |
| **Floats / anchored objects** | Subtract exclusion rects from the segments the container provides |
| **Headers / footers** | Segments are inside the chrome region's content bounds |

`LineBreaker` doesn't care which container produced the segments. It composes. The container's job is to call the right `LineSpaceProvider` for its content; the line breaker's job is to fit text into whatever segments come back.

That decoupling is the foundation for tables and columns.

## What the anchored-object work gives tables and columns for free

### `LineSpaceProvider` is the constraint API both need

A multi-column layout passes a column-aware `LineSpaceProvider` that returns segments constrained to the current column's bounds. A table cell layout passes a cell-aware provider per cell. The "block layout consumes available segments at line Y" pattern was built generic enough to absorb both.

```ts
// Hypothetical column-aware provider:
const columnSpaceProvider: LineSpaceProvider = (lineY, lineHeight) => {
  const col = activeColumn(lineY);
  return {
    segments: [{ x: col.contentX, width: col.contentWidth }],
  };
};
```

LineBreaker doesn't care whether the segment came from an `ExclusionManager`, a column boundary, or a table cell. It composes.

### `ExclusionManager` is reusable per region

`ExclusionManager` is currently scoped per page (`Map<pageNumber, ExclusionManager>` in `resolveAnchoredObjects`). Generalizing to per-region (per-column, per-cell) is mechanical when needed: the keying changes, the API doesn't.

`addFullWidthRect({ contentX, contentWidth, ... })` already takes content bounds, so a `side: "full"` rect inside a column spans column width — not page width. Top-bottom-in-column works without code change.

### `paragraph = ownership only` is the right mental model

Table cells are containers that own their cell position; their content doesn't drive the cell's geometry. Same shift we made for paragraphs and anchored images:

| Surface | Owns | Geometry source |
|---|---|---|
| Paragraph + anchored image | Image's docPos = which paragraph it moves with | `LayoutPage.anchoredObjects[]` |
| Table + cell content | Cell's row/col coordinate = where content lives | Table layout grid |
| Multi-column block + paragraphs | Paragraph order = column flow order | Column layout |

Each container layer answers "what owns what" via document structure; geometry is computed separately by the layer that owns the spatial logic.

### `LayoutPage.anchoredObjects[]` generalizes past pages

`placement.globalY` is in continuous-Y, so an image anchored to a paragraph inside a table cell or column still resolves cleanly: cell layout decides the cell's globalY range, anchored object resolves against that. The placement struct doesn't know — and shouldn't know — that it's nested.

### Drag patterns translate 1:1

Same-page vs cross-page drag commit logic in `PointerController` translates directly to:
- **Cross-column drag** — anchor relocates to the new column; `samePage` becomes `sameRegion`. Logic identical.
- **Within-cell drag** — same-region attr commit (yOffset, x).
- **Cell-to-cell drag** — cross-region commit, anchor relocates.

The "snapshot or die" rule applies the same way: capture `{anchorDocPos, anchorRegion, anchorGlobalY}` at pointerdown.

## The one architectural extension point

`getAnchoredObjectAnchors(flow)` in `PageLayout.ts` currently scans **top-level flows only**. When the doc is paragraph → paragraph → paragraph, the scan is complete. When a table or multi-column container holds nested paragraphs, an image inside a table cell or column won't be found by the top-level scan.

This needs one of two shapes when those phases ship:

**Option A — Recursive scan.** `getAnchoredObjectAnchors` walks into table-cell flows and column flows.

**Option B — Container-emits-anchors.** Table layout and column layout each emit their anchored objects into the same `LayoutPage.anchoredObjects[]` they inherit. `resolveAnchoredObjects` stays flat.

We lean **Option B**. The integration shape:

```
table layout owns cell layout
cell layout finds cell-local anchored objects
cell emits anchored-object placements upward
page renderer still reads LayoutPage.anchoredObjects[]
line breaker still reads available segments
```

Reasons:

1. `resolveAnchoredObjects` stays flat — no recursion, no special-casing for nested containers.
2. Nested anchors land in the same shared `ExclusionManager` per page (or per region) automatically. Cross-container wrap (a table cell's image excluding text in a sibling column) just works.
3. Each container layer becomes responsible for its own anchored-object discipline, which keeps the layer's invariants local.

No redesign. Just a new container integration point.

## Tradeoffs to watch when each phase ships

### The hard rule evolves: page → region

Today the clamp invariant is:

> **Image must fit its page / content area.**

With columns, tables, headers, and footers, that becomes:

> **Image must fit its containing region.**

Where "region" can mean:

- page body
- column
- table cell
- header
- footer

The clamp itself doesn't change shape — it's still "stay inside the anchor's bounds." Only the bounds query changes: instead of `barriers.pageStartGlobal(pageNumber) + contentHeight`, it becomes `region.bounds`. Layout-side change is small (the page-bounds computation in `resolveAnchoredObjects` reads from the region's bounds instead of the page's). UX implication: dragging an image to a different region (column, cell, etc.) counts as cross-region — anchor relocates atomically, same as cross-page today.

The shape this suggests:

```ts
interface LayoutRegion {
  id: string;
  bounds: Rect;            // content bounds in continuous-Y space
  exclusions: ExclusionManager;
  parent?: LayoutRegion;   // table cell → table row → page body, etc.
}
```

`resolveAnchoredObjects` becomes region-keyed instead of page-keyed; everything else (placement, clamp, drag, paint) reads `region.bounds` and `region.exclusions` without caring whether the region is a page, a column, or a cell.

### Exclusion is region-local, not global

Every region owns its own `ExclusionManager`. **Default: exclusions are strictly local to their region.** A square image inside a table cell excludes text in that cell only — never sibling cells, never text outside the table. A `side: "full"` rect inside a column skips the line breaker past it within that column only.

This is the right default because the alternative — global / shared exclusions — produces immediate bugs:

> An image in a table cell shouldn't push text in the page body around the table.

The opt-in nuance: a parent region may want to see specific child exclusions. The clearest example is a header — a page's header is itself a region, but a header-anchored object that "bleeds" into the page body (e.g., a corner badge that overlaps the top margin) is a real Word/Docs feature. The shape:

- Region holds its own `exclusions`.
- Optionally, region declares which child exclusions propagate up (`exposesExclusionsTo: "parent"` on the rect, or a `propagate: boolean` flag).
- Parent region's `getAvailableSegments` includes propagated child rects in its query.

For v1 of regions: **strict-local only**. Propagation is a feature, not a default — ship it when the first concrete consumer needs it (header chrome bleed, page-margin notes), with the same discipline the yOffset spec used for `positionMode: "fixed-on-page"`.

### Anchor-only paragraph collapse propagates into nested containers (tables)

Phase 3 / structural cleanup: a paragraph whose only content is non-inline image sentinels collapses to `block.height = 0`, `spaceBefore/spaceAfter = 0`. The same rule applies inside table cells — a cell whose only paragraph is anchor-only should also collapse to zero.

`isHiddenAnchorLine(line)` already cross-cuts the layout/paint/hit-test layers; cell layout just needs to honor the same predicate when computing cell height.

### Top-bottom in nested containers (Phase 5 V2 prerequisite)

Top-bottom currently keeps the `partKind: "anchored-object"` FlowBlock split for V1 (we suppress `yOffset` writes for top-bottom in PointerController + ImageMenu to compensate). Phase 5 V2 rips out the split.

When Phase 5 V2 lands AND tables ship, top-bottom inside a table cell should behave the same as top-bottom inside a column or page: contribute a `side: "full"` rect to the cell's `ExclusionManager`. Spans the cell's content width, not the page's. Already covered by `addFullWidthRect(contentX, contentWidth)`.

### Float anchored to a non-paragraph element

Word/Docs allow images anchored to a table or to the page itself, not just to a paragraph. Today `docPos` points into a paragraph. Anchoring to a table or page would need a `positionMode` extension — not architectural surgery, just a new branch in the placement resolver.

The yOffset spec's `positionMode: "fixed-on-page"` future is the precedent. `positionMode: "fixed-on-table"` or `positionMode: "fixed-on-region"` follow the same pattern.

## What this means for sequencing

When tables and columns are scheduled, the anchored-object integration is **~10% additional surface area**, not a redesign:

1. Generalize the `Map<pageNumber, ExclusionManager>` key to `Map<regionId, ExclusionManager>` in `resolveAnchoredObjects`. Mechanical.
2. Implement Option B: container-emits-anchors. Tables and columns surface their nested anchored objects to `LayoutPage.anchoredObjects[]`.
3. Widen the clamp invariant to `image.region === anchor.region`.
4. Honor `isHiddenAnchorLine` in cell-height computation.
5. Cross-region drag commits (no new architecture; just extend the page-detection in `PointerController`).

Each item lives in a known location with a known shape. None require revisiting the geometry-driven model.

## Forward-looking summary

The architectural payoff of this work is three clean separations:

1. **Ownership separated from geometry.** docPos answers "what does this image move with?" attrs answer "where does it paint?" Neither answers the other's question.
2. **Geometry separated from exclusion.** `LayoutPage.anchoredObjects[]` is "where things are." `ExclusionManager` is "what regions text must avoid." Same data, different consumer; the placement struct doesn't know about wrapping, the manager doesn't know about paint coords.
3. **Exclusion separated from line breaking.** `LineBreaker` consumes available segments; it doesn't know whether a segment came from an exclusion subtraction, a column boundary, or a table cell.

Each separation is what unlocks a future feature without a redesign:

- Tables and columns reuse the line-breaking layer because exclusion is decoupled from it.
- Anchored-objects-in-cells reuse the exclusion layer because geometry is decoupled from line breaking.
- Drag UX reuses ownership-vs-geometry because docPos and attrs do different jobs.

Tables, columns, headers/footers, multi-page sections, and any future block-level container reuse these primitives without modification. The single architectural extension point — surfacing anchored objects from nested containers — is well-defined and bounded.

This composability is intentional: the structural cleanup commit (`5dc37c6`) was specifically about reducing paragraph's role to ownership only so that *other* block-level containers could ship later without a similar architectural retrofit. The current work is not throwaway — it's the cleaner base everything after this builds on.
