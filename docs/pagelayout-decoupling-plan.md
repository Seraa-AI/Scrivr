# PageLayout Decoupling Plan

> **Superseded.** Written against the CSS-float-era pipeline
> (`applyAnchorsAndFloatConstraints`, `wrappingMode` / `floatOffset` attrs).
> The codebase took a different direction: rect-driven exclusions through a
> shared per-page `ExclusionManager`, with paint geometry split from
> ownership via the `yOffset` attribute. The decoupling argument here is
> still useful as historical motivation; the specific stage names and APIs
> are not. Authoritative architecture is in
> [`docs/anchored-objects/`](./anchored-objects/).

> Trigger: this branch exposed that `PageLayout` is carrying too many layout,
> pagination, anchored-object, and rendering responsibilities. The MS-OE376
> Word implementation notes reinforce the same conclusion: a document renderer
> has to preserve layout intent through explicit stages, not collapse
> everything into a single page-building loop.

## Purpose

`PageLayout` should stop being the layout engine. It should become the
orchestrator that wires independent layout stages together and returns the
`DocumentLayout` shape consumed by the editor today.

This is not about implementing Word exactly. It is about making Scrivr's
layout pipeline capable of expressing the same categories of behavior users
expect from Word-class editors:

- styles resolved before measurement
- paragraph lines affected by anchored objects, justification, compatibility
  behavior, and page constraints
- tables using their own sizing and border-resolution rules
- anchors and wrapping treated as layout inputs, not paint-time decoration
- pagination producing fragments instead of forcing render code to rediscover
  layout decisions
- DOCX import/export preserving document intent rather than final canvas
  geometry

## The Design Rule (Load-Bearing)

**`PageLayout` may orchestrate. It may not own feature-specific layout
policy.**

This is the rule that drives the migration. It is enforceable per-PR. When
adding any feature, the question is "which stage owns this decision?" — and
if no stage owns it, the answer is to add the stage, not to slip the policy
into `PageLayout.ts`.

| Decision | Stage that owns it |
|----------|-------------------|
| Semantic meaning | document model / import-export mapping |
| Effective formatting | style/property resolution |
| Intrinsic size | measurement stage |
| Wrapping | anchor/constraint stage plus line breaker |
| Page assignment | pagination |
| Visible pixels | fragment builder and renderer |

If a feature needs more than one stage, represent the handoff explicitly in
the intermediate data. That is the core change this decoupling enforces.

## Why The Current Shape Is Weak

`PageLayout` currently sits at the boundary of too many concerns:

| Concern | Problem when coupled |
|---------|----------------------|
| Document walking | Tables, sections, footnotes, and headers all need hierarchy, but a flat pass encourages special cases. |
| Style resolution | Import/export and layout need the same effective properties, but those properties are implicit in layout code. |
| Text measurement | Re-running text layout for pagination, anchored objects, or paint creates drift and wasted work. |
| Anchored objects | They change available width, which changes line breaks, which changes height, which changes pagination. |
| Pagination | Page breaks, widows/orphans, sections, and footnotes need a dedicated stage with explicit constraints. |
| Rendering | Canvas should paint fragments; it should not make layout decisions. |

The pipeline can pass simple paragraphs but becomes brittle when a feature
changes more than one axis at once: anchored objects in paginated text,
tables near page breaks, imported Word documents, footnotes, or section
changes.

## Word / DOCX Insight

The local document `[MS-OE376]-220816.docx` does not define a single named
"Word render pipeline." Its value is that it documents many cases where
Word's actual layout behavior differs from the base ECMA-376 text. Treat it
as a bug catalog for individual algorithms (wider-side wrap, border conflict
resolution, justification width adjustment), not as an architecture target.

The lessons that matter for Scrivr are:

- **DOCX is semantic, not paint-first.** Word recomputes pagination and
  rendering from document structure, styles, compatibility flags, tables,
  anchors, fields, and drawings.
- **Layout behavior is staged.** Even when Word's internals are not
  described, the observable behavior requires style resolution, measurement,
  line breaking, anchor/wrap resolution, pagination, and final rendering to
  be separable.
- **Compatibility flags need a home.** Settings such as legacy line
  wrapping, justification, table rules, and anchored-object behavior affect
  layout. They cannot be represented if our only durable output is final
  canvas geometry.
- **Tables and anchored objects are sub-pipelines.** They need independent
  measurement and placement before the main paginator can make stable
  decisions.

For DOCX import, this means preserving layout intent before Scrivr lays it
out. For DOCX export, this means emitting Word-native structures and
letting Word lay them out. Canvas/PDF can consume final fragments; DOCX
should consume semantic document intent.

## Target Pipeline (North Star, Not Deliverable)

```text
ProseMirror document
  -> normalizeLayoutInput              [deferred until features need it]
  -> resolveStylesAndLayoutProps       [deferred until named styles ship]
  -> buildLayoutTree                   [deferred until tables/sections ship]
  -> buildBlockFlow                    [exists]
  -> resolveIntrinsicSizes             [partial — measurement is implicit today]
  -> applyAnchorsAndFloatConstraints   [exists as applyFloatLayout]
  -> breakLines                        [exists as LineBreaker]
  -> paginateFlow                      [exists]
  -> placePageContributors             [deferred — no headers/footers yet]
  -> buildFragments                    [exists]
  -> canvas/pdf renderer               [exists]
```

This intentionally overlaps with `docs/layout-pipeline-architecture.md` and
`docs/layout-engine-architecture.md`. This document is the migration plan
for moving toward that architecture without rewriting the editor in one
step.

The "deferred" rows are real architecture but premature work: the stage
only earns its keep when a feature needs it. Implementing a `LayoutNode`
tree before tables ship means designing for a use case that doesn't exist.

## Stage Contracts

Stage contracts only matter for stages that are about to land. The
contracts below are organized by phase order so each is defined where it
becomes relevant.

### Apply Anchors And Constraints (exists, needs hardening)

Input: measured flow, anchors, page config.

Output: flow plus anchored-object placements and exclusion constraints.

Responsibilities:

- resolve anchored object position in layout space
- produce exclusion regions for text wrapping
- identify which blocks require constrained reflow
- keep anchor placement separate from paint order

This stage may need fixed-point iteration. The contract is that the
iteration is local to constraints and flow geometry, not mixed into canvas
paint or DOCX serialization.

### Break Lines (exists, needs constraint provider)

Input: paragraphs plus width/constraint provider.

Output: `LayoutLine[]` per paragraph fragment.

The line breaker should accept constraints instead of reading page state
directly. This keeps it reusable for table cells, columns, footnotes, and
future side surfaces.

### Paginate Flow (exists, needs synthetic-block test path)

Input: measured/constrained flow.

Output: page assignments and break tokens.

Pagination should not measure text from scratch. It should consume measured
blocks and produce fragments or continuation tokens. The contract holds
when pagination can be tested with synthetic measured blocks (no real
document).

### Table Sub-Pipeline (new, highest leverage)

Input: layout tree containing table nodes.

Output: measured table fragments consumed by the main paginator.

Responsibilities:

- intrinsic min/preferred column widths
- column negotiation under fixed/auto layout modes
- cell block layout through the same line-breaking API used by paragraphs
- border conflict resolution at layout time, not paint time
- row splitting at page boundaries

This is where tables stop being "large paragraphs" and become a real
layout participant.

### Place Page Contributors (deferred until headers/footers ship)

Input: paginated body flow plus contributors.

Output: final page geometry.

This aligns with `docs/multi-surface-architecture.md`: the document is not
one surface forever. Stage contract lands when the first contributor (likely
header/footer) ships.

### Build Fragments (exists)

Input: final page geometry.

Output: paint-ready and hit-test-ready fragments.

Canvas and PDF consume this output. DOCX must not.

## Import / Export Boundary

The decoupled pipeline gives each export format the correct dependency:

| Format | Uses |
|--------|------|
| Canvas | final fragments |
| PDF | final fragments / display list |
| Markdown | semantic document tree |
| DOCX | semantic document tree plus styles, numbering, sections, tables, anchors, fields |

DOCX import should feed the semantic side:

```text
DOCX package
  -> parse XML parts
  -> resolve Word styles/numbering/relationships
  -> map to Scrivr document + layout properties + compatibility flags
  -> Scrivr layout pipeline
```

DOCX export should avoid final canvas geometry:

```text
Scrivr document + semantic layout properties
  -> styles.xml / numbering.xml / document.xml / rels / media
  -> Word recomputes layout
```

PDF stays "paint what Scrivr saw." DOCX stays "rebuild what the document
meant."

## Migration Plan

Migration is per-PR, not per-phase. The design rule above is the gate.

Each new feature or change asks: "which stage owns this decision?" If the
answer is "nothing owns it cleanly today," the work is to add the stage,
not to extend `PageLayout.ts`.

The phases below are leverage-ordered: do them when the corresponding pain
shows up. Skip phases that don't have a triggering feature yet.

### Phase A: Tables (highest leverage)

**Trigger:** tables ship as a real feature (already in roadmap).

- Add a table sub-pipeline module: intrinsic sizing, column negotiation,
  border conflict, row splitting.
- Cell blocks reuse the existing `LineBreaker` via the same constraint
  provider used by anchored-object reflow.
- Tables enter `paginateFlow` as measured blocks, not as nested paragraph
  walks.
- Table layout owns border resolution; renderer paints what it's told.

**Exit criterion:** a table feature lands without `PageLayout.ts` growing.

### Phase B: Pagination Test Surface

**Trigger:** pagination bug that requires reproducing a synthetic edge case
(widow/orphan, keep-with-next, page-break-inside) without a real document.

- Refactor `paginateFlow` to accept synthetic measured blocks.
- Move page-assignment policy out of free functions and into a tested
  module.
- Continuations become explicit data, not implicit fragment chains.

**Exit criterion:** pagination has unit tests that don't measure real text.

### Phase C: Compatibility Object

**Trigger:** the second compat-mode behavior shows up (we have one already
in the legacy `wrappingMode` / `floatOffset` pair).

- Add `LayoutCompatibility` to the normalized input.
- Migrate the legacy wrap/offset behavior behind it.
- Defer DOCX-specific flags (`lineWrapLikeWord6`, `shapeLayoutLikeWW8`)
  until DOCX import lands.

**Exit criterion:** compat-mode behavior is a property on the layout input,
not a free-function branch.

### Phase D: Page Contributors

**Trigger:** headers/footers/footnotes start.

- Move body flow and page chrome to separate surfaces.
- Add iterative settlement when contributor height changes body capacity.
- Keep synthetic/continuation pages explicit.

**Exit criterion:** body pagination and page-contributor placement are
separate stages.

### Phase E: Layout Tree (deferred until needed)

**Trigger:** named styles, sections, or full DOCX import.

- Add `LayoutNode[]` between document and `buildBlockFlow`.
- Move style/property resolution into a dedicated stage with stable hashes.
- Treat the layout tree as the surface DOCX import/export shares with the
  layout pipeline.

**Exit criterion:** DOCX semantic round-trip works without going through
fragments.

## Non-Goals

- Do not implement full Word compatibility in this refactor.
- Do not run a "Phase 0: Extract Without Behavior Change" PR. Type
  extraction is part of each phase that needs it; never a phase by itself.
  A pure-extraction PR produces diff noise nobody can review for
  correctness.
- Do not make DOCX export depend on canvas coordinates.
- Do not rewrite every layout feature at once.
- Do not change public rendering output until each stage has tests.
- Do not push table, footnote, or anchored-object special cases deeper into
  `PageLayout.ts`.
- Do not build the `LayoutNode` tree before tables or named styles need it.

## Testing Strategy

Add tests at stage boundaries, not only at final canvas output:

- style resolution produces stable effective properties (when stage exists)
- paragraph line breaking is deterministic for a fixed constraint provider
- block flow is page-independent
- anchor constraints reflow only affected blocks
- pagination splits synthetic blocks without measuring text
- tables resolve intrinsic width before pagination
- DOCX-oriented fixtures preserve semantics even when final pagination
  differs

Golden visual tests still matter, but they should sit on top of smaller
tests that explain which stage failed.
