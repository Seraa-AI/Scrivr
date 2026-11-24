# Resumable Layout RFC

> Status: **contract signed off 2026-11-24**, every decision in §14 as recommended.
> Grounded in the code on `main` at `54b21ca3` and in Word 16.111 (measured,
> [columns RFC](./columns-rfc.md#word-measured)). It is the contract behind
> [columns](./columns-rfc.md) and splittable [composite](./composite-layout-rfc.md) units. Claims marked *prototyped* were run
> against the real line breaker in a throwaway test (§15), not argued.

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

Measured with §1.2's fix applied, over 9,033 flows in 600 random documents: the
first disagreement in a document was, all 43 times, in a wrapped paragraph that
crosses a page, and in those inspected it is the third authority's. It fills the
foot of a page with a spacer line. When the sum misses the page bottom by 1e-13,
pagination moves the spacer to the next page, whose text then starts below its
top. It also breaks a line short at a page foot when a taller word arrives, since
it decides from one word at a time.

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

### 1.5 A streamed layout is not the whole layout

`carriedPlacements` keeps earlier chunks' floats to paint, and nothing else: a
later chunk does not wrap them, and an earlier chunk is never settled again for a
float found later. So any chunk boundary beside a float shows. A float in a later
chunk that reaches back over an earlier one wraps nothing there. Reproduced on `main`: a paragraph of 5 wrapped lines in a
whole layout has 3 unwrapped lines when the cutoff falls between it and the
float's anchor, with the image drawn over the text, and everything after it
sits 38px higher. It stays that way until something lays the document out again.

### 1.6 A deleted block can stay on the page

Tail reuse asks whether an edit has been seen (`seenCacheMiss`) and whether more
is to come (`remainingCacheMisses`). A composite unit is never in the measure
cache, so a document with a table always looks edited; after a pure deletion no
block is new, and the first block that has not moved copies the old tail, the
deleted block included. Reproduced in an `Editor`: table, A, B, C, delete B; the
document says A C and the layout A B C. Over 800 random edits of each kind, with
and without tables: 74 deletions with a table are wrong, and nothing else is.

## 2. The laws, and the words

The interfaces below may change. These may not.

1. **Source conservation.** Layout loses, repeats and reorders nothing.
2. **Explicit constraints.** A producer is given its inputs. It finds none in
   ambient mutable state.
3. **Local purity.** An attempt cannot change the result of another attempt.
4. **One placement authority.** Many decide fit; one accepts.
5. **Computational equivalence.** Whole, streamed, incremental and replayed give
   one layout (§6).
6. **Recursive composition.** A container speaks its children's protocol.
7. **Termination.** Every accepted step advances a finite computation, and every
   refusal has an explicit escape.

Layout is three operations, never one: **propose** (a producer), **accept** (the
fill loop, with container and composite policy), **publish** (the coordinator).
Accepted is not final, and neither means visible.

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
| **Flow position** | A region, and a y in it. Ordered by reading order | Replaces `globalY` inside the engine (§8) |

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
  | { readonly kind: "partial"; readonly fragment: Fragment; readonly continuation: Continuation; readonly shortage: number }
  | { readonly kind: "noFit"; readonly shortage: number };

function fillRegion(
  flow: PreparedFlow,
  from: FlowContinuation,
  offer: RegionOffer,
): FillResult<FlowContinuation, FlowFragment>;
```

`shortage` is the smallest increase of the offer's height that could change any
height-dependent decision made in the attempt: a line, a gap, a whole unit, later
a keep rule. Each layer reports its own and passes up the least. Only balancing
reads it (§5). `LineSpaceProvider` and `LineSpace` are today's.
`FlowFragment` holds the placed parts in region-local coordinates, the extent
consumed (space after and clearance past floats included), and the space after its
last child. Painted bounds and flow advance are different numbers.

### Continuations

```ts
/** A stream: which child is next, and where in it. */
interface FlowContinuation {
  readonly child: number;
  readonly inner?: ChildContinuation; // absent: the child starts fresh
}

/** Source consumed so far, as an offset into the paragraph node's content. */
interface ParagraphContinuation { readonly offset: number }

/** One state per region of the unfinished unit, in region order. */
type UnitContinuation = readonly (FlowContinuation | "done")[];
```

Three kinds of state, and the continuation is only the second:

| State | Holds |
|---|---|
| **Prepared source** | Immutable: spans, marks, atoms, resolved fonts, style, the marker, whether the paragraph is empty or anchor-only, offset ↔ document position |
| **Continuation** | How much of that source is consumed |
| **Offer** | Width, height, line space: everything spatial |

One integer is enough (*prototyped*: 400 random paragraphs with marks, atoms,
anchors, hard breaks, emoji and over-long words, 969 splits, nothing lost or
repeated at changing widths and exclusions; at one width, the resumed lines equal
the one-shot lines except for the phantom lines in the second row, which the
prototype re-prepared and the engine must not). What else a resumption could need
is derived:

| Needed | From |
|---|---|
| First-line indent, marker still owed | `offset === 0` (rule 2 makes this exact) |
| An empty line's font after a hard break | Looking back in the source from `offset`. Emptiness and this font are **preparation**, never re-decided on a remainder |
| Empty line owed after a final hard break | `offset === content size`: a partial there can mean nothing else |
| An empty or anchor-only paragraph | Never partial |
| Anchors | Zero-width and part of the source, and stay with the next word. Whether a float is *placed* is the solver's |
| An over-long word split mid-way | Re-split from `offset` at the new width, at grapheme boundaries. Each piece is measured alone, as now |
| Justified last line | The part's "continues" flag |
| Tab stops, bidi, hyphenation, contextual shaping | Not in the engine. A tab stop depends on the line's own geometry; direction is prepared; a discretionary hyphen is drawn and consumes nothing; shaping that crosses a split needs a prepared shaping run, and the offset still names the split |

Offsets are UTF-16, at a grapheme boundary: text advances by its length, an atom,
an anchor or a hard break by 1. A continuation belongs to its prepared source and
is discarded after an edit, even if its offset would still be in range. A producer
that finds it needs more state adds it to *its own* continuation type; the
container only stores it.

### Rules

1. Same flow, continuation and offer give an equivalent result. Page numbers,
   fonts and mutable exclusion managers are not ambient inputs.
2. `partial` strictly advances the producer's **finite state**, and its fragment
   **ends on consumed source**. `noFit` consumes nothing. Space is never progress
   (below). Running out of source is not being complete: after a final hard break
   all source is consumed and an empty line is owed, so `partial` at
   `offset === content size` is legal once, and the next step completes. An empty
   child completes with no source and advances the child index.
3. Consumption over accepted fragments is ordered, with nothing dropped or
   repeated. (`LineBreaker` drops a word today when a line has no segments and
   no `skipToY`; the producer must treat that as no room, not as consumed.)
4. Visual decoration may repeat without consuming source.
5. `fillRegion` never sees a boundary, a page number or a section. Every forced
   move is a run ending (§5).
6. A producer publishes nothing: no `CharacterMap`, page list, placement or
   cache write that could change a later result.

### Space is not progress

A region's clearance (the gap past a full-width float, a line holding only a
marker) is a **lead-in** to source. Clearance that no source follows in this region
is dropped, and the attempt is `noFit`: the next region has its own exclusions,
so there is nothing to carry. That keeps the three result types and makes rule 2
exact.

Word does this. A paragraph whose own top-and-bottom float fits the page but
leaves no line below moves to the next page **with its float**; a paragraph after
someone else's float moves whole. Today the engine leaves a part holding nothing
but the gap on the first page, the float stranded there, and the text on the next
(reproduced). So the anchor push widens from "the float fits below its anchor" to
"the float **and the anchor paragraph's first line** fit": without that, the
paragraph would leave, take the float along, fit again, and come back. When no
page can hold both, the paragraph starts a page and its first line is placed below
the float, overflowing (Word: a 635pt float on a 648pt page, its line 7pt past the
bottom): the overflow table's last resort, with clearance kept.

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

**Fit and shortage are one function**, so they cannot disagree: it returns how much
height is missing, zero meaning it fits. The half-pixel allowance for a first line
(`lineFitsAt`) lives in it. (*Prototyped*: a shortage unaware of the allowance
skips a smaller height in 2 of 2,000 stacks; an aware one in none.)

A region with no room for anything is skipped like any other, so a continuous run
that starts at the very foot of a page continues on the next.

Word agrees: a line taller than the page, in a short two-column group, skips
both columns and lands alone at the top of the next page. The rule also proves
termination, since progression always reaches a region that starts its page.
A unit passes `onOversize` down to its regions. A smaller `height` than the
region's, as balancing offers, never counts as the region being too short.

Progression stays finite by construction, so there is no page cap. A settle that
does not converge is a different failure and is not a `noFit` (§6).

## 4. Who owns the page break

> **The fill loop is the only authority that accepts placement and advances to
> the next region.**

An earlier draft said it was the only code that compares content with a region's
bottom. That was wrong: a producer has to know whether its next line fits. It
knows the **offer**, never the page. Authority is central; knowledge is not.

| Decision | Who |
|---|---|
| How much source fits the offer | Producer, inside its container |
| Spacing | Container |
| Are sibling fragments accepted together | Composite policy |
| Is a fragment accepted | Fill loop |
| Which region is next | Region progression |
| Where a float sits | Float solver |
| Which layout is visible | `LayoutCoordinator` |

So nothing outside the progression may write "page + 1", and nothing that fits
content may know what comes after the offer. The protocol is recursive: a
container is to its parent what a paragraph is to it, at any depth.

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

- **Landing is data.** The fill loop gives each child its parts. A flow's position
  is its first part's, not the other way round.
- **`FlowPlacement` stops modelling pagination.** `advanceFlowGlobalY`,
  `landingAfter` and `flowCursorAfter` become reads of the parts or go.
- **`paginateFlow` stops deciding.** It copies parts into `LayoutPage.blocks`.
- **The solver stops knowing page bottoms for text.** Its line space is the
  region's, which ends where the region ends. It still decides where a *float*
  goes (push to the next page, clamp, stack): placement, not breaking.

`runMiniPipeline` uses the same loop with one unbounded region, so headers and
footers are in scope for every equivalence check.

**Wherever balancing, settling or the chrome loop tries something, it must leave no
trace.** One exists today: `paginateFlow` writes `placedTargetY`, `placedPage`,
`placedRunId` and `placedContentTop` into the measure cache on every pass, the
chrome loop's discarded ones included, and tail reuse reads them. They are written
once, from the accepted layout.

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
`RegionOffer.height`, and take the **smallest height at which everything fits**.
Word picked the smallest in every probe, floats included.

Not by bisection. That needs "fits" to be monotone in the height, and with floats
it is not: a height changes where anchors land, which changes the wrapping
(*prototyped*: non-monotone in 11 of 120 groups with floats, bisection wrong in 8;
monotone in all 60 without). Instead, step:

1. Start at or below the answer. With no wrapping float: the content's line and
   unit heights, unspaced, over the number of regions, less the fit allowance. With
   one: the tallest single line or unit. The first is **not** a bound once lines
   are narrowed, because wrapping can make a paragraph shorter (a small word left
   alone lets two large ones share a line: 88.8px free, 62.4px narrowed, measured).
2. Fill and settle. Every `noFit` and `partial` reports its **shortage** (§3).
3. Fits: done. Otherwise raise by the smallest shortage **seen in any pass of the
   settle**, and repeat.

Nothing is skipped: between one height and the next, no fit test anywhere can
answer differently, so every pass is identical. That is an argument, not
monotonicity, and it holds under three conditions, each tested: **no float
placement reads the target height** (the clamp and the push read the page); every
height-dependent decision reports its shortage; and **each candidate settles from
scratch**, so trying one cannot colour the next. *Prototyped* against trying every
pixel: the same answer in all 180 groups. About 4 attempts from the first bound;
with floats, 22 on average and 79 at most in 250 groups of mixed sizes, started
from 1px, which is worse than the second bound. The unbalanced height fits, so the search ends. Columns of unequal
width, later, need the bound worked out again.

Word, in full, in the [columns RFC](./columns-rfc.md#word-measured):

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

A checkpoint is taken before a child, and restoring it is a rollback: after it,
the accepted prefix must be exactly what it was. Three kinds of state, treated
differently:

| State | On restore |
|---|---|
| **Accepted prefix**: region cursor (region, y, `spaceSpent`), `FlowContinuation`, number of accepted parts | Restored. The checkpoint is these values |
| **Iteration**: every float's proposed placement, the locks, the placements seen | **Kept.** It is what the replay is for, and rolling it back would repeat the pass |
| **Derived**: exclusion rects, line space, flow positions | Rebuilt from the placements. One immutable snapshot per pass, so a version number has nothing to add |
| **Outside layout**: measure cache, `CharacterMap`, indexes | Never touched during a pass (§4) |

On a placement change:

1. Take the old and the new footprint. The vacated space counts.
2. Restore the checkpoint before the earliest child with a part in a region either
   touches. Until a shorter prefix is proven safe, restore the **frontier** (below).
   A run's start is not enough: a page can hold an earlier run's end.
3. Refill from there with the new snapshot. All later parts are discarded.
4. Accept when the settle ends.

**How long the solver's state lives:**

| Event | Placements, locks, seen placements |
|---|---|
| Replay within a settle | Kept |
| Another balancing height | Fresh, from the state before the group |
| Another chrome iteration | Fresh |
| Next streaming slice | Rebuilt by replaying from the frontier. Placements behind it are final |
| An edit | Discarded with the run |

Today the seen placements last one settle and a lock lasts the run until its float
moves; both stay. What changes is that nothing reaches a run from outside it.

### When a page is final

Filled is not final: a float found later can re-wrap what came before it.

> **The frontier is the top of the earliest of: the page being filled, and the page
> on which the child in progress starts. Accepted source before it cannot change.**

Because a float excludes **only on the page its anchor paragraph starts on** (the
clamp keeps it there), and content only flows forward. A paragraph still in
progress counts from its start, since a float anchored in its later text is placed
from its top. The open group is on the page being filled, so it is covered, and so
is an earlier run that ends there.

Checked on `main`: a document's every prefix laid out alone, its pages before the
last compared with the whole document's. 8,551 pages, 6 differ, and those looked
at are §1.1's line broken short at a page foot, which line breaking by offer
removes.

- `completedPages` is the pages behind the frontier. `LayoutResumption` keeps the
  checkpoint **at** the frontier, and a slice starts by replaying from it: at most
  a page or so of work, and §1.5 is gone.
- Finality is within one chrome geometry. A header that changes height makes
  everything provisional, as it does now.
- Provisional pages are painted. Publishing is not finality.

Publication is already one step: `runPipeline` returns a value and
`LayoutCoordinator` swaps it, rebuilds its index and stamps the `CharacterMap`
generation before anyone is told. That stays.

Balancing is outside, settling inside: each candidate height settles its own
floats, on one page. Checkpoints bound one replay; the lock and the backstop
bound how many there are. A settle that reaches the backstop keeps reporting
that it did, and is never relabelled stable.

### What is deterministic

- **Local.** Same prepared source, continuation and offer: equivalent fragment.
  No iteration, so nothing to converge. Tested per producer.
- **Global.** Same document, fonts and configuration: equivalent accepted layout,
  **whatever came before**. Whole, streamed at any cutoffs, after an edit with
  reuse, and replayed are four ways of computing one result. This is an invariant
  of the architecture, not a regression test.

The second does not follow from the first: a settle's answer depends on its
iteration order and locks. It holds because order, locks and seen placements are
**functions of the run's input** — floats in document order, starting from no
placements, history discarded with the run — and nothing is seeded from a previous
layout. Reuse may only skip work whose inputs are shown equal (§10). Today streaming
breaks it (§1.5). One exception is inherited and stays visible: a chrome loop
that ends `exhausted` may depend on the payload it was seeded with.

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
| Flow position | Solver, checkpoints, drag; a scalar only in the public placement |

- A transform is applied **once, by whoever accepts the fragment**. Composite
  region `x` is absolute today because a page has one content x. Internally it
  becomes unit-relative; the accepted `LaidRegion` keeps its absolute `x`, so
  painters, hit-testing and PDF do not change.
- **A flow position is a pair, not a number.** Global Y did two jobs, reading
  order and distance, and with columns they part: later is not lower.

  ```ts
  interface FlowPosition { readonly region: RegionOrdinal; readonly y: number } // y is region-local

  compareFlowPositions(a, b): number
  toPage(position): { page, x, y }
  distanceWithinRegion(a, b): number | undefined // undefined across regions
  ```

  The engine's own code uses it from Phase 3, when the solver is re-based; until
  then the scalar stays inside the solver. It survives at the edge only, as
  `AnchoredObjectPlacement.globalY` and `anchorGlobalY`, computed on output, and
  equals today's number with one region per page.
- A page's y does not name a position once a page has two regions.
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
- A slice starts by replaying from the frontier (§6). `replaying` already does this
  from the document's start when chrome moves the geometry.
- The open group's page is never in `completedPages` or `prevPageCount`. A
  partial layout shows an unfinished run unbalanced; balancing happens when its
  ending is reached, on a page not yet declared final.
- **Tail reuse needs equal dependencies, not an equal cursor.** Two layouts at the
  same region, y and `spaceSpent` still differ if a float reaches into what is left,
  or if a block was deleted from it (§1.6). Reuse is allowed when all of these are
  equal, and refused when any is unknown:

  | Dependency | Shown equal by |
  |---|---|
  | Remaining source | Same items to the end, by node identity. **Missing today** |
  | Remaining runs | Same boxes and endings |
  | Cursor | Region, y, `spaceSpent` |
  | Page geometry | `samePageMetrics`, as now |
  | Exclusions | Same placements for every float, as now (`pageRectsDigest`) |
  | Preparation | Same node, width and marker, as the measure cache checks |

  It never starts inside a run that balances. A remaining-source check also replaces
  `seenCacheMiss` and `remainingCacheMisses`, which guess at it.
- Fragment caching is not part of this. The measure cache stays keyed by width;
  equal widths need no new key.

## 11. Walk-throughs

**A paragraph across two columns and a page.** Regions A and B on page 1, C on
page 2. `fill(flow, {child 4}, A)` places 10 lines: `partial`, continuation
`{child 4, offset 812}`. The loop commits and offers B from its top: 31 lines,
`partial`, `offset 3290`. C: `complete`. Three parts, one `sourceNodePos`,
`fragmentIndex` 0–2. The indent and marker go on the first part, and no part
is made from another's lines: each is broken from source, at its own region's
width and exclusions.

**Title over 2-up, then full width.** Run 1: one box, ends `sameGroupBelow`.
Closes at the title's bottom plus its space after. Run 2: two boxes, `startsPage`
false, so column 2's first block keeps the part of its space before not spent.
It completes in column 1, so its group is retried from a lower bound of 5.5 lines:
short by half a line, then 6 lines and 5 fit (Word: `L6` at y 192, `L7` at the
column top). Run 3 starts at the larger bottom.

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
Saved: cursor at B's top, `{child 4, offset 812}`, the runs. The partial layout
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
- **Acceptance is the composite's policy, not the engine's.** The engine requires
  only law 7: an accepted unit advances at least one region. A table row asks that
  every unfinished cell progress, or rejects all (measured in Word). Independent
  parallel streams could accept any progress, an atomic card only completion, and
  aligned bilingual text a shared boundary: other policies over the same protocol.
  Phase 7 ships the row's, owned by the Table extension; an undeclared composite
  stays atomic.
- The unit's height is the tallest result plus insets, and every box gets it. If
  accepting changes the capacity (a border, an inset), the attempts are **made
  again**, not trimmed.
- A region that is done repeats its box only, and its source range is empty.
- Vertical merges stay atomic. Repeated header rows, vertical alignment across
  fragments, and a grid that changes width between regions are later work.
- Keep rules are a separate axis from the break mode.

## 13. Phases

Each is one PR with no second authority left alive at its end. Equivalence means
the oracle of §15 is unchanged unless a difference is listed here first.

| Phase | Work | Output changes |
|---|---|---|
| H | The harness (§15), before anything moves. Known defects are recorded as tests expected to fail | None |
| 0 | Fix what the oracle would otherwise freeze, one PR each: a deleted block that stays (§1.6); streamed ≠ whole (§1.5); stale wrapped lines (§1.2); cell spacing (§7); oversized atomic blocks (§14.7). Each flips its expected failure | Yes, these five |
| 1 | `FlowRegion`, cursor and progression, one region per page. Landing is data; `paginateFlow` emits; `FlowPlacement`'s model goes. Cache placement written once; reuse by dependencies | A page top no longer starts with a stray gap (§1.1) |
| 2 | Paragraph continuation and the flow container. Line breaking stops at the offer's height; the solver's provider loses pages | A paragraph with nothing but clearance on a page (§3); a mixed-size line is no longer broken short at a page foot (§1.1) |
| 3 | Exclusions by region, settle by touched region, checkpoints, `FlowPosition` | None: still one region per page |
| 4 | Runs from sections; sequential equal-width columns; closing; navigation, pageless, tail reuse, drag, PDF | Multi-column sections |
| 5 | Balancing | Multi-column sections ending continuous |
| 6 | Flow container inside composite regions, units atomic | None |
| 7 | Splittable units | Tables that split |

6 and 7 need 2, not 3–5. Columns need 1–4, not 6–7, so **neither blocks the
other**. Phases 0–3 change nothing a column setting does today (nothing). 4 and 5
merge separately and are released together (§14.2).

**Between 1 and 2 one predictor is left.** Landing decides alone after Phase 1, but
the solver's line space still skips page bottoms while it breaks a wrapped
paragraph, because breaking cannot stop and resume until Phase 2. It predicts
landing's answer; it can no longer override it. Phase 1 adds a counter of lines
where the two differ, asserted zero over the harness. Merging 1 and 2 avoids the
gap at the price of one PR that is both the largest and the riskiest (§14.13).

A composite fills through the same `fillRegion` at Phase 6; until then today's
three passes lay its regions out. That is the one place a second *algorithm*
lives on between phases. It is not a second authority: it has no page to break.

**Riskiest: Phase 2.** It replaces line breaking's all-at-once loop and is called
from inside the float settle, where a fraction of a pixel decides an oscillation.
Phase 3 is second. Each gets a red-test list agreed before code, and its own review
of the seam: between fill and settle (2), and the checkpoint rule (3).

**DOCX is a separate track.** This work changes what layout produces, never what
import reads. The meeting point is the fidelity layout baselines: a phase that moves
one re-records it in its own PR, and says which documents moved and why. Section
breaks and `<w:cols>` import come after Phase 5, with the `w:type` shift of the
[columns RFC](./columns-rfc.md).

## 14. Decisions

All accepted as recommended, 2026-11-24. The ground first: the harness, the fixes and
Phases 1–2 come before either feature track.

1. **The fill loop alone accepts placement and advances regions**; producers and
   containers decide fit (§4). *Recommend yes.*
2. **Balance before a continuous break**, as Word does, or only close at the
   largest bottom. *Recommend balancing (Phase 5), after sequential columns, with no
   release between the two and no DOCX import of columns before it: no document
   then re-flows when balancing arrives.* Closing at the bottom is kept as its first
   half. Found by stepping, not bisection (§5).
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
8. **Fix stale wrapped lines in Phase 0**, by having the settle re-lay a wrapped
   flow on whatever page it lands, and delete the re-break there. *Recommend yes:
   Phase 1's "emit only" is not possible while emission can change a height.*
   Tried and reverted: two conditions in the solver fix all three effects of §1.2,
   the core suite passes unchanged, and the re-break is never reached in it.
9. **ArrowDown at the foot of a column goes to the next column's top.**
   *Recommend yes.* Word is believed to do this; its scripting has no arrow-key
   command, so it needs one manual check.
10. **Rows split by default**, as in Word. `allowBreakAcrossPages` defaults to
    `false` today and layout never reads it, so stored tables hold a `false`
    nobody chose, and nothing tells it from one somebody did. *Recommend: new
    tables split; what a stored `false` means is decided when Phase 7 starts, with
    the stored documents looked at first.*
11. **Streamed equals whole, fixed in Phase 0** (§1.5), by replaying from the
    frontier (§6) at the start of each slice.
    *Recommend yes: the oracle compares the two, and it is a bug users can see.*
12. **A paragraph whose float leaves it no line moves to the next page with the
    float**, as Word does, instead of stranding the float (§3). *Recommend yes, in
    Phase 2, which makes clearance alone `noFit`.*
13. **Phases 1 and 2 stay separate**, with a guarded predictor between them, or
    merge. Strictly, separate breaks the "no second authority" rule for one phase.
    *Recommend separate: it predicts and cannot override, and the merged PR would be
    too large to review.*
14. **The deleted block that stays (§1.6) is fixed now**, ahead of this work and of
    the next release. *Recommend yes: it needs no contract, only a check that the
    remaining blocks are the same.*

## 15. Verification

**Invariant: four ways, one layout.** Whole, streamed at any cutoff, incremental
after an edit, and replayed give equivalent pages, parts, source ranges,
placements and caret mapping. Checked over the same documents by one harness, so a
new producer is covered by joining it.

The harness is the **first** thing built, so that Phase 0 changes a recorded
behaviour rather than an unrecorded one. Every difference is one of three:

| Class | Treatment |
|---|---|
| Correct today | Preserved by every phase |
| Known defect (§1) | Expected to fail, then flipped by the PR that fixes it |
| Not supported before | New expectation, added by the phase that builds it |

Beside the invariant: each phase against the one before; headers; the DOCX layout and Word-comparison baselines; PDF ops. It asserts
relationships, never wrap counts, and counts work (fill calls, lines broken,
children refilled, balancing attempts), never time. Beyond it:

- Content conservation across regions of differing width and exclusions: empty
  paragraphs, repeated and trailing hard breaks, atoms, anchors, grapheme splits,
  font changes, markers, fields.
- At one width, resumed lines equal one-shot lines, phantom lines included.
- Purity: refuse a fragment, offer again elsewhere, same answer; frozen inputs.
- Every row of §3's overflow table, at a partly used region, an empty one, under a
  full-width exclusion. Every one ends.
- Clearance alone is `noFit`, and the paragraph and its float do not oscillate.
- A float moved up re-wraps earlier content, and moved away gives it back, across
  a streaming cutoff too.
- A rejected unit advances no region, at any nesting depth.
- Balancing equals trying every height, with and without floats and mixed sizes;
  its starting bound never exceeds the answer; a candidate's result does not depend
  on which were tried before it.
- Every page behind the frontier equals the whole document's.
- Reuse refuses when any one dependency differs, one test each, deletion included.
- A discarded pass leaves the measure cache as it found it.
- `engineVocabulary.test.ts` keeps column vocabulary out of `layout/`.
- **Adding a layout changes no engine file.** A test-only extension declares a
  nested splittable composite (a pair of bilingual blocks, each holding a table)
  and splits, resumes, hit-tests and exports.

### What was prototyped

Throwaway tests, not merged: a paragraph producer over `layoutBlock` on the cut
remainder, a flow container, a row policy, a page-scoped float settle, a balancing
search.

| Claim | Result |
|---|---|
| One offset resumes a paragraph | 400 paragraphs, 969 splits: equal lines but for 13 phantom lines, all from re-preparing the remainder |
| Source is conserved as width and exclusions change | 400 of 400 |
| Refuse and offer again gives the same answer | Every offer of both |
| An oversized line ends | 2 parts in at most 3 offers |
| A row of cells uses the same `fillRegion` and rejects together | 100 rows, 2,017 splits, 49 rejections, no line lost |
| Stepping finds the smallest balanced height | 180 of 180 groups; bisection 172 |
| Fit and shortage must share the allowance | Unaware: a smaller height skipped in 2 of 2,000; aware: none |
| Line heights over regions bound the height from below | Only with no float narrowing a line: 88.8px free, 62.4px narrowed |

Measured on `main`, also not merged: 8,551 pages behind a frontier; 9,033 flows'
landing in both authorities; 4,800 edits against a cold layout; 1,200 streamed
layouts against whole ones (348 of 600 with floats differ, none of 600 without).

Not covered: the real settle and its lock, markers, real pages, caret mapping.

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

Updated as each phase lands, with every difference from the design above and why.

| Phase | State |
|---|---|
| 0, a deleted block that stays (§1.6) | In #314. `findReusableTail` compares the remaining items, as §10 asks; `seenCacheMiss` and `remainingCacheMisses` stay until Phase 1, because a changed marker or width is still the counter's to catch. The same PR fixed what else made a reused layout differ: positions moved twice in the measure cache, hard breaks never moved, pageless height, a float's margin, and a node the document holds twice |
| H, the harness (§15) | `src/test/layoutOracle.ts` (documents, page set-ups, the comparison), `layoutOracle.test.ts` (whole, streamed, edited and laid out again; headers; the frontier), `layoutBaseline.test.ts` (fixed-width snapshots), `layoutWork.test.ts` (lines broken, counted), `knownDefects.test.ts` (each defect above as the behaviour it should have, expected to fail). Against `main` before #314 the oracle fails 53 of 473 |
| 0, stale wrapped lines (§1.2, §14.8) | The settle re-lays a wrapped flow wherever it was carried, and pagination's re-break, all three call sites, is deleted. No flow is left wrapped for another place in 600 random float documents (5,158 wrapped flows), and no baseline moved |
| 0, cell spacing (§1.4, §7, §14.3) | As Word, at every depth. One DOCX layout baseline moved: two headings in the cells of fixture 25 now sit under their space before. No Word-comparison score changed |
| 0, oversized blocks (§14.7) | A fresh page, measured in Word for a row that may not split. It also showed a second fault, fixed with it: what followed an overflowing block or line was placed by the overflow's full height, leaving blank pages |
| Everything else | Not started |

The split at a page boundary in `paginateFlow` is the approach this replaces, not a
first phase of it.
