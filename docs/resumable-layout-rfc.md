# Resumable Block Layout RFC

> Status: proposed design, not implemented. Grounded in the current paragraph,
> table, anchored-object, and streaming code. This document specifies the
> producer/region boundary needed by the [columns RFC](./columns-rfc.md) and
> deferred row splitting in the [table plan](./tables.md). It does not claim
> those features have shipped or replace their product scope decisions.

> **A region supplies geometry; a block consumes source content; a fragment
> records what was consumed. Pagination only decides which region the block
> receives next.**

> **Continuation always refers to unconsumed source state, never previously
> produced visual layout.**

## 1. Ownership and commit

Only the block layout engine may decide where source content becomes lines.
Pagination can validate a proposed fragment, accept it, or offer another region.
It cannot reconstruct source from a fragment's lines and re-break that content.

```text
Document snapshot → Prepared block
                          ↓
           layoutNext(continuation, region)
                          ↓
                  Tentative fragment
                          ↓
              Owner validates placement
                          ↓
     Commit fragment + continuation + region cursor together
```

| Owner | Responsibility |
|---|---|
| Region cursor | Page/column progression, current Y, page and section transitions |
| Geometry coordinator | Page metrics, anchor placement, immutable exclusions, replay |
| Paragraph producer | Inline consumption, line construction, legal paragraph fragments |
| Table producer | Cell regions, row split policy, collective row-fragment acceptance |
| Fragment output adapter | Source mapping, first/last identity, existing layout output |
| Canvas / PDF | Paint accepted geometry |

Continuation is a value describing a content producer, not a mutable object
owned by pagination. "Tentative" and "committed" describe the acceptance of
that value; they are not separate kinds of paragraph cursor.

A candidate line can be accepted inside a paragraph attempt without publishing
anything. A paragraph attempt inside a cell is still tentative. Cells are
accepted collectively by the row; a row result remains tentative until its
parent accepts it. A rejected parent attempt discards all child results.

The top-level commit publishes the fragment, its successor continuation, region
cursor, and dependency records atomically. It must first verify that the
document/preparation and geometry used by the attempt are still current.
CharacterMap updates, visible page lists, and placement mutations do not occur
inside a speculative producer. Memoization is allowed only when it cannot
change observable results or mutate returned values.

## 2. Proposed contract

These are contract sketches, not declarations of existing public APIs.

```ts
type FragmentResult<State, Fragment> =
  | { readonly kind: "complete"; readonly fragment: Fragment }
  | {
      readonly kind: "partial";
      readonly fragment: Fragment;
      readonly continuation: State;
    }
  | {
      readonly kind: "no-fit";
      readonly reason: "capacity" | "unbreakable";
    };

interface ResumableLayout<Prepared, State, Fragment> {
  layoutNext(
    prepared: Prepared,
    continuation: State | undefined,
    region: LayoutRegion,
  ): FragmentResult<State, Fragment>;
}
```

`undefined` input means start the producer; `complete` retires it. `no-fit`
returns no continuation: the owner retains the input unchanged. It does not
mean the block cannot fit anywhere, only that no legal fragment fits this offer.

Each fragment records its source consumption, local geometry, successor Y or
total occupied extent, and geometry/preparation dependencies. Occupied extent
includes movement past exclusions, not just the sum of painted line heights.
Visual bounds and flow advance are distinct.

Required invariants:

- Same prepared input, continuation, region, and geometry produce equivalent
  results. Ambient mutable font or page-number state is not an input.
- A partial result strictly advances the producer's semantic state. Advancing a
  pending terminal line counts; repeatedly returning the same cursor does not.
- A no-fit result consumes nothing and changes no published state.
- Source consumption across committed fragments is ordered, with no omissions
  or duplication. Visual decoration may repeat without consuming source.
- A continuation is valid only for its prepared content identity. It must not
  be reused after an edit changes that content, even if offsets still fit.
- A fully consumed zero-ink block can complete with an empty visual fragment
  that still records its logical consumption and source mapping.

Progress also needs an explicit overflow policy. Repeatedly offering equivalent
empty regions to an unbreakable oversized line or row cannot make progress.
The coordinator must select a documented allow-overflow/clip/error outcome,
express it in the next offer, and retain that outcome on the result. It must
not silently drop content, force-consume a cursor, or create pages forever.
No-fit on a partially occupied region alone does not prove an item is oversized;
the next page may have a different header/footer capacity.

## 3. Regions and coordinate ownership

```ts
interface LayoutRegion {
  readonly id: RegionId;
  readonly originX: number;
  readonly originY: number;
  readonly width: number;
  readonly cursorY: number;
  readonly bottomY: number;
  readonly geometry: GeometrySnapshot;
  readonly lineSpace: LineSpaceProvider;
}
```

All producer positions and segment X values are region-local. `originX` and
`originY` specify the transform into the parent coordinate space; the top-level
region maps into page-local coordinates. `cursorY` and `bottomY` are local,
finite in paged regions, with an explicit unbounded case for pageless layout.

The region factory derives `lineSpace` from that exact immutable geometry
snapshot and transform. Callers cannot pair a new generation with a closure
over an old mutable ExclusionManager. A snapshot needs runtime immutability,
not merely TypeScript `readonly` annotations.

Pages, columns, cells, and header/footer content boxes can supply regions.
Their progression rules differ: paragraphs cannot advance the physical page
while inside a cell. They report to the cell, which reports to its row.

Inter-block margin collapsing belongs to the containing flow. The paragraph
reports before/after spacing intent; the container applies page-start
suppression and adjacent-margin rules once. First-line indentation, list-marker
emission, and hard-break semantics remain paragraph responsibilities. Spacing
must not become an endlessly resumable content item by itself.

## 4. Paragraph continuation and line construction

Prepare an immutable stream of typed inline items with source mappings:
text runs, breaks, inline atoms, and other supported inline content. Use the
existing font resolver and measurement services, captured for the preparation
generation. Do not infer new tab/field capabilities from this representation.

```ts
type InlineCursor =
  | { readonly kind: "text"; readonly itemIndex: number; readonly offsetInItem: number }
  | { readonly kind: "item"; readonly itemIndex: number }
  | { readonly kind: "end" };

type ParagraphPhase =
  | "before-first-line"
  | "content"
  | "trailing-empty-line"
  | "after-content";

interface ParagraphContinuation {
  readonly cursor: InlineCursor;
  readonly paragraphPhase: ParagraphPhase;
}
```

Offsets are prepared-local UTF-16 offsets with legal grapheme boundaries for
mid-word splits. Atoms and hard breaks are indivisible items. Constructors and
transition functions enforce valid cursor/phase combinations; a discriminated
phase-specific union can further restrict the implementation.

The source map converts local consumption into ProseMirror positions when
emitting accepted layout. Absolute document positions are not the content
cursor. First-line markers/indentation are emitted only in the first-line
phase. A trailing hard break preserves the pending terminal empty line.
`after-content` finalizes paragraph metadata; it cannot return the same state
as a partial result indefinitely.

Line construction:

1. Save the line-start source cursor.
2. Estimate the line's vertical extent and obtain available segments.
3. Build a candidate line from that saved cursor.
4. Query exclusions again over its actual extent, including inline objects.
5. If the geometry differs, rebuild from the saved cursor inside line layout.
6. Validate the completed line against region capacity and split policy.
7. Accept it inside the tentative paragraph result, or return the prior accepted
   lines and their continuation. No prior lines means no-fit.

If no segments exist, use the exclusion's skip position to search lower in the
same region. Count that clearance in occupied extent. If the skip crosses the
region bottom, return no-fit without consuming source.

Height/segment settling must have a deterministic termination rule. Prefer
conservative exclusion checks over the accumulated candidate vertical extent;
detect repeated configurations and enforce a bounded attempt budget. Failure
to find a valid line is an explicit internal layout failure, not capacity
no-fit: changing pages is not a legitimate cure for a non-converging algorithm.
Never publish a line intersecting an exclusion while reporting successful fit.

Pagination does not participate in this loop. Widow/orphan rules may require
bounded producer lookahead or rollback of tentative lines; the paginator asks
for a legal fragment instead of editing its line list.

## 5. Geometry snapshots, dependencies, and checkpoints

A geometry snapshot carries a generation and immutable placement/exclusion
data. Start with a conservative run-wide generation check. A mismatch rejects
an outstanding attempt; finer page/region dependency versions can later retain
unaffected fragments. Generation identity alone is not a reusable cross-run
geometry cache key and does not prove convergence.

The current `yOffset` model permits an image to overlap content BEFORE its
anchor. Invalidation must cover both its old and new exclusion footprints,
including vacated space, and propagate subsequent placement changes. Replaying
only "downstream of the changed anchor" is insufficient.

```ts
interface LayoutCheckpoint {
  readonly preparedDocumentId: PreparedDocumentId;
  readonly blockIndex: number;
  readonly continuation?: BlockContinuation;
  readonly regionCursor: RegionCursorState;
  readonly acceptedOutputLength: number;
  readonly geometryGeneration: number;
  readonly placementPrefix: PlacementPrefixSnapshot;
}
```

`RegionCursorState` includes active page/column/section and pending flow spacing.
The checkpoint also needs enough geometry dependency information to prove its
prefix remains valid. Merely saving an integer generation cannot restore anchor
placement or identify the earliest affected fragment.

On geometry change:

1. Locate the earliest accepted dependency affected by old/new footprints or
   changed page capacity. For the initial conservative implementation, replay
   from the document start when a safe shorter prefix cannot be established.
2. Restore the checkpoint immediately BEFORE that dependency.
3. Discard accepted suffix output and tentative attempts, retaining the new
   proposed geometry as input to the next pass.
4. Replay; publish the replacement suffix and its character-map generation
   together when accepted. Repeated headers or cell backgrounds cannot create
   duplicate source ownership during publication.

Use a bounded geometry replay loop with deterministic placement signatures and
an explicit exhausted/failure result. Checkpoints bound work per replay; they
do not bound the number of replays. A numeric budget and cycle detection are
separate requirements. Never relabel an exhausted pass as stable. The existing
image placement policies, including page ownership, clamping, wrap margins, and
paint order, remain the initial behavioral baseline.

Streaming checkpoints and producer continuations serve different purposes.
The existing LayoutResumption resumes work across scheduler slices; extend it
to carry a committed producer state rather than treating its item index as a
paragraph continuation. Geometry changes still invalidate its saved prefix.

## 6. Tables: collective row-fragment acceptance

```text
Table state → row index / partial row
Partial row → state for each cell
Cell state  → complete OR next child index + child producer state
```

Retain a resolved column grid for the table attempt. A cell supplies a nested
region, reduced by applicable padding and borders. Each unfinished cell asks
its child producers to fill the offered capacity. Nothing commits yet.

The row validates all proposed cell results against a split policy, then chooses
its outer fragment height from their occupied extents plus required decoration.
Every cell receives that same outer height; inner content may be shorter.
If acceptance changes capacity or reserved border space, regenerate the affected
tentative cell attempts rather than trimming their completed lines.

Completed cell content stays complete. If another cell continues, the row emits
the completed cell's empty continuation rectangle as visual structure. Do not
invent a content cursor or new source range for that rectangle. Source mapping
distinguishes repeated visual ownership from newly consumed content.

Initially require legal progress from every unfinished cell that has content
to start in a row fragment; otherwise reject the row attempt collectively.
Oversized unbreakable children use the explicit overflow policy. This avoids
one cell silently advancing past a sibling that cannot begin. Define and test
any later relaxation as a table policy change.

Keep constraints composable rather than making them mutually exclusive enum
cases. A row can be atomic AND keep-with-next; a paragraph can have both widow
and orphan thresholds. Start with `atomic` / `splittable` as the row break mode,
derived from `allowBreakAcrossPages`, with group keep rules owned by the parent
flow. Paragraph line-count constraints remain in the paragraph producer.

First delivery covers ordinary top-aligned rows at a stable column grid.
Vertically merged rows retain an explicit atomic fallback until their shared
content ownership is designed. Repeated headers, vertical alignment across row
fragments, and tables changing grid width between regions require separate
policies; they are not implied by the continuation types.

Row layout resolves first/last-fragment edges and cut borders into decoration
data. Canvas and PDF consume those decisions consistently. A full shared
display list is not required for this migration.

## 7. Caching and compatibility

Two distinct caches:

- Prepared content: immutable node identity, effective formatting, inline
  measurement inputs, font-resolution generation, and context-dependent field
  values. Values retain relative source mappings.
- Fragment attempts: prepared identity, continuation, region dimensions and
  cursor, split/overflow policy, plus immutable geometry dependencies. A provider
  function's identity alone is not evidence that its geometry is unchanged.

Height matters as well as width: it determines where a fragment stops. Cache
only results whose dependencies are fully known. Start without a fragment cache
if necessary; the existing text measurement caches remain useful.

An adapter initially emits the existing LayoutBlock / LayoutFragment shapes,
including their current line arrays. Zero-copy fragment storage is separate
work. Preserve list markers, font-resolution IDs, inline-atom marks, hard-break
mapping, and source ranges across that adapter.

The change is primarily internal. Do not add a public extension API until
paragraph and table producers demonstrate the contract. BlockStrategy is
currently a PAINT interface; do not silently turn its render method into a
speculative layout method.

## 8. Implementation phases and exit criteria

Each phase is reviewable against the preceding behavior. No dates are assigned.

| Phase | Work | Exit criterion |
|---|---|---|
| 0 — Contract | Introduce pure attempt/result values and a constrained adapter around current paragraph machinery | Frozen inputs remain unchanged; repeated calls agree; rejected attempts are disposable; no-fit consumes nothing; partial advances |
| 1 — Region cursor | One physical page supplies one region; centralize page/Y/spacing advancement | Existing single-column output and section parity remain equivalent |
| 2 — Paragraph producer | Extract prepared inline input and source-relative, line-at-a-time continuation | Same-width and changed-width resumption preserve source, marks, atoms, breaks, and terminal lines |
| 3 — One line authority | Route continuation requests through the paragraph producer; remove pagination's source reconstruction/re-breaking | No paginator call builds text lines; wrapped continuation output remains correct |
| 4 — Geometry replay | Immutable snapshots, checkpoint restoration, backwards-overlap invalidation, bounded replay | Existing anchor behavior passes; stale attempts cannot commit; unstable geometry is reported explicitly |
| 5 — Row splitting | Recursive cell producers and collective row-fragment acceptance | Splittable ordinary rows continue across pages; atomic rows retain policy; canvas/PDF/source mapping agree |
| 6 — Columns | Region generation from section settings, sequential equal-width flow | Column transitions, section changes, navigation, selection, image confinement, and export pass together |

Phase 0 is deliberately limited to behavior its adapter can honor; it does not
claim to solve arbitrary-width continuation by slicing prebuilt lines. Phases
2 and 3 should be developed together where keeping both authorities alive would
make intermediate output inconsistent. Wrapped paths stay on the legacy route
until their replacement passes parity checks; removing the last old re-break
path is a release gate, not a prerequisite to testing the new producer.

Columns become simpler, not automatic. Region geometry, float confinement,
reading-order navigation, page chrome ownership, and section transitions still
need implementation and tests. Unequal columns and vertically merged row splits
remain later extensions.

## 9. Verification contract

- Content conservation over whole and resumed layout, including empty
  paragraphs, multiple/trailing hard breaks, inline atoms, grapheme splits,
  font changes, list markers, and geometry-bearing fields.
- Pure speculative calls: reject a candidate and retry elsewhere with the same
  input; no cursor, output, source mapping, or placement has changed.
- Whole vs scheduler-interrupted layout produces equivalent accepted geometry
  and source mapping for the same snapshots.
- Width changes alter future line breaks without re-emitting consumed text.
- Tall inline objects change line height and exclusions without intersecting
  forbidden geometry; repeated height/segment configurations terminate.
- No-fit at a partially occupied region, at an empty region, under a full-width
  exclusion, and with oversized content all have finite explicit outcomes.
- Moving an image upward invalidates earlier overlapping content; moving it away
  restores old excluded space; a stale geometry generation cannot commit.
- Checkpoint replay restores pending spacing, placement state, partial block
  state, and output length. Geometry exhaustion is observable.
- A rejected table row discards all cell advances. A completed cell emits only
  a visual box beside a continuing cell. Test border cuts and source ownership.
- Page/column transitions retain correct caret and hit-testing mappings;
  canvas and PDF consume equivalent accepted fragments under the same fonts.
- Cache reuse is invalidated by relevant width, capacity, exclusions, fields,
  or font changes; unchanged source shifted by preceding edits maps correctly.
- Retain deterministic geometry-work scaling checks alongside correctness tests;
  do not substitute machine-dependent timing thresholds for source conservation.

## 10. Current-code entry points

- [LineBreaker](../packages/core/src/layout/LineBreaker.ts): current whole-
  paragraph line construction and segmented LineSpaceProvider.
- [PageLayout](../packages/core/src/layout/PageLayout.ts): orchestration,
  anchored-object placement, paragraph splitting, continuation re-breaking,
  LayoutResumption, and fragment output.
- [TableLayoutEngine](../packages/core/src/layout/TableLayoutEngine.ts): current
  row/cell measurement, stable grid widths, and relative cell coordinates.
- [LayoutCoordinator](../packages/core/src/layout/LayoutCoordinator.ts):
  scheduling, publication, character-map generations, and streaming.
- [PageMetrics](../packages/core/src/layout/PageMetrics.ts) and
  [aggregateChrome](../packages/core/src/layout/aggregateChrome.ts): existing
  page geometry and contributor convergence; reuse their ownership boundaries.
- [Format ownership RFC](./format-lane-ownership-rfc.md): extension-owned PDF
  rendering remains independent from adopting a shared screen/PDF display list.

The older pipeline and decoupling notes are historical context. They are not
evidence that pure geometric pagination, zero-copy fragments, or resumable
block producers already exist.

## 11. What shipped

Nothing yet — this is a proposal. Updated as each phase lands, so design and
reality stay in one document. Where the code and the sections above disagree,
this section says so rather than the proposal being quietly rewritten to match.

Specifically not shipped, because the surrounding code can be misread as
implying otherwise: pure geometric pagination, zero-copy fragments, and
resumable block producers. The split-at-boundary behaviour in `PageLayout` is
the current approach this RFC proposes replacing, not a first phase of it.
