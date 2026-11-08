# Float Beside Table RFC

> Status: **approved 2026-11-08**, both slices implemented, in review. A floating image
> with square or top-and-bottom wrap must not cover a table. The table moves
> below the float as one unit; it is never narrowed. Written 2026-11-08 against
> `main` @ `288119e`. See [What shipped](#what-shipped). Where the code and this
> design disagree, that section says so; this document is not rewritten to
> match.

## Decisions

Approved by the user on 2026-11-08.

1. **A whole table moves below a square or top-bottom float.** The unit is the
   table's run of rows on the float's page. It is never narrowed.
2. **Rows never wrap separately.** Word's per-row mode exists only behind the
   `layoutTableRowsApart` compatibility flag, which we do not model.
3. **Backward anchors.** A table *above* a float's anchor moves only if the
   move holds: the anchor stays on its page **and** the float, re-placed at the
   anchor's new position, clears the table. Otherwise the table clears only
   the floats anchored before it, and the floats it would drag overlap it
   (*approved by the user on 2026-11-08*: the table still honours Decision 1
   for every float that stays put). Every float a move drags is re-placed from its new
   anchor; no float is left off its anchor or its anchor's page. The rule is
   deterministic and converges within the existing settle cap. See
   [Backward anchors](#backward-anchors).

   *Approved by the user on 2026-11-08 over the earlier wording* ("a table
   above the anchor moves like any other table; it stays only if moving it
   would carry the anchor onto the next page"). The earlier wording lets a
   free float chase the table down the page until the settle cap, leaving a
   placement off its anchor; the stricter rule decides the chase's end state
   in one step.
4. **Re-anchoring on drop is out of scope.** Dragging a float keeps its anchor
   and changes `yOffset`, which matches Word with a locked anchor.
5. **Stacking moves the image, not its paragraph** (*approved by the user on
   2026-11-08*). A square float that would overlap one placed before it on
   the page moves below it; its anchor paragraph stays where the text puts it,
   as in Word. The offset belongs to the float.
6. **A float with no fixed point is locked** (*rule proposed 2026-11-08; the
   trade it makes is a decision for the user* — see
   [Floats with no fixed point](#floats-with-no-fixed-point)).

## Problem

Place a right-aligned, square-wrapped image in the paragraph just above a table.
The paragraph wraps around the image correctly, but the table ignores it: every
row keeps its full width and its natural y, and the image paints over the cell
text. Top-and-bottom wrap has the same defect. The bug is visible in the #228
track-changes playground (section 4, "Images and tables").

### Root cause

Anchored objects are resolved in `resolveAnchoredObjects`
(`packages/core/src/layout/PageLayout.ts:629`). Each square or top-bottom float
adds a rect to its page's `ExclusionManager` and then calls
`reflowFlowsAgainstExclusions` (`PageLayout.ts:905`) to re-lay every flow that
its zone overlaps. That function skips table rows outright:

```ts
// PageLayout.ts:928-931
// Skip atomic flows (image/HR/pageBreak/tableRow) — exclusion reflow only
// narrows text flow lines; atomic blocks can never be re-broken around a
// wrap zone.
if (flow.kind === "leaf" || flow.kind === "tableRow" || flowY + flow.height <= zoneTop) continue;
```

The comment is right that a row cannot be re-broken, but it draws the wrong
conclusion. Re-breaking is not the only way to respect a wrap zone; *moving*
the block is the other one, and the function never tries it. Nothing else in
the pipeline looks at rows against exclusions, so the row's `globalY` from
`assignGlobalY` is final. Paint (`renderer/TableRowStrategy.ts:46`), cell hit
testing (`layout/cellHitTest.ts:28`) and PDF (`table/pdfExport.ts:37`) all
read `block.y + cell.y`, so all three draw the table where the float is.

## Word's behaviour

Word is the reference for layout behaviour. The spec is unambiguous about
the default, and it answers the open question below.

**ECMA-376 Part 4, §14.8.3.24 `layoutTableRowsApart`** ("Allow Table Rows to
Wrap Inline Objects Independently"):

> Typically, when a table wraps around a floating object, the table shall wrap
> the object as a unit (i.e. the whole table square wraps the object). This
> element, when present … specifies that wrapping is applied to each row in the
> table one by one, even if its means that each row has a different resulting
> position with respect to the table.

Per-row wrapping is a legacy *compatibility* switch. The default, which every
document Word writes today gets, treats the table as one box.

**ECMA-376 Part 4, §14.8.3.23 `layoutRawTableWidth`** ("Ignore Space Before
Table When Deciding If Table Should Wrap Floating Object"):

> Typically, when a table is positioned next to a floating object, the table
> shall only remain next to the object if it can fit in the remaining space on
> the line when considering the full width needed for the table: the space
> before the table, plus the width of the table.

and its example: when the object is moved so that it would clip the table, "the
default presentation would have the **entire table moved below the shape**,
since it does not fit in the remaining space on the line."

So Word has exactly two outcomes for a non-floating table beside a float:
it stays beside the float unchanged (it fits in the remaining space), or the
whole table moves below the float. Word never narrows the table to fit.

**ECMA-376 Part 1, §20.4.2.3 `anchor`, attribute `layoutInCell`**: when it is
`false`, "the table shall be resized and/or relocated within the document as
needed to accommodate the object". Relocation is the table's response to a
float, consistent with the above. §20.4.2.17 `wrapSquare` and §20.4.2.20
`wrapTopAndBottom` define the two modes that carve space; `behindDoc` floats
(our `behind`/`front`) carve none.

**LibreOffice's Word-compatible layout.** `SwTabFrame::CalcFlyOffsets` in
`sw/source/core/layout/tabfrm.cxx`
(<https://docs.libreoffice.org/sw/html/tabfrm_8cxx_source.html>) is the code
Writer runs to imitate Word here. It computes the table's *upper space*: a
qualifying fly raises the table's print position to the fly's bottom, so the
**whole table** shifts down, not a row. Under the Word-compat setting
`ADD_VERTICAL_FLY_OFFSETS`, a fly that would otherwise wrap in parallel is
switched to shift-down when the table's range overlaps it. The same function
skips flys anchored inside the table itself, skips flys whose anchor is on a
*following* page (the anchor's page decides, not the page the fly is still
registered on), and notes that it does not require the anchor to precede the
table because "fly frames can be negative positioned". All three match the
design below.

**Anchors keep their page.** A Word float is positioned relative to its
anchor paragraph and stays on that paragraph's page; when the paragraph moves to
another page, the float goes with it. Our solver already clamps a float onto its
anchor's page (`placeAt`, inside `resolveAnchoredObjects`).

**`allowOverlap` is not a wrap switch.** The `wp:anchor` attribute
(§20.4.2.3) governs whether this *object* may overlap other floating
objects. It does not turn off text or table wrap around the object.

**LibreOffice bugs (unverified).** tdf#117134 reportedly records the interop
symptom from the other side: on a DOCX where Word pushes the table below a
frame, Writer left it in place and the two overlapped. I could not open the
Bugzilla pages for tdf#117134 or tdf#116270 (the tracker returned 503 / a bot
wall), so both remain **unverified**; the summary comes from search excerpts.
The spec passages and `tabfrm.cxx` are the evidence this design rests on.

### What this means for Scrivr

Our tables always fill the content width: `TableLayoutEngine` scales the grid
to `availableWidth` (`layout/TableLayoutEngine.ts:92`), and there is no
`tblInd` yet. A table that fills the content width can never fit in "the
remaining space on the line" beside a float that intrudes on the content area.
Under Word's rule that leaves one outcome: **the table moves below the float**.
That is the approved decision, and it is Word's rule, not a simplification of
it. When `tblInd` or narrower tables land, the "stays beside if it fits"
branch becomes reachable; see [Known gaps](#known-gaps).

## Design

### The rule

> A table's run of rows on one page (its *fragment* on that page) is one box.
> If that box's vertical band intersects a square or top-bottom exclusion on
> the page, and the exclusion takes any of the content width in that band, the
> fragment's first row moves down to the first y where the whole fragment
> clears every exclusion on the page. The rows after it follow by restamp.

Consequences, each of which falls out of the rule rather than being special
cased:

- Rows on *other* pages never move. A table split across pages with a float on
  page 2 moves only its page-2 fragment.
- A float whose rect lies wholly in the page margin takes no content width, so
  the table stays.
- `behind` and `front` add no rect (`PageLayout.ts:796` `continue`s before the
  zone loop), so they never move a table.
- A float that ends above the table, or starts below it, does not intersect the
  band.

### At the seam

All of the change is in `reflowFlowsAgainstExclusions`. The `tableRow` arm of
the skip at `PageLayout.ts:931` becomes a branch:

1. **Is this row blocked?** Ask the page's manager the question it already
   answers: `exclusions.getAvailableSegments(page, rowY, row.height, contentX,
   contentWidth)`. If the result is anything other than the single full-width
   segment, a float takes part of the band, and a full-width table cannot sit
   there. Top-bottom rects return no segments at all, so the same test covers
   both modes. This reuses the existing query; nothing new.
2. **Find the fragment.** Walk back from the row while the previous flow is a
   `tableRow` that is *not* `isLastRow` and is on the same page. `isLastRow`
   already marks table boundaries (`PageLayout.ts:308`), so two adjacent tables
   stay two units without a new table-identity field.
3. **Find the clear y.** The first y at or below the fragment's top where a
   band from there to the table's end is free across the whole content width.
   Rects belong to one page, so the part of the band past the page bottom is
   free by construction and no clipping is needed. This is the one extension
   to an existing concept; see below.
4. **Move it.** Set the fragment's first row to
   `advanceFlowGlobalY(row, clearY, …).startGlobalY` (`PageLayout.ts:391`) so
   the existing atomic page-fit rule applies (a row that no longer fits on the
   page moves to the next page top). Stamp `solverPushedThisFlow: true`
   (`PageLayout.ts:335`), the same flag anchor-push and float stacking use, so
   `paginateFlow` honours the pushed y instead of the natural one
   (`PageLayout.ts:1537`) and early termination never treats it as a stable
   trigger (`PageLayout.ts:1790`). Then `restampGlobalYFrom(flows, start + 1,
   …)` (`PageLayout.ts:502`) carries every following row and block down.
5. **Continue the scan after the table, to the page bottom.** The moved rows
   cleared every rect on the page as one band, so they need no re-test; the
   scan resumes after the table's last row on this page. It no longer stops at
   the current zone's bottom: growing a block or moving a table restamps every
   flow after it, so the scan runs to the page bottom and re-lays (or moves)
   any flow that touches *any* exclusion on the page, or was wrapped on this
   page before. A text flow restamps what follows only when its own end moved,
   because a restamp re-derives later flows from their predecessors and drops
   any push they carry.

The row does **not** get `overlapsWrapZone`. That flag tells
`normalizeWrappedBlockForPage` (`PageLayout.ts:2101`) to re-break the block's
lines when it lands on a page other than the zone's page, and a row's `lines`
are `[]` (`layout/BlockLayout.ts:377`), so re-breaking would set its height to
0. A push to the next page is exactly when that would happen.

### Backward anchors

A float anchored *after* a table can reach back over it with a negative
`yOffset`, for example after the user drags it up (the drag keeps the anchor
and changes `yOffset`). Moving the table then moves the anchor, and the float
follows the anchor. Taken step by step that is a chase:

- If the float follows its anchor freely, the table and float move by the
  same distance, so the overlap is never resolved. It ends only when the anchor
  would cross onto the next page, at which point the rule says the table stays.
- If the float is pinned (clamped to its page's top or bottom), one move clears
  it and the next settle pass finds nothing to do.

Running the chase inside the settle loop would not converge within
`MAX_ANCHOR_SETTLE_PASSES` and would leave a placement that disagrees with its
anchor. So the reflow evaluates the rule's end state in one step instead. It
tentatively moves the table, restamps, and keeps the move only if, for every
float already placed whose anchor follows the table and whose zone reaches
back over it:

1. the anchor stays on its page, and
2. the float, re-placed at the anchor's new y, no longer intersects the moved
   table.

Otherwise the tentative flows are discarded: the table stays and the floats
overlap it. A float whose zone does not reach the table is simply dragged.

A kept move shifts the anchors of every float after the table, not only the
one being resolved. The settle loop therefore re-places **every** placed float
whose anchor moved, carves its zone again, and reflows the union of the band
it left and the new one, until no anchor moves or the cap is reached.

The reflow gets the list of placed floats (`PlacedFloat`: anchor flow index,
whether it wraps, its placement, and how to place it again and compute its
zone). That record is new; it is the per-float state the settle loop already
held in local variables, lifted so that a move can ask any float where it
would land.

### Floats with no fixed point

**The case.** A float whose own wrap moves its own anchor. Typically a
negative `yOffset` pulls it over the paragraph above its anchor: that
paragraph wraps around it and grows, the anchor moves down, the float moves
down with it, the paragraph wraps differently, and so on.

**It has no layout where all three agree.** Take a top-bottom float of height
`h` placed at `anchor + yOffset` with `yOffset < 0`, over the last line of the
paragraph above (seed 51 in the fuzz, scenario 39). For the line to clear the
float it must skip to the float's bottom, `anchor + yOffset + h + margin`. The
anchor then starts after that line, so `anchor ≥ anchor + yOffset + h + margin
+ line`, which needs `-yOffset ≥ h + margin + line`, false whenever the float
reaches the line at all. So either the float leaves `anchor + yOffset` ("float
off its anchor") or the line runs under the image ("text under a float").
No rule can make both zero for these documents; the rule decides which one
gives.

**What Word does.**

- ECMA-376 says only that `positionV relativeFrom="paragraph"` positions the
  object "relative to the paragraph which contains the drawing anchor" (Part 1
  §20.4.3.5) and defines no layout algorithm or tie-break. Text wraps around
  an object wherever it is, with no reference to its anchor (§20.4.2.17,
  §20.4.2.20).
- LibreOffice imitates Word with the compatibility option *Consider wrapping
  style when positioning objects* (`CONSIDER_WRAP_ON_OBJECT_POSITION`, on for
  Word documents). Its help text: "in current versions a straightforward
  process is used, which is similar to the same process in Microsoft Word",
  as opposed to the older iterative one. In `anchoredobject.cxx` this mode is
  what enables `PositionLocked()`: an object, once positioned, is locked. In
  `flycnt.cxx` (`SwFlyAtContentFrame::MakeAll`) the anchor is not re-formatted
  for an object in this mode, and when `SwOszControl` detects the position
  oscillating ("position already occurred -> oscillation") the object is
  switched to this mode (`SetTmpConsiderWrapInfluence(true)`) and the layout
  restarted.

So Word's answer is: position once from the anchor, lock, and let the text
wrap around the locked object, even if that moves the anchor.

**The rule.** A float follows its anchor while settling converges. A wrapping
float whose own wrap is still moving its anchor after
`MAX_ANCHOR_SETTLE_PASSES` re-placements in one settle is **locked** where it
stands: it keeps its placement and its wrap rect, and text wraps around it
there. A locked float still follows its anchor onto another page (a float
never paints on a page other than its anchor's). Settling converges by
construction: every float is either re-placed at most a fixed number of times
or locked, and a locked float's rect no longer moves.

**The trade (decision for the user).** Locking keeps text clear of the image
and leaves the float above where `anchor + yOffset` now is, by the amount its
own wrap grew the text above (usually one line; scenario 30 bounds it by the
paragraph above). The alternative, ending with every placement on its anchor,
leaves text under the image instead. The fuzz below shows the swap: text
under a float 44 → 8, float off its anchor 1 → 45. **Recommendation: lock**
— it is what Word (as LibreOffice emulates it) does, and overlapping text is
the worse failure for a reader.

### The one extension: `ExclusionManager.getNextFreeY` (changed in place)

`getNextFreeY(page, absoluteY)` (`layout/ExclusionManager.ts:132`) already
answers "the first y past the exclusions here", chaining through stacked rects.
It answers it for text: only `side: "full"` rects count, and only at a point.
It has no production caller today (only `ExclusionManager.test.ts`).

A table needs the same question with two differences: the query is a *band*
(the fragment's height), and *any* rect that intrudes on the content width
blocks it, because a full-width table cannot share a band with a side rect.
The proposal changes the method in place rather than adding a parallel one:

```ts
getNextFreeY(page, absoluteY, height, contentX, contentWidth): number
```

returning the smallest `y >= absoluteY` where `getAvailableSegments(page, y,
height, contentX, contentWidth)` is the single full segment, found by jumping
to the bottom of each intersecting rect. Its existing tests in `ExclusionManager.test.ts` move to
the new signature.

**Why the existing shapes are not enough.** The obvious shortcut is to push to
`zone.zoneBottom`, as the text fallback at `PageLayout.ts:958-959` does. It is
wrong in two cases this RFC has to handle:

- **The settle loop.** On a settle pass the zone passed in is the *union* of
  the new rect and the vacated one (`PageLayout.ts:869-870`). If the float
  moved up, `zoneBottom` is the old, lower bottom, and the table would be
  pushed past empty space.
- **Several floats on one page.** The manager holds every rect on the page; the
  zone holds one. A table pushed to one float's bottom can land inside another
  float's rect.

Both are answered by asking the manager for the real rect bottoms, which is
what `getNextFreeY` is for.

### What follows for free

Paint, cell hit-testing and PDF read `block.y + cell.y` (cited above), so a
moved row is painted, hit and exported where it now is. The CharacterMap for
cell glyphs is populated from the painted blocks. Slice B proves each of these
with a scenario rather than assuming it.

## Alternatives considered

### Narrow the table to the free width (rejected)

Re-run `layoutTableRow` at the segment width beside the float, the way text
lines narrow.

- **Not Word.** §14.8.3.23 gives two outcomes, beside-if-it-fits or moved
  below. Shrinking a table to fit is not one of them, and a DOCX round trip
  would show a table that is narrower on our screen than in Word.
- **Per-row narrowing is the `layoutTableRowsApart` look**, which the spec
  describes as the "stuttered" legacy mode: rows beside the float narrow, rows
  below it are wide, and column lines no longer align down the table.
- **It breaks the grid.** Column widths come from the table's `grid`, scaled
  once (`TableLayoutEngine.ts:92`). Narrowing some rows means cell boundaries,
  cell selection rectangles and column-resize handles disagree from row to row.
- Narrow cells re-wrap their text and grow taller, which moves the float's
  anchor when the anchor is after the table, feeding the settle loop a height
  change on every pass.

### A table-owned approach (rejected)

Let the Table extension, `TableLayoutEngine` or a `BlockStrategy` know about
floats: pass the exclusions into row layout and have the table position itself.

- **Wrong owner.** Rows are measured in `buildBlockFlow`, before any float is
  placed. Floats are placed in `resolveAnchoredObjects` from the flows' y, and
  they move flows. Making the table consume exclusions puts float state into a
  stage that runs before floats exist, or a second table pass after them; both
  are a parallel path to the one that already moves text.
- **Duplicates the settle loop.** A float whose zone moves its own anchor is
  settled in one place (`PageLayout.ts:814-888`). A table that moves itself would
  need its own convergence with the float, and two loops that each move the
  other's input do not have a fixed point you can reason about.
- **Wrong seam for every other block kind.** The rule "a block that cannot wrap
  moves below the float" is a property of the float pipeline, not of tables.
  If images or HRs ever need it (see Known gaps), it is the same branch at the
  same seam.

## Resolved: overlapping row or whole table?

**Question.** When a float's band cuts through the middle of a table, does Word
push only the rows that overlap, or the whole table?

**Answer: the whole table (its fragment on that page).** Decided by the user on
2026-11-08 (Decisions 1 and 2).

**Evidence.** §14.8.3.24 states the default directly: "the table shall wrap the
object as a unit (i.e. the whole table square wraps the object)"; per-row
wrapping exists only behind the `layoutTableRowsApart` compat flag. The
§14.8.3.23 example says "the entire table moved below the shape".
LibreOffice's `SwTabFrame::CalcFlyOffsets` shifts the whole table through its
upper space. None of the 25 Word documents in
`packages/docx/src/wordTestFiles/` sets `layoutTableRowsApart`, and none places
a square float beside a body table, so they neither contradict nor demonstrate
it.

**Where the two answers differ.** Only when the float's *top* is below the
table's top, so some rows sit wholly above the float:

| Float position | Per-row | Whole table (Word default) |
|---|---|---|
| Float top above the table, bottom mid-table | rows 1…k move below; the rest follow by restamp | identical |
| Float top mid-table (rows above it) | rows above the float keep their y, a gap, the rest below | the whole fragment moves below the float |

**A constructed `.docx` to confirm it.** One section, a 6-row full-width table
(`w:tblW w:type="pct" w:w="5000"`), and a paragraph before it holding
`<wp:anchor layoutInCell="0" …><wp:positionV relativeFrom="paragraph">
<wp:posOffset>` set to about two row heights, `<wp:wrapSquare
wrapText="bothSides"/>`, and a picture narrower than the content width.
Expected in Word with no compat flags: the whole table starts below the
picture. With `<w:compat><w:layoutTableRowsApart/></w:compat>` in
`settings.xml`: rows 1–2 stay above it.

## Scenario matrix

Relations only, never pixel values: CI fonts are not macOS fonts, so a row's
height differs by machine. Every expectation compares measured values from the
same layout. `F` is the float's placement, `T` the table's rows on the page, in
page-local coordinates. "Full width" means `row.x === contentX && row.width ===
contentWidth`.

| # | Scenario | Expected |
|---|---|---|
| 1 | Right-aligned square float in the paragraph above a table | `T[0].y >= F.y + F.height`; every row full width; rows contiguous (`T[i+1].y === T[i].y + T[i].height`) |
| 2 | Same, left-aligned | Same as 1 |
| 3 | Top-bottom float above a table | Same as 1 |
| 4 | `behind` and `front` floats over a table | Every row's y equals its y in the same document without the float |
| 5 | Float that ends before the table starts | Row y unchanged against the no-float document |
| 6 | Float wholly in the page margin (rect outside the content area) | Row y unchanged against the no-float document |
| 7 | Float whose top is below the table's top (rows above it) | Whole fragment moves: `T[0].y >= F.y + F.height`; document order of rows holds |
| 8 | Float near the page bottom; the table cannot fit below it | `T[0]` is on the next page at that page's content top; no row on the float's page overlaps `F` |
| 9 | Table split across pages; float on page 2 only | Page-1 rows unchanged against the no-float document; page-2 fragment starts at or below `F`'s bottom |
| 10 | Two square floats on one page, the second below the first, table under both | `T[0].y >=` the lower float's bottom; no row overlaps either float |
| 11 | Two adjacent tables, float beside the second only | First table unchanged; second table moves (the `isLastRow` boundary holds) |
| 12 | Float anchored *after* the table with a negative `yOffset` reaching back over it, free to follow its anchor | Settles: `placement.anchorGlobalY` equals the anchor flow's final `globalY`; the table stays at its no-float y and the float overlaps it ([Backward anchors](#backward-anchors)) |
| 12b | Same, but the float is pinned to the page top by the clamp | The table moves below the float; the anchor stays on the float's page; placement agrees with the anchor |
| 13 | Click inside a cell of a moved row | `cellAtCoords` at the moved row's cell centre returns that cell's position; a click where the row used to be does not |
| 14 | PDF export of scenario 1 | The table-row rects the PDF handler receives equal the layout's `block.y + cell.y` |
| 15 | Square float anchored inside a table cell | Pinned as a known gap: asserts today's behaviour so a change is noticed |
| 16 | Pageless mode, scenario 1 | Same relation as 1 (no page split, `advanceFlowGlobalY`'s pageless arm) |
| 17 | Pagination feedback: add content above the anchor paragraph until it crosses onto the next page | The float is on the anchor's page; the table is below the float on that page; a second layout of the same document gives identical blocks and placements |
| 18 | Page-break guard: table row taller than a page under a float | Layout terminates; the row is placed once |
| 19 | Tail cache: edit that moves the float off the table, laid out with the previous layout | The table returns to its no-float y, equal to a fresh layout of the edited document |
| 20 | A later float grows the text above a table that an earlier float moved | No row overlaps either float |
| 21 | A later float's push restamps a second table into an earlier float's band | No row of either table overlaps either float |
| 22 | Same, with a paragraph instead of the second table | Every line beside the earlier float ends left of it |
| 23 | A float between the table and a pinned float's anchor | It stays on its paragraph after the table moves |
| 24 | A pinned float after a free float that reaches back over the table | Both floats stay on their anchors; the table stays at its no-float y |
| 25 | A move would carry a pinned float's anchor onto the next page | The table stays; anchor and float stay on page 1 |
| 26 | A table split across pages under a float | Only its rows on the float's page move; page 2 starts at the content top |
| 27 | A later float re-wraps text without changing its height | A stacked float stays below the float it stacked on; its paragraph keeps its natural y |
| 28 | Two square floats in one paragraph | They do not overlap; the first stays on its anchor |
| 29 | A block above a stacked float really grows | The stacked float stays clear of the one it stacked on |
| 30 | Six paragraphs, each with a float that has no fixed point (`yOffset -40`) | No text under a float; each float on its anchor's page, at most one displaced paragraph above `anchor + yOffset`; two layouts agree |
| 31 | Scaling: 60 vs 240 such paragraphs | Time grows less than 10x (linear is 4x, quadratic 16x) |
| 32 | A restamp inside one reflow leaves another float's rect stale | The table stays at its natural y; no hole |
| 33 | A float re-placed onto another page (seed 154) | No wrap left behind; every float on its anchor's page |
| 34 | An anchor whose first line lands on the next page (seed 390) | Every float on its anchor's page |
| 35 | Pageless with a page height | The table is not moved; nothing after it is laid out as if it had |
| 36 | Streaming: float and table in different chunks | Pinned gap: the table stays at its natural y |
| 37 | A float that does not reach back is carried onto the next page | Guard: the table still clears the reaching-back float |
| 38 | A move would carry the table under a float that does not follow it | Guard: no row overlaps that float |
| 39 | A reach-back float over the paragraph above (seed 51) | No text under a float; floats on their anchors' pages; two layouts agree |
| 40 | Reach-back floats chasing each other (seed 21) | Same as 39 |
| 41 | A float whose own zone covers the paragraph it would push | Same as 39 |

## Slices

**Slice A: the seam.** Scenarios 1–11, 16, 18 and 19 written first and
failing, then the `tableRow` branch in `reflowFlowsAgainstExclusions` and the
in-place `getNextFreeY` change with its tests updated. Run the core suite after
each change and report which scenarios flipped.

**Slice B: settle and consumers.** Scenarios 12, 12b, 13–15 and 17: the
backward-anchor check, cell hit-test, PDF parity, the in-cell gap pin and
pagination feedback. A and B land in one PR; the split is review order.

No public API changes. No changeset beyond a `patch` for `@scrivr/core`.

## Risks

### The settle loop

`resolveAnchoredObjects` re-places a float until its anchor stops moving, capped
at `MAX_ANCHOR_SETTLE_PASSES` (`PageLayout.ts:627`, loop at `:814`, exit at
`:880`). A table that moves the float's own anchor would chase the float past
the cap; [Backward anchors](#backward-anchors) replaces the chase with a
one-step check so the loop needs at most one extra pass. Scenarios 12 and 12b
assert the placement agrees with its anchor after settling.

### Header rows

`repeatHeader` exists on the row schema (`extensions/built-in/Table.ts:158`)
and round-trips through DOCX, but layout does not repeat header rows on later
pages today. So a page-2 fragment starts with an ordinary row, and the rule
moves it like any other. When header repetition lands, the repeated header is
the first row of its page's fragment and must move with it; scenario 9 is the
test that will catch a header painted at the old y.

### Page-break guards

Rows are atomic. `advanceFlowGlobalY` moves an atomic block that overflows to
the next page top unless it is first on its page or taller than a page
(`PageLayout.ts:409-422`), and `paginateFlow` keeps the same guard
(`PageLayout.ts:1587-1591`). The design routes the pushed y through
`advanceFlowGlobalY`, so a row too tall for any page is not pushed into an
infinite next-page loop. `paginateFlow` advances pages while `flow.globalY` is
past the page bottom (`PageLayout.ts:1514`), so a fragment pushed to exactly
the page's content bottom lands at the next page's top. Scenario 8 covers it.

### The `pageRectsDigest` cache

Pagination may copy the previous layout's tail when the float placements are
unchanged (`pageRectsDigest`, `PageLayout.ts:594`, compared at `:1267`). Table
pushes are a pure function of the flows and the placements, so equal digests
still mean equal pushes and the reuse stays sound. Two further guards keep it
so: pushed rows carry `solverPushedThisFlow`, which disqualifies them as an
early-termination trigger (`PageLayout.ts:1790`), and rows bypass the measure
cache entirely (`PageLayout.ts:2277`), so they are never cache hits and never
trigger a tail copy. The risk to test is an edit that moves a float *off* a
table: the digest changes, the tail is not reused, and the table must return to
its natural y. Add that as a second half of scenario 1.

### Restamp from a later float

`restampGlobalYFrom` recomputes `globalY` from each predecessor and does not
know a flow was pushed. If a later float on the same page reflows text above
the table so that it *shrinks*, the restamp can pull the table back up into the
earlier float's band. This happened (review, 2026-11-08): scenario 10 did not
build the case. The fix is step 5 as now written — the scan runs to the page
bottom against the page's whole manager — and scenarios 20–22 and 27 cover it.

## Known gaps

- **A float anchored in a table cell.** A row flow has `lines: []`
  (`BlockLayout.ts:377`); its cells' lines live in `cells`, which
  `getAnchoredObjectAnchors` (`PageLayout.ts:530`) never reads. So an anchored
  image inside a cell is not resolved as a float at all. Word's
  `layoutInCell` (§20.4.2.3) has two behaviours (positioned in the cell, or the
  table relocates around it); both are out of scope. Scenario 15 pins today's
  behaviour.
- **Floating tables (`w:tblpPr`, Part 1 §17.4.57).** A positioned table is
  itself a float that text wraps around, with `tblOverlap` (§17.4.56) governing
  whether other tables may overlap it. We import it as an ordinary in-flow
  table. Six of the 25 Word test documents use `tblpPr`, so this is a real
  fidelity gap, but it is a different feature: the table becomes an exclusion
  source, not a block that avoids one.
- **`layoutRawTableWidth` and "beside if it fits".** With `tblInd` or a table
  narrower than the content width, Word keeps the table beside the float when
  it fits (§14.8.3.23), and this compat flag drops the indent from that fit
  test. Our tables always fill the content width, so the branch is unreachable
  today. When narrower tables land, step 1's test becomes "the table's own x
  range intersects a rect" instead of "any content width is taken", which is
  the same seam.
- **Pageless.** Floats carve no wrap zone in pageless mode. The cause predates
  this work: a pageless page's `contentBottom` is `pageHeight` (0), so its
  content height is negative (`layout/PageMetrics.ts:255-260`) and every zone
  band clamps to nothing. Text does not wrap around floats there either. A
  separate todo; pinned by scenario 16.
- **`layoutTableRowsApart`** (§14.8.3.24). Per-row wrapping is not modelled;
  the compat flag is ignored on import (Decision 2).
- **`allowOverlap`** (§20.4.2.3). Object-to-object overlap is not modelled;
  square floats stack as they do today. It never affected wrap, so it does not
  change this design.
- **Streaming.** Each streamed chunk starts with no floats and no
  exclusions, so a float in one chunk does not move a table (or wrap text) in
  the next. Text has the same gap on `main`; the editor's synchronous first
  100 blocks make it reachable. Carrying floats across chunks means carrying
  the solver's state in `LayoutResumption`, which is not a small change at
  this seam. Pinned by scenario 36.
- **Re-anchor on drop.** Dragging a float keeps its anchor and changes
  `yOffset` (Decision 4). Moving the anchor to the paragraph under the drop
  point is an existing todo.
- **Images and horizontal rules.** `leaf` flows are skipped by the same line
  for the same reason. An inline-only image beside a float overlapping it is a
  separate bug with the same fix; it is not in this RFC's scope.

## What shipped

Updated as each phase lands. Where this disagrees with the design above, this
section is what is true.

| Slice | Landed | What it changed |
|---|---|---|
| A | `feat/float-beside-table` (`8912e48`, `b5ee210`) | `getNextFreeY(page, y, height, contentX, contentWidth)` changed in place; the `tableRow` skip in `reflowFlowsAgainstExclusions` became `moveTableClearOfExclusions`. Scenarios 1, 2, 3b, 7, 8, 9, 10, 11, 12b, 13, 14, 17 and 19 (float added on incremental layout) flipped red → green against `main`. Scenario 12 went from green (on `main` no table ever moved) to red. |
| B | `feat/float-beside-table` (`6ea4cbd`) | The backward-anchor check decides the chase's end state in one step; the zone band became `zoneOf(placement)` so the reflow can ask where a re-placed float would sit. Turned scenario 12 back to green. |
| Review | `feat/float-beside-table` (`b0d1a21`) | The reflow scans to the page bottom against the whole page's manager and restamps only when a block's end moved; the settle loop re-places every float whose anchor moved; the backward check covers every placed float that reaches back over the table; the table's run stops at the page in both directions. Scenarios 20, 21, 22, 23, 24 and 27 flipped red → green against the Slice B code. |
| Review 2 | `feat/float-beside-table` (`545c1654`) | Each float owns its placement: one `place()` derives landing, anchor push, stacking and clamp from its anchor flow's natural start, and the stacking offset is the float's, not the flow's. Every restamp re-applies anchor pushes through the floats and stops at the first unmoved flow. The settle loop reflows only the pages a pass changed (old and new band, on either page) and re-places only floats whose anchor moved or that stack on a moved float; its last pass ends by placing. Tables are placed from their natural start against current float placements. Pageless never moves a table. Scenarios 28–35 flipped red → green against the Review code; 36–38 are pins and guards. |
| No fixed point | `feat/float-beside-table` (`049fa23d`) | A float re-placed `MAX_ANCHOR_SETTLE_PASSES` times in one settle is locked where it stands (Decision 6). Scenarios 39–41 flipped red → green; 30 now asserts the lock's bound instead of anchor agreement. |

Where this differs from the design above:

- **Step 1 uses `getNextFreeY`, not `getAvailableSegments`.** One call both
  answers "is the table blocked" (the result differs from its top) and gives
  the clear y, against every rect on the page.
- **Step 5 was rewritten after review.** As first shipped, the scan resumed
  after the table without re-testing what the move restamped, and stopped at
  the current float's zone; a restamped table, paragraph or stacked float could
  land under an earlier float (scenarios 20–22, 27). Step 5 above is what ships.
- **Decision 3 was tightened and approved** (see Decisions): the rule checks
  every dragged float that reaches back over the table, not only the float
  being resolved. In scenario 24 a pinned float would have moved the table and
  dragged a free float off its anchor; the move is refused instead and both
  floats overlap the table.
- **Pageless is a known gap, not a scenario that passes.** See Known gaps.
  Scenario 16 pins today's behaviour (the table stays put) so that fixing
  pageless wrap flips it.
- **Scenario 3 was already green.** A top-bottom float anchored in the
  paragraph above a table pushes that paragraph's own line below the float, so
  the table followed. Scenario 3b, a top-bottom float pulled down over the
  table's rows, is the one that was red.
- **Guards that were never red on `main`:** scenarios 4, 5, 6, 15, 16 and 18;
  scenario 19 "moved off" and "same document"; scenario 26 (a split table moves
  only its rows on the float's page — the band past the page bottom meets no
  rect, so stopping the walk at the page changes no output); scenario 25 (the
  page-crossing clause — red only with that clause deleted, which is how it was
  checked); and the `ExclusionManager` test "ignores a rect outside the content
  width and on other pages".
- **Scenario 27 was red before this work too.** Re-laying a paragraph always
  restamped what followed, which dropped a stacked float's push; restamping
  only when the block's end moves fixes it.
- **Hit-testing is asserted through `cellAtCoords`.** The CharacterMap path
  for cell glyphs (via `posAtCoords`) reads the same `block.y` but is not driven
  end to end by these scenarios.
- **The scenarios live in `layout/FloatBesideTable.test.ts`**, not
  `PageLayout.test.ts`, so this change does not collide with the list work in
  the same area.
- **`ExclusionManager.getNextFreeY` is public.** Its signature and behaviour
  change is named in the changeset.
- **Review 2: stacking no longer moves the paragraph.** On `main` a stacked
  square float pushed its anchor paragraph down by the stacking offset. Now
  the float moves and the text stays (Word moves the object, not the
  paragraph). A stacked float's `y` is therefore below `anchor.y + yOffset`
  by design.
- **Review 2: a refused move still clears the floats that stay put.** When
  the floats a move drags would not hold, the table no longer falls back to
  its natural y under a float anchored *before* it; it clears the floats
  anchored before it and lets the dragged ones overlap. This applies Decision 1
  and Decision 3 together; approved by the user on 2026-11-08 (Decision 3).
- **Review 2: a fully blocked text line skips to `getNextFreeY` across every
  rect on the page**, not to the current float's zone bottom, so it can no
  longer land inside another float's rect or above its own line.
- **Review 2: one new field, `FlowBlock.wrapLaidAtY`** (the y a flow's lines
  were last laid out at against its page's exclusions). It is what makes
  re-lays proportional: a wrapped flow is re-laid only when it moved or a
  band changed around it.
- **Review 2 fuzz** (400 generated documents, the reviewers' generator;
  stacked-float offsets counted separately as by design). Documents with an
  error: `main` 333, round 1 221, round 2 HEAD 145, now 130. By category
  (documents): row under a float anchored before it 208 / 49 / 1 / 1; row
  under a float anchored after it (Decision 3 overlap) 129 / 82 / 73 / 74;
  float off anchor 92 / 115 / 43 / 1; float on another page than its anchor
  0 / 2 / 4 / 0; square floats overlapping 41 / 40 / 36 / 28; text under a
  float 63 / 83 / 14 / 44. In an instrumented run, 41 of 43 text-under documents hit the settle
  cap (no fixed point): the cap now ends with placements on their anchors,
  where round 2 ended with text consistent but floats off their anchors.
- **Review 2 scaling:** every paragraph with a `yOffset -40` float, N=160:
  `main` 20 ms, round 2 HEAD 7.7 s, now 18 ms; N=1000: `main` 293 ms, now
  111 ms.
- **No fixed point (Decision 6) fuzz.** Same 400 documents; columns are
  `main` / round 1 / round 2 HEAD / last run / now. Documents with an error
  333 / 221 / 145 / 130 / 130. Text under a float 63 / 83 / 14 / 44 / 8.
  Float off its anchor 92 / 115 / 43 / 1 / 45 (the locked floats). Row under a
  float anchored before the table 208 / 49 / 1 / 1 / 2. Row under a float
  anchored after it (Decision 3 overlap) 129 / 82 / 73 / 74 / 72. Float on
  another page than its anchor 0 / 2 / 4 / 0 / 0. Square floats overlapping
  41 / 40 / 36 / 28 / 28. Stacked below another (by design, Decision 5) 3 / 1 /
  0 / 60 / 59. Scaling unchanged: N=160 `yOffset -40` 17 ms, N=1000 108 ms.
- **Residual after locking.** 8 documents still have text under a float.
  At least one (seed 103) is a float whose anchor crossed onto the next page,
  where its new page's text was not re-laid around it; a locked float can also
  sit well above its anchor when its own wrap pushed a long paragraph (seed
  103, about 200 px). Both are left open for review.

