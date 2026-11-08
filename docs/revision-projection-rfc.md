# RFC: Revision Projection — laying out a revision-bearing document

Status: proposed. Companion to [structural diff](./structural-diff-rfc.md),
which produces the same revision records from two versions rather than from
live editing, and to [columns](./columns-rfc.md), whose `ContentRegion` work
the table half of this depends on.

## Problem

Track changes records a change by rewriting the document so both answers live
in it at once: deleted text keeps its glyphs under a `trackedDelete` mark, an
inserted paragraph carries `dataTracked` attrs. Layout is told nothing — there
is no reference to `dataTracked` anywhere under `layout/` or `renderer/` — and
the review overlay paints by asking `CharacterMap` for the glyphs and lines in
a change's range.

That works because of an assumption nobody wrote down:

> A pending change costs exactly the space its own content occupies.

For inline text it holds, and is what you want: struck text keeps its glyphs,
so a reviewer sees what would go. Everywhere else it is false.

An anchored image is the sharpest case. Its inline anchor span is zero-size
(`Image.ts`, "Zero-size anchor spans for floating images"), and `CharacterMap`
has no notion of anchored objects. So a tracked deletion of a floating image
paints **nothing at all** — the reviewer sees an ordinary image — while the
exclusion it contributes still pushes text around, because the exclusion is
computed from a document that does not know the image is proposed for removal.

| Revision | Where its cost actually lands |
| --- | --- |
| Deleted word | Its own glyphs. Visible. |
| Deleted anchored image | An exclusion rectangle elsewhere in the flow. Invisible, still applied. |
| Inserted anchored image | Already reflowing text around content that may be rejected. |
| Resized anchored image | Dozens of unrelated lines. No insertion, no deletion. |
| Deleted table row | A row height shared with siblings; borders and structure unmarked. |
| Inserted table column | Every *other* column's width. A change with no extent of its own. |
| Section two columns → one | The whole region topology. Every node still present. |

The last three rows are why this cannot be fixed by painting harder, and why a
presence predicate (`isPresent(pos)`) is not enough either: in a resize, a
font-size change, or a column-count change, presence is `true` under every
projection and the geometry still differs.

The violated invariant is not about space. It is:

> The revision representation and the geometry representation are assumed to
> share a topology.

For text they nearly do — revision range ≈ glyph range ≈ layout extent — which
is why glyph-keyed painting has worked by accident. A float breaks the chain at
the first link: the record lives at a zero-width anchor, and its consequence
lives in exclusions against lines that carry no record at all.

## Direction

One revision-bearing document, several **projections** of it. A projection is
not a copy and not an edit: it answers "given this lens, what document should
downstream systems observe?"

```
          ProseMirror doc (revision-bearing, canonical)
                          │
                          ▼
                 Revision Projection
                    │           │
                    ▼           ▼
            projected doc   RevisionMap
                    │           │
                    ▼           │
                 Layout         │
                    │           │
                    └─────┬─────┘
                          ▼
                       Renderer
```

The invariant this buys:

> **Layout does not know why a projected document has the shape it has. It lays
> out the shape it was given.**

Two names, kept apart on purpose:

- **Revision Projection** — the mechanism. Lives in track changes. Produces a
  document and a map.
- **Review Lens** — the product concept a host selects. Never reaches layout.

## The projection's output is a ProseMirror document

The obvious alternative is a `LayoutSource` interface that layout consumes
instead of a `Node`. Measured against this codebase, that is the more expensive
option and buys nothing extra.

Layout itself touches a small PM surface — `type`, `attrs`, `nodeSize`,
`textContent`, `forEach`, `childCount`, `isTextblock`. But `BlockStrategy` and
`InlineStrategy` hand a real `Node` to **every extension that draws anything**:

```ts
measure?(node: Node, font: string, measurer: TextMeasurerLike): { width: number; height: number };
render(ctx, x, y, width, height, node: Node, theme: ResolvedTheme): void;
```

A parallel node type does not stop at `layout/`. It propagates into every
extension's strategy, each of which must be rewritten against something that is
not a node.

Projecting to a PM document instead:

```ts
const projected = projectRevisions(state, { content: "accepted" });
layout(projected.doc);          // signature unchanged
```

- `layout/` and every strategy are untouched.
- **Attribute revisions need no special case anywhere.** The projected image
  node simply *has* `width: 400`; the projected section simply *has* one
  column; the projected table simply *has* grid `[160, 110, 170]`. This is the
  test of whether the abstraction is right, and it passes by construction.
- PM's structural sharing keeps a projection that rewrites a few nodes cheap.
  `findChanges` already walks the whole document on every tracked transaction,
  so a projection walk is the established order of cost.

The boundary is identical to the interface version — layout receives a
document and cannot ask why — at a fraction of the churn.

## Positions move

A projected document has different positions than the canonical one. This is
the hazard that makes `RevisionMap` more than a geometry index, and it is the
same class of defect that has already cost this repo twice (the replay bridge's
frame errors). Naming it up front:

- `CharacterMap` is built over **projected** positions.
- A click resolves to a projected position; a transaction must be written at a
  **canonical** one.
- Therefore the map carries a bijection, not just an annotation.

```ts
interface RevisionMap {
  /** Canonical position for a position in the projected document. */
  toCanonical(pos: number): number;
  /** Projected position for a canonical one, or null if the lens hides it. */
  toProjected(pos: number): number | null;
  /** Geometry carrying each revision, by kind. */
  geometry(): readonly RevisionGeometry[];
}
```

`toProjected` returning `null` is the honest answer for content a lens removed,
and is what lets a caller decide between "scroll to it" and "it isn't here."

## Content projection × annotation policy

Word's four modes are not four cases. They are two orthogonal choices:

```ts
interface RevisionProjectionOptions {
  content: "markup" | "accepted" | "rejected";
  annotations: "all" | "summary" | "none";
}
```

| Review lens | content | annotations |
| --- | --- | --- |
| All Markup | `markup` | `all` |
| Simple Markup | `accepted` | `summary` |
| No Markup | `accepted` | `none` |
| Original | `rejected` | `none` |

The decomposition also predicts useful combinations Word does not ship —
`{ content: "rejected", annotations: "all" }` is "show me everything I would
lose" — and it keeps the annotation decision out of layout entirely, since
annotations are a renderer concern.

### Markup geometry is legitimately synthetic

`content: "markup"` produces a geometry that equals neither outcome, and that
is correct rather than a defect. The inline analogue is already uncontroversial:

```
The quick fast brown fox
    ---- ++++
```

That sentence never existed in any version and is still the most useful thing
to show. The same licence extends to space: under `markup`, a pending-inserted
float is placed and **does** emit its exclusion, so a reviewer can see what is
proposed, where it would sit, and how it would wrap. A pending-deleted float
keeps its geometry too, marked as deleted.

Rejecting either then reflows the page. That reflow is the consequence of the
decision, not a bug.

The failure mode to avoid is not synthetic geometry. It is *presenting
synthetic geometry as the resulting document* — which is the argument for
making the other lenses reachable, not for abolishing this one.

## Revision geometry by kind

The overlay's question changes from "which characters belong to this change?"
to "what geometry represents this revision?" Each kind has its own source, and
the source already exists in every case:

```ts
interface RevisionGeometry {
  revisionId: string;
  kind: "text" | "block" | "anchored-object" | "table-row" | "table-column" | "structure";
  rects: Rect[];
}
```

| Kind | Geometry source |
| --- | --- |
| `text`, `block` | `CharacterMap` glyphs and lines (today's path) |
| `anchored-object` | `LayoutPage.anchoredObjects[]` — `AnchoredObjectPlacement` already carries `docPos` plus a page-local rect |
| `table-row` | Table layout fragment row rects |
| `table-column` | Table layout column bands |
| `structure` | Region rects (section, column) |

The anchored-object row is independently broken today and should ship on its
own, ahead of this RFC, as a renderer hole rather than as the fix for tracked
spatial changes.

## Tables

A column revision is not a set of cells to hide. It changes the grid, and the
sizing algorithm redistributes the remainder. So the revision system owns the
operation and the projection resolves it:

```ts
type TableRevision =
  | { op: "insert-column"; index: number }
  | { op: "delete-column"; index: number }
  | { op: "resize-column"; index: number; width: number }
  | { op: "insert-row"; index: number }
  | { op: "delete-row"; index: number }
  | { op: "merge-cells"; range: CellRange }
  | { op: "split-cell"; at: CellRef };

projectTable(table: Node, lens: RevisionProjectionOptions): Node;
```

Table layout then never learns a tracked column existed; it receives a table
whose grid, cells and spans are already effective for the lens.

This is also why the table half should land with, not before, the
`ContentRegion` work in the columns RFC — both want one answer to "what space
does this region offer?"

## Editability per lens

A projection that is not `markup` shows a document the user cannot
straightforwardly edit, because every keystroke must be rewritten through
`toCanonical` and some positions have no canonical home. Word permits editing
in No Markup and it is a documented source of "where did my change go."
CKEditor's equivalent preview is read-only.

Decision: **`markup` is editable; other lenses are read-only in v1.** This is
also what `viewSnapshots` was reaching for — it exists today and does nothing
but return `editable: false` from a ProseMirror prop, a view mode with no
layout meaning. It becomes the lens mechanism it should have been.

Editing under a non-markup lens is deferred, not refused: the bijection is the
thing that would make it possible later.

## Non-goals (this RFC)

- Changing the default lens. The architecture should support all four; the
  product decision to move from All Markup to Simple Markup is a separate
  change, so that an architectural correction and a visible UX migration do not
  land entangled.
- Editing under a non-markup lens.
- The mark-lane bridge defect (mark trackers writing against positions the
  replay bridge never mapped). Pre-existing, recorded as a failing test.
- Collaborative projection: two users on different lenses is a rendering
  question per client, not a document question, but it is unexamined here.

## Decisions

1. **Projection output is a PM document, not an interface.** Keeps layout and
   every extension strategy untouched, and makes attribute revisions fall out
   without a special case.
2. **`RevisionMap` carries a position bijection**, not only geometry. Without
   it a non-markup lens cannot be clicked, let alone edited.
3. **Lenses decompose into content × annotation.** Four Word modes are derived,
   not enumerated.
4. **Markup geometry may be synthetic**, including emitting exclusions for
   proposed floats.
5. **Table revisions are structural operations**, resolved by `projectTable`.
6. **Non-markup lenses are read-only in v1**, via the `viewSnapshots` seam.
7. **The default lens does not change** in this work.

## Phased implementation

### Phase 0 — anchored-object overlay (ship independently)
Paint tracked state for anchored objects from `AnchoredObjectPlacement` rects
instead of glyphs. Closes a renderer hole that exists regardless of this RFC.

### Phase 1 — projection substrate
`projectRevisions(state, options)` returning `{ doc, map }`, with `content`
support for `accepted` and `rejected` over insert/delete records only. Wire
`viewSnapshots` to select a lens. Read-only.

### Phase 2 — attribute revisions
Projected attrs for images, text formatting, and node attributes. This is the
phase that proves the abstraction: a float resize must change exclusions with
no layout change at all.

### Phase 3 — revision geometry
`RevisionGeometry` by kind; overlay asks the map rather than the CharacterMap.
Annotation policy (`all` / `summary` / `none`), which makes Simple Markup
renderable.

### Phase 4 — table projection
`TableRevision` plus `projectTable`. Lands with the `ContentRegion` work.

### Phase 5 — hover preview
Per-revision lens override — project everything at the current lens except one
revision, and relayout — so hovering Reject on a float shows the actual
resulting geometry. Owning the layout engine makes this better than Word's
equivalent.

## Verification

The matrix below is the point of the RFC; a case that needs a branch in
`layout/` means the abstraction is still wrong.

| Case | What must hold |
| --- | --- |
| Delete a word | Unchanged from today under every lens |
| Delete an anchored image | `accepted`: no exclusion, text reflows. `markup`: geometry kept, marked |
| Insert an anchored image | `markup`: placed, excludes, marked. `rejected`: absent, no exclusion |
| **Resize/move an anchored image** | Old attrs → old rect → old exclusions; proposed attrs → new rect → new exclusions. **No layout change.** |
| Change a paragraph's font size | Pagination differs between lenses; no layout change |
| Section two columns → one | Region topology differs between lenses; no layout change |
| Delete a table row | Row absent under `accepted`; row height reclaimed |
| Delete a table column | Grid redistributed by the sizing algorithm, not merely hidden |
| Click in `accepted` lens | Resolves through `toCanonical` to the right canonical position |
| Page count | May differ per lens; each is internally consistent |

The float resize/move row is the acid test. It has no insertion and no
deletion, so it cannot be expressed by presence, and its consequence reaches
lines that carry no record.

## Open questions

1. **Projection cost at scale.** A 1000-page document reprojected on every
   tracked transaction. Structural sharing should make this proportional to the
   changed subtree, but it is unmeasured, and `findChanges` is already a full
   walk per transaction.
2. **Invalidation granularity.** A projection changes when the lens changes or
   when a revision changes. The second should invalidate only the affected
   subtree's layout — which needs the typed layout invalidation that is already
   a standing TODO.
3. **Selection across a lens change.** Switching lens mid-selection: map
   through the bijection, or collapse?
4. **Moves.** A move is one revision with geometry in two places. `rects[]`
   permits it; whether the overlay should connect them is undecided.
5. **Export.** PDF and DOCX presumably export the `accepted` projection, which
   would replace whatever they do today with tracked content.

## Dependencies

- `ContentRegion` from the columns RFC, for Phase 4.
- Typed layout invalidation, for open question 2.
- No dependency on the structural-diff RFC, but that work becomes a second
  producer for the same projection: comparing two versions is a projection
  whose `rejected` side is another document.

## What shipped

Nothing yet.
