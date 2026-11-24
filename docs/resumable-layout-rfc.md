# Resumable Layout RFC

> Status: **contract proposed, awaiting sign-off on §14**. No engine code yet.
> Grounded in the code on `main` at `54b21ca3` and in Word 16.111 (measured,
> [columns RFC](./columns-rfc.md#word-measured)). It is the contract behind
> [columns](./columns-rfc.md) and splittable [composite](./composite-layout-rfc.md) units.

> **A region describes space. A producer consumes source. A container places
> children. A progression says which region is next. A composite policy accepts
> siblings together.**

> **Resume source consumption, never previously produced lines.**

## 1. What is wrong today

### 1.1 Three places decide where content breaks

| Where | What it decides | How |
|---|---|---|
| `paginateFlow` | Which page and y each block gets, which lines split off | Compares with `contentBottom`, its own split loop |
| `FlowPlacement` (`advanceFlowGlobalY`, `landingAfter`, `flowCursorAfter`) | The same thing, in global Y, for the solver | Models `paginateFlow` case by case |
| The solver's `LineSpaceProvider` (`reflowFlowsAgainstExclusions`) | Which page a line falls on while it is broken | Skips a line past the page bottom itself |

`paginateFlow` then takes `max(its own y, the solver's y)`. When the three
disagree, the disagreement is painted as a gap. An earlier version of this RFC
named only the first, so a region cursor built from it would have left the
second and third unaware of columns.

### 1.2 Pagination rebuilds source from lines

`rebreakWrappedLinesWithoutExclusions` flattens a block's lines back into spans
and breaks them again. It has three call sites; the one for atomic blocks is
unreachable, because the solver never marks a leaf or composite as wrapped. The
other two run when a paragraph wrapped beside a float on one page is later
carried to a page with no float: the settle re-scans only pages that hold an
exclusion, so the old lines travel along.

Reproduced on `main` (float beside the paragraph on page 1, then a top-and-bottom
float above it pushes the paragraph to page 2):

| Effect | Expected | Actual |
|---|---|---|
| First line with `textIndent: 60` | starts at x 60 | starts at x 0 |
| Page 2 of a paragraph that splits | filled to within one line | three lines left empty mid-paragraph |
| The paragraph after it | one gap below | two lines (38px) too low: placed from the old, taller lines |

The third is 1.1 and 1.2 together. A list marker's room can be lost the same
way; the list case reproduced the last two effects, but its marker fits its
hanging, so that loss stays unproven.

### 1.3 A region means two things

`RegionPlacement` carries a `node`. That fits a cell, whose content is its
node's children. A column has no node: it is space one stream passes through.

### 1.4 Spacing differs by container, and the cell's is wrong

`layoutRegionBlocks` puts a block at `relY` and then adds
`spaceBefore + height + spaceAfter`, so a heading in a cell gets its
`spaceBefore` **below** it, and adjacent margins add where the body collapses
them. Word keeps the first block's space before and the last block's space
after inside the cell, and collapses between siblings (§7).

## 2. Vocabulary

| Term | Meaning | Today |
|---|---|---|
| **Flow region** | Page, origin, width, height. Nothing about content | New; generalizes the page's content box |
| **Region group** | The regions on one page that share a top and close together | New: a page can hold several sets of side-by-side regions (a title over two, then one) |
| **Prepared flow** | A stream's children, ready to consume at a width | `LayoutItem[]` + `FlowBlock[]` |
| **Producer** | Consumes one child's source: paragraph, leaf, composite unit | `layoutBlock` |
| **Flow container** | Places children in a region, owns spacing, keeps the child continuation | Body loop and `layoutRegionBlocks`, separately |
| **Region progression** | The region after this one | `currentPage + 1`, in three places |
| **Composite policy** | Coordinates sibling streams, accepts a unit collectively | `layoutRegions`' "tallest region" |
| **Layout run** | Items that share region geometry, plus how they end | New; a section, or a section's part up to a forced break |
| **Flow-Y** | Scalar position along reading order | `globalY`, kept |

`RegionPlacement` keeps its public name and shape: it is an extension's
declaration of where a unit's regions sit **and what each holds**. It becomes an
input from which the engine builds a flow region (space) and a prepared flow
(content). It does not become the flow region.

"Band" is taken (the solver's vertical spans; header and footer bands), so the
set of side-by-side regions is a *group*.

## 3. The contract

Internal sketches. Nothing here is public API until the paragraph and composite
producers have both proved it.

```ts
/** Space only. */
interface FlowRegion {
  readonly id: RegionId;              // page + ordinal in reading order
  readonly page: number;
  readonly x: number;                 // origin, page coordinates
  readonly y: number;
  readonly width: number;
  readonly height: number;            // Infinity when nothing bounds it
  readonly startsPage: boolean;       // its top is the page's content top
}

/** One attempt: what the container may use of a region. */
interface RegionOffer {
  readonly region: FlowRegion;
  readonly top: number;               // region-local y to start at
  readonly height: number;            // <= region.height: a smaller target is a retry
  readonly isEmpty: boolean;          // nothing accepted in it yet
  readonly spaceSpent: number;        // space after the previous child, already laid
  readonly space: LineSpaceProvider;  // region-local, derived from one exclusion snapshot
  readonly onOversize: "refuse" | "place";
}

type FillResult<Continuation, Fragment> =
  | { readonly kind: "complete"; readonly fragment: Fragment }
  | { readonly kind: "partial"; readonly fragment: Fragment; readonly continuation: Continuation }
  | { readonly kind: "noFit" };

function fillRegion(
  flow: PreparedFlow,
  from: FlowContinuation,
  offer: RegionOffer,
): FillResult<FlowContinuation, FlowFragment>;
```

`LineSpaceProvider` and `LineSpace` are today's. `FlowFragment` holds the placed
parts in region-local coordinates, the extent consumed (space after and
clearance past floats included), and the space after its last child. Painted
bounds and flow advance are different numbers.

### Continuations

```ts
/** A stream: which child is next, and where in it. */
interface FlowContinuation {
  readonly child: number;
  readonly inner?: ChildContinuation; // absent: the child starts fresh
}

type ParagraphContinuation =
  | { readonly at: "content"; readonly offset: number; readonly firstLineOwed: boolean }
  | { readonly at: "trailingLine" };  // the empty line after a final hard break

/** One state per region of the unfinished unit, in region order. */
type UnitContinuation = readonly (FlowContinuation | "done")[];
```

- `offset` is an offset into the paragraph node's own content, UTF-16, at a
  grapheme boundary. Text advances by its length, an atom, an anchor or a hard
  break by 1, so one integer names any point, and it does not move when the
  document before the paragraph does. An `(item, offset)` pair, as an earlier
  version had, says the same thing twice.
- `firstLineOwed` is true while no line that can hold text has been placed (a
  part that is only a full-width float's gap). The first-line indent and the
  marker go with it.
- A continuation is a value, valid for the prepared content it came from: same
  node, same width-independent preparation. After an edit it is discarded, even
  if its offset would still be in range.

### Rules

1. Same flow, continuation and offer give an equivalent result. Page numbers,
   fonts and mutable exclusion managers are not ambient inputs.
2. `partial` strictly advances the source. `noFit` consumes nothing.
3. Consumption over accepted fragments is ordered, with nothing dropped or
   repeated. (`LineBreaker` drops a word today when a line has no segments and
   no `skipToY`; the producer must treat that as no room, not as consumed.)
4. Visual decoration may repeat without consuming source.
5. `fillRegion` never sees a boundary, a page number or a section. Every forced
   move is a run ending (§5).
6. A producer publishes nothing: no `CharacterMap`, page list, placement or
   cache write that could change a later result.

**What each layer commits**

| Layer | Commits |
|---|---|
| Paragraph / leaf producer | Nothing. Returns a fragment |
| Flow container | Nothing. Returns a fragment with its parts |
| Composite policy | Nothing. Accepts or rejects all regions of a unit |
| **Fill loop** (one, top level) | Fragment, continuation, region cursor and float placements, together |
| `LayoutCoordinator` | The finished layout, its index, the `CharacterMap` generation |

### noFit and overflow

| Situation | Outcome |
|---|---|
| Does not fit, region not empty | `noFit`; the loop offers the next region |
| Does not fit, region empty, region does not start its page | `noFit`; next region (a later one is taller) |
| Does not fit, region empty and starts its page | Offered again with `onOversize: "place"`: one line, leaf or unit is placed and overflows |
| Unbounded region | Never `noFit` |

A first line within half a pixel of fitting fits (`lineFitsAt`, unchanged). A
region with no room for anything is skipped the same way, so a continuous run
that starts at the very foot of a page continues on the next.

Word agrees: a line taller than the page, in a short two-column group, skips
both columns and lands alone at the top of the next page. The rule also proves
termination, since progression always reaches a region that starts its page.
A unit passes `onOversize` down to its regions.

Progression stays finite by construction, so there is no page cap. A settle that
does not converge is a different failure and is not a `noFit` (§6).

## 4. Who owns the page break

> **The fill loop is the only code that compares content with a region's bottom.**

```text
runs → region progression ─┐
                           ▼
prepared flow ──────► fill loop ──► parts: (region, local y, source range)
        ▲                  │
        │ exclusions       ▼
        └──────── float solver ── "place this anchor here"; asks for a refill
                           │
                           ▼
                     emit pages (no decisions) ──► fragments, CharacterMap, PDF
```

- **Landing is data.** The fill loop gives each child its parts. `globalY` is
  computed from the first part, not the other way round.
- **`FlowPlacement` stops modelling pagination.** `advanceFlowGlobalY`,
  `landingAfter` and `flowCursorAfter` become reads of the parts or go.
- **`paginateFlow` stops deciding.** It copies parts into `LayoutPage.blocks`.
- **The solver stops knowing page bottoms for text.** Its line space is the
  region's, which ends where the region ends. It still decides where a *float*
  goes (push to the next page, clamp, stack): placement, not breaking.
- **No code outside the loop may write "page + 1".** Progression owns it.

`runMiniPipeline` uses the same loop with one unbounded region, so headers and
footers are in scope for every equivalence check.

## 5. Runs and region progression

The document stays flat. Sections are projected before placement:

```ts
interface LayoutRun {
  readonly from: number;              // first item index
  readonly to: number;                // past the last item
  readonly boxes: readonly RegionBox[]; // x and width inside the content box, in order
  readonly ending: RunEnding;
}

type RunEnding =
  | { readonly kind: "nextPage"; readonly parity?: "even" | "odd" }
  | { readonly kind: "sameGroupBelow"; readonly balance: boolean }
  | { readonly kind: "end" };
```

- **The adapter is `model/sectionFlow.ts`** (new, beside `model/sections.ts`).
  It reads `SectionSettings.columns` through `deriveSections` and returns runs.
  `layout/` imports the function and never reads `columns`, `sectionBreak` or a
  table grid.
- **A break's settings describe the run before it**, so all runs are derived
  before the first is measured. `LayoutBoundary` today carries only the
  transition; it becomes the run's ending.
- **A page break ends a run** with the same boxes on both sides. A column break,
  later, adds one ending; the fill contract does not change.
- **Measurement takes its width from the run**, not from `pageWidth - margins`.
- A run ends where content ends, so a group is **tentative until its run closes
  it**. Streaming never counts the open group's page as completed (§10).

Progression within a run: the next box of the group; after the last box, a new
group at the next page's content top. `LayoutRun` and `PageGeometry` are its only
inputs, so it is a pure function and the chrome loop's iterations rebuild it.

### Closing a continuous run

> A group closes at the **largest occupied bottom of its regions, trailing space
> after included**. The next run starts there, at full content width.

A run that ends `sameGroupBelow` with `balance` is then retried: refill the
run's **last group only** from its saved continuation, with a smaller
`RegionOffer.height`, and take the smallest height at which everything still
fits. Candidate heights are occupied extents, searched by bisection, so the
number of attempts is logarithmic in the group's lines. Word's behaviour, in
full, is in the [columns RFC](./columns-rfc.md#word-measured):

- It balances before a continuous break; a section ended by a next-page break,
  and the final section, are not balanced.
- Only the last page of a multi-page run is balanced.
- `noColumnBalance` is honoured in compatibility mode 14 and below and
  **ignored in mode 15**. Closing at the largest bottom without balancing is
  Word's result for that setting in those older modes.

## 6. Exclusions, floats and replay

### Ownership

| | Owner | Scope |
|---|---|---|
| Float | The child that anchors it | |
| Placement | Solver | |
| Exclusion rect | Solver, in page coordinates | **The page** for body text, whatever region a line is in. **The unit's region** for a composite |
| Line space | Derived per region: rects translated into it, clipped to its width | One offer |

A column is not an exclusion scope; a cell is. In Word a float anchored in
column 2 that reaches over column 1 wraps column 1's text, and one anchored in
column 1 wraps column 2's. The columns RFC's earlier "confined to the column"
is withdrawn.

A top-and-bottom float removes the whole line **in each region its rect
touches**, not across the page: today's rect spans the content box, which would
clear column 1 for a float that sits in column 2. `xAlign` and `x` resolve
against the anchor's region (Word's `relativeFrom="column"`); the width clamp
stays the page's content box (Word keeps a 400pt float 400pt wide in a 216pt
column). `yOffset` may place a float over content before its anchor, so a
placement can invalidate an **earlier region on the same page**.

### Which algorithm

| Flow | Algorithm | Until |
|---|---|---|
| Body, any number of regions | The solver's settle: dirty ranges, oscillation lock, 64-pass backstop | stays |
| Composite region | `layoutRegionContent`'s three passes | Phase 6 decides |

The settle is kept, not replaced. Its lock matches Word: in the probe where a
float in column 2 pushes its own anchor down by re-wrapping column 1, Word
leaves the float where it was and moves the anchor, which is what the lock does.
What changes is what it asks: "flows on this page" becomes "children with parts
in regions this rect touches", and a refill replaces `layoutBlock` + restamp.

### Replay

A **checkpoint** is the region cursor and continuation before a child, which the
fill loop has anyway. On a placement change:

1. Take the old and the new footprint. The vacated space counts.
2. Restore the checkpoint before the earliest child with a part in a region
   either touches. Until that is proven safe, restore the run's start.
3. Refill from there, all later parts being discarded.
4. Publish once, after the settle ends.

Balancing is outside, settling inside: each candidate height settles its own
floats, on one page. Checkpoints bound one replay; the lock and the backstop
bound how many there are. A settle that reaches the backstop keeps reporting
that it did, and is never relabelled stable.

## 7. Spacing is a container policy

A producer reports space before and after. The container applies it:

| | Body, region that starts its page | Body, region lower on the page | Composite region |
|---|---|---|---|
| First child's space before | dropped | `max(0, before − spaceSpent)` | kept |
| Between siblings | `max(after, before)` | `max(after, before)` | `max(after, before)` |
| Last child's space after | kept out of the fit test | part of the group's bottom | part of the region's height |

All measured in Word. One model gives every cell of the table: **space after is
laid when its block is placed, and the next block's space before is reduced by
it** (`spaceSpent`). Inside one region that is today's `collapseMargins`. Across
regions it is what Word does at the top of column 2: `before` 10 after an `after`
of 20 adds nothing; `before` 12 after 0 adds 12.

- A gap is never given up to fit a line (today's rule, and Word's).
- A part that continues a child has no space before; only the last has after.
- Space after may hang past a region's bottom.
- `spaceSpent` crosses a region change except into a region that starts its page.
- An anchor-only paragraph keeps none of its own (`itemSpacing`, unchanged).

Known Word differences left alone, because the body does not have them today:
space before kept at the document's first page and after an explicit page break.

## 8. Coordinates

| Space | Who uses it |
|---|---|
| Region-local | Producers, containers, line space. Origin is the region's |
| Unit-relative | A composite unit's regions, `x` and `y` |
| Page | `LayoutBlock`, placements, exclusions, `CharacterMap`, PDF |
| Flow-Y | Solver bookkeeping, `AnchoredObjectPlacement.globalY`, drag |

- A transform is applied **once, by whoever accepts the fragment**. Composite
  region `x` is absolute today because a page has one content x. Internally it
  becomes unit-relative; the accepted `LaidRegion` keeps its absolute `x`, so
  painters, hit-testing and PDF do not change.
- Flow-Y stays a scalar: the start of the region (a running sum in reading
  order) plus the local y. With one region per page it equals today's number. It
  orders positions. A **difference** of two flow-Ys is a distance only inside
  one region; §1's `flowY + height` arithmetic has to go through parts.
- Flow-Y ↔ page alone is not invertible once a page has two regions.
  `PointerController.pageLocalYToGlobal` needs the region under the pointer.

## 9. Reading order, navigation and indexes

`LayoutPage.blocks` is **reading order**. With one region that is also y order;
with two it is not.

| Consumer | Today | Rule |
|---|---|---|
| `CharacterMap.posAbove` / `posBelow` | Next line on the page by y, then the next page | Next line **in the same region**; at its edge, the first or last line of the region next in reading order, with x moved by the difference of region origins |
| `posAtCoords` after that | Called with the old x | Would resolve straight back into column 1; hence the x move |
| `LineEntry` | page, y, x | Gains its region id. Lines in a cell carry their body region's |
| `LayoutFragment` doc, `buildFragments` | "sorted by page then y" | Sorted by reading order; by y only in pageless |
| `TileManager.fragmentsInTile` | Binary search on y, pageless only | Safe because pageless has one region (below) |
| `LayoutCoordinator.fragmentIndex` | Sorted by document position | Holds. Composite units add no entries today, so a split unit needs some (Phase 7) |
| `nodeRects` | One rect per page | One per region, or a node across two columns gets a box over both |
| `AiSuggestion` stripe, `SourcedBlock` gutter | `margins.left` | The block's region |
| PDF | Draws at `block.x` | Verified by op log, not assumed |

**Pageless has one region**, full width and unbounded, whatever the section
says. Columns need a bottom, and Word's Web Layout shows one column.

Widow/orphan and keep-with-next do not exist and are not built here. The room
for them: a container may reject a fragment and offer less height, and keeping
an earlier continuation is all a group keep needs.

## 10. Streaming and reuse

- `LayoutResumption` carries one cursor (region, local y, `spaceSpent`) and one
  `FlowContinuation`. It has two today (`currentY` and `flowCursor`) because
  there are two authorities.
- The block budget may stop between items, as now, or inside a child once its
  continuation exists. Runs are derived whole, up front, and travel with it.
- The open group's page is never in `completedPages` or `prevPageCount`. A
  partial layout shows an unfinished run unbalanced; balancing happens when its
  ending is reached, on a page not yet declared final.
- Tail reuse (Phase 1b) keys on region id, local y and `spaceSpent`, and on the
  previous layout having the same runs from here on. It never starts inside a
  run that balances.
- Fragment caching is not part of this. The measure cache stays keyed by width;
  equal widths need no new key.

## 11. Walk-throughs

**A paragraph across two columns and a page.** Regions A and B on page 1, C on
page 2. `fill(flow, {child 4}, A)` places 10 lines: `partial`, continuation
`{child 4, content@812}`. The loop commits and offers B from its top: 31 lines,
`partial`, `content@3290`. C: `complete`. Three parts, one `sourceNodePos`,
`fragmentIndex` 0–2. The indent and marker go on the first part, and no part
is made from another's lines: each is broken from source, at its own region's
width and exclusions.

**Title over 2-up, then full width.** Run 1: one box, ends `sameGroupBelow`.
Closes at the title's bottom plus its space after. Run 2: two boxes, `startsPage`
false, so column 2's first block keeps the part of its space before not spent.
It completes in column 1, so its group is retried smaller and ends 6 lines and 5
(Word: `L6` at y 192, `L7` at the column top). Run 3 starts at the larger bottom.

**An oversized line in an empty region.** Column 1 below a title, not empty:
`noFit`. Column 2, empty, does not start its page: `noFit`. Page 2's first
region, empty and `startsPage`: offered with `place`. One line, overflowing. The
next line is offered the same region with no height left: `noFit`, page 3.

**A float anchored in column 2.** Its rect covers column 1's last 84pt, the
gutter, and column 2's first 40pt. The fill reaches the anchor, the solver places it, and its
footprint touches A, which precedes B. Checkpoint: the first child with a part
in A. Refill: column 1 now holds fewer lines, so two paragraphs move to column 2
and the anchor drops 40pt. Placing the float from the new anchor repeats an
earlier state, so it locks where it was, as Word does.

**A three-cell row, atomic.** The unit offers each cell an unbounded region.
All `complete`. Height is the tallest; the row fits or `noFit`s whole. Today's
behaviour. **Splittable.** Each unfinished cell is offered what is left. One cell
`noFit`s before it has started: the policy rejects all three and the row moves
whole (Word moves a row whose second cell cannot place its first line). Otherwise
the row accepts `[partial, done, partial]`, every box takes the row's fragment
height, and a done cell draws its empty box on the next page without consuming
anything.

**A streaming cutoff mid-paragraph.** The budget ends after region A's commit.
Saved: cursor at B's top, `{child 4, content@812}`, the runs. The partial layout
shows A. The next slice continues into B as if it had not stopped. An edit
meanwhile discards the resumption, as today. If the run balances, its page was
never declared complete, so balancing it later rewrites nothing final.

**A header mini document.** One run, one box, one unbounded region, no
exclusions. Never `noFit`, never `partial`. Natural height is the cursor's y
without the last space after, as `runMiniPipeline` reports now.

## 12. Composite units

- `RegionPlacement` gives a flow region (space) and a prepared flow (the node's
  children through `collectChildItems`). Boundaries inside stay ignored.
- **Atomic** is a fill with unbounded regions. It is not a separate path.
- **Splittable** is a break mode on the unit, declared by the extension next to
  `regions`: a row maps its "may break across pages" to it. Word splits rows
  unless told not to; a row that may not and does not fit starts a new page and
  overflows from there.
- A unit's policy: every region with content left must make progress, or all
  are rejected. The unit's height is the tallest result plus insets, and every
  box gets it. If accepting changes the capacity (a border, an inset), the
  attempts are **made again**, not trimmed.
- A region that is done repeats its box only, and its source range is empty.
- Vertical merges stay atomic. Repeated header rows, vertical alignment across
  fragments, and a grid that changes width between regions are later work.
- Keep rules are a separate axis from the break mode.

## 13. Phases

Each is one PR with no second authority left alive at its end. Equivalence means
the oracle of §15 is unchanged unless a difference is listed here first.

| Phase | Work | Output changes |
|---|---|---|
| 0 | Correct what the oracle would otherwise freeze: cell spacing (§7), stale wrapped lines (§1.2), oversized atomic blocks (§14.7) | Yes, these three |
| 1 | `FlowRegion`, cursor and progression, one region per page. Landing is data; `paginateFlow` emits; `FlowPlacement`'s model goes | None |
| 2 | Paragraph continuation and the flow container. Line breaking stops at the region's bottom; the solver's provider loses pages; re-breaking is gone | None beyond listed |
| 3 | Exclusions by region: page-scoped rects, region line space, settle by touched region, checkpoints | None: still one region per page |
| 4 | Runs from sections; sequential equal-width columns; closing; navigation, pageless, tail reuse, drag, PDF | Multi-column sections |
| 5 | Balancing | Multi-column sections ending continuous |
| 6 | Flow container inside composite regions, units atomic | None |
| 7 | Splittable units | Tables that split |

6 and 7 need 2, not 3–5. Columns need 1–4, not 6–7, so **neither blocks the
other**. Phases 0–3 change nothing a column setting does today (nothing). 4 and 5
merge separately and are released together (§14.2).

**Riskiest: Phase 2.** It replaces line breaking's all-at-once loop and is called
from inside the float settle, where a fraction of a pixel decides an oscillation.
Phase 3 is second. Pair on both the seam between fill and settle (2) and the
checkpoint rule (3); 1, 4, 6 are reviewable alone.

## 14. Decisions needed

1. **The fill loop is the only page-break authority**, solver and pagination
   included (§4). *Recommend yes.*
2. **Balance before a continuous break**, as Word does, or only close at the
   largest bottom. *Recommend balancing (Phase 5), after sequential columns, with no
   release between the two and no DOCX import of columns before it: no document
   then re-flows when balancing arrives.* Closing at the bottom is kept as its first
   half.
3. **Cell spacing follows Word** (§7), which changes table heights and moves
   DOCX layout baselines. *Recommend yes, in Phase 0.*
4. **Exclusions are page-scoped**, so a float in one column wraps another's text,
   as in Word; the columns RFC had confined them. *Recommend page scope.*
5. **Geometry work goes between paragraph continuation and columns** (Phase 3),
   keeping the settle and its lock rather than writing a new replay engine.
   *Recommend yes.*
6. **Pageless shows one column.** *Recommend yes (Word's Web Layout).*
7. **An atomic block taller than a page** is drawn on the current, part-filled
   page today. §3's rule starts it on a fresh one, as Word does for a line
   (measured) and a row (ECMA `cantSplit`). *Recommend that, in Phase 0.*
8. **Fix stale wrapped lines in Phase 0** by having the settle re-lay a wrapped
   flow on whatever page it lands, and delete the re-break there; or leave both
   for Phase 2. *Recommend Phase 0: Phase 1's "emit only" is not possible while
   emission can change a height.* That the settle change is enough is reasoned,
   not yet tried.
9. **ArrowDown at the foot of a column goes to the next column's top.**
   *Recommend yes.* Word is believed to do this; its scripting has no arrow-key
   command, so it needs one manual check.
10. **Rows split by default**, as in Word. `allowBreakAcrossPages` defaults to
    `false` today and layout never reads it, so stored tables hold a `false`
    nobody chose. *Recommend deciding when Phase 7 starts: flip the default and
    read an old stored `false` as unset.*

## 15. Verification

The oracle (written after sign-off) compares today with each phase on: pages,
blocks, parts, source ranges, placements and caret mapping; whole, streamed and
with reuse; headers; the DOCX layout and Word-comparison baselines; PDF ops. It
asserts relationships, never wrap counts, and counts work (fill calls, lines
broken, children refilled), never time. Beyond it:

- Content conservation across regions: empty paragraphs, repeated and trailing
  hard breaks, atoms, grapheme splits, font changes, markers, fields.
- Purity: refuse a fragment, offer again elsewhere, same answer; frozen inputs.
- Width change on resumption moves later breaks and repeats nothing.
- Every row of §3's overflow table, at a partly used region, an empty one, under
  a full-width exclusion.
- A float moved up re-wraps earlier content, and moved away gives it back.
- A rejected unit advances no region.
- Balancing attempts grow with the logarithm of the group's lines.
- `engineVocabulary.test.ts` keeps column vocabulary out of `layout/`.

## 16. Entry points

- `layout/PageLayout.ts`: `runFlowPipeline`, `buildBlockFlow`, `paginateFlow`,
  `rebreakWrappedLinesWithoutExclusions`, `LayoutResumption`, `buildFragments`.
- `layout/FlowPlacement.ts`: the second authority.
- `layout/AnchoredObjectSolver.ts`: settle, reflow, the third authority.
- `layout/LineBreaker.ts`: whole-paragraph breaking. `splitLines.ts`: line fit.
- `layout/compositeLayout.ts`, `layout/layoutItems.ts`, `table/layout.ts`.
- `layout/PageMetrics.ts`: `PageGeometry`, which region geometry extends.
- `layout/runMiniPipeline.ts`, `layout/aggregateChrome.ts`.
- `layout/LayoutCoordinator.ts`, `layout/CharacterMap.ts`, `layout/nodeRects.ts`.
- `model/sections.ts`: `deriveSections`.

## 17. What shipped

Nothing. Updated as each phase lands, with every difference from the design
above and why. The split at a page boundary in `paginateFlow` is the approach
this replaces, not a first phase of it.
