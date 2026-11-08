# RFC: Lists that behave like Word

Status: Approved (2026-11-08), including D4 and D5. Being built as L1–L3.
Workstream W2, after #229 (`main` @ 288119e).

## Goal

A list in Scrivr behaves like a list in Word. Nesting with Tab draws a nested
item. An item can hold more than one paragraph. Backspace, Tab and Shift-Tab do
what a Word user expects. Numbering starts where the author said and restarts
where Word would restart it, on screen, in PDF and in the `.docx`. A Word file's
lists come back in Scrivr as Word had them, and go back out the same way.
Tracked edits across a list boundary accept to the same document as the
untracked edit.

None of this needs a new document model. The container nodes stay
(`bulletList`, `orderedList`, `listItem`), and the fixes go into the seams that
already own each job.

## Where we actually are

Every claim below was checked against `main` @ 288119e, most of them with a
throwaway probe test (deleted before commit).

| # | Symptom | Root cause |
|---|---|---|
| 1 | A nested list, or a second block in an item, is never drawn. Tab "vanishes" the item; Backspace at the start of item 2 "vanishes" it too; PDF loses the text | `collectLayoutItems` lays out only `listItem.firstChild` — `packages/core/src/layout/PageLayout.ts:2193`. Everything else in the item is skipped |
| 2 | Every list item sits at one indent with one marker, whatever its depth | `PageLayout.ts:2139` (`LIST_INDENT = 24`, one level only) and `:2196` (`"•"` or `"${n}."`, no depth) |
| 3 | Two ordered lists in one document continue each other's numbering in Word | `List.ts:297-324` makes one `numId` per list type for the whole document; `createContext.ts:143-152` dedupes `numbering.getOrCreate` by config, so it cannot express "same definition, different list" |
| 4 | Depth past 3 exports as depth 3 | `List.ts:332` — `Math.min(stack.length - 1, 2)`, with three levels defined at `List.ts:303-320` |
| 5 | `orderedList.order` is lost on export | `addExports` never reads `order`; `defaults.ts:292` writes `w:start="1"` for every level |
| 6 | Continuation blocks export with no indent | `listItemHandler` (`List.ts:348-354`) patches `w:numPr` into the first `<w:p>` only and writes nothing on the rest |
| 7 | An ordered list nested in a bullet list (or the reverse) imports as one kind | `numbering.ts:31-41` reads `numFmt` from level 0 only (`findFirstLevel`, `:68-74`); `lists.ts:112` resolves the nested list's kind from that same level-0 answer |
| 8 | `w:start` and `w:startOverride` are ignored on import | `numbering.ts` never reads them; the import model's list block has no start (`core/src/exports/docx.ts:498`) |
| 9 | A Word list interrupted by a paragraph and then resumed restarts at 1 | `lists.ts:75` ends the run at the first non-list paragraph; the next run of the same `numId` becomes a new list |
| 10 | Paragraphs with `<w:numId w:val="0"/>` import as bullet items | `parser.ts:389-401` accepts any integer `numId`; `numbering.ts:61` defaults an unknown one to `"bullet"`. `numId` 0 means "not numbered" |
| 11 | A Google Docs list whose items arrive as flat `<li aria-level="N">` siblings pastes flat | `aria-level` is read nowhere. The `li` rule (`List.ts:154-159`) parses whatever nesting the HTML has. A probe confirmed: nested `<ul>` nests, flat `aria-level` items do not |
| 12 | Nested markdown pastes flat when the markdown-it parse falls back | The line parser (`PasteTransformer.ts:426`) matches `^[*-] ` and `^\d+\. ` at column 0 only (`:508`, `:518`); an indented item becomes a paragraph reading "- b". The markdown-it path nests correctly (probed) |
| 13 | A tracked delete from a paragraph into a list item (or out of one, or into a nested item) loses text on Accept | See below. **Not** `deleteBreak.ts:50` |
| 14 | "What is a list" is answered in six places | `PageLayout.ts:2185`, `List.ts:76` and `:329-330`, `ClearFormatting.ts:74-78`, `plugins/.../listStructure.ts:6-7` (`isListType`), `export-semantic/src/grouping.ts:5-8` |

### The tracked cross-boundary delete (13)

Probe: `[p("one"), ul(li(p("two")))]`, `tr.delete(3, 9)`.

- Untracked: `p("onwo")`. The list, now empty, is gone.
- Tracked, then Accept all: `p("on")`. "wo" is lost.

ProseMirror does not express a join across depths as a `ReplaceStep`. It emits
one `ReplaceAroundStep` that covers the whole list (`from 3, to 14`) and keeps
"wo" as the gap (`gapFrom 9, gapTo 11`). The tracker handles that step in
`trackReplaceAroundStep` → `deleteAndMergeSplitNodes`:

- `deleteAndMergeSplitNodes.ts:42-45` treats a node as part of the gap only
  when it starts inside it. The list, its item and its paragraph start before
  the gap, so `:113-114` records each as a `delete-node`, although all three
  hold the text that survives.
- `:71` emits `join-node` only when `!gap`, so no break deletion is recorded.
  `deleteBreak` and `acceptBreakDeletion` never run.

The tracked document therefore reads "delete the whole list, and delete 'e' and
't'". Accept does exactly that. The same holds for list item → paragraph and
item → nested item.

`acceptBreakDeletion` is not the problem. Given a `node_join` record, it joins
across depths correctly (probed: paragraph → list gives `"onetwo"` and keeps the
rest of the list; list → paragraph gives `"twoone"` in the item; item → nested
item gives `"aabb"`). The fix belongs where the step is classified, not where
the decision is applied.

### Already Word-like, only invisible

Two probes found behaviour that is right in the model and wrong only on screen:

- **Backspace at the start of item 2** runs `joinBackward` (`model/commands.ts:66-68`).
  For a `listItem` (`paragraph block*`) that makes the paragraph a second block
  of item 1. That is what Word does: Backspace removes the number and keeps the
  paragraph indented under the item above. The paragraph then vanishes only
  because of (1).
- **Tab** runs `sinkListItem` (`List.ts:176`), which nests the item correctly,
  and #228 already records it as a `list_change`. It vanishes because of (1).

## What the fixtures say

The 25 Word documents committed by `docs/docx-fidelity-rfc.md` were scanned for
list usage:

| Pattern | Files, of 25 |
|---|---|
| Use numbered or bulleted paragraphs | 13 |
| Nest (`ilvl` ≥ 1) | 3 (max depth 1; none deeper) |
| Interrupt a list and resume the same `numId` | 9 |
| …where the resumed list is **ordered** (22 resumptions) | 3 |
| …where the interruption is all indented paragraphs (continuation blocks) | 3 |
| Use `w:startOverride` / a non-1 `w:start` | 1 / 5 |
| Use `numId` 0 (33 paragraphs) | 2 |
| Number through paragraph styles (`numPr` in `styles.xml`) | 4 |

Resumed lists are common and deep nesting is rare. That decides the order of
the import work in L3: resumed numbering and `numId` 0 matter more than depth.

## Word's model

ECMA-376 5th edition, Part 1 (https://github.com/QtExcel/ecma-376-5th). The
element shapes below are from its `wml.xsd`.

- **§17.3.1.19 `numPr`.** A list is not a container. It is a paragraph
  property: `<w:numPr><w:ilvl/><w:numId/></w:numPr>` (`CT_NumPr`). `numId`
  names a numbering instance and `ilvl` its level. `CT_NumPr` also carries
  `numberingChange` and `ins`, which is how Word tracks a change to a
  paragraph's numbering.
- **§17.9 Numbering.** `numbering.xml` holds abstract definitions and the
  instances that use them:
  - `w:abstractNum` (`CT_AbstractNum`) holds at most **nine** `w:lvl`
    (`maxOccurs="9"`), so `ilvl` runs 0–8.
  - Each `w:lvl` (`CT_Lvl`) has `start`, `numFmt`, `lvlRestart`, `lvlText`,
    `lvlJc` and a `pPr` with the level's indent.
  - `w:num` (`CT_Num`) is an instance. It names one `abstractNumId` and may
    override up to nine levels with `w:lvlOverride` (`CT_NumLvl`), whose
    `startOverride` restarts that level's count.
  - A `numId` of 0 points at no instance. It removes numbering.
- Numbering runs per instance. Paragraphs with the same `numId` count on from
  each other, whatever lies between them. A new list that restarts at 1 is a
  new `w:num` with a `startOverride`.
- An unnumbered paragraph inside a list is an ordinary paragraph whose left
  indent matches the level's text. Word has no "item" that owns it.

The container model maps onto this without loss. A list node is a numbering
instance. Its depth is `ilvl`. Its first block in each item is a numbered
paragraph. Every other block is an unnumbered paragraph at that level's indent.

## Why we keep the containers

Moving to Word's model (lists as `numPr`-style attributes on paragraphs) would
make DOCX one-to-one and make nesting a number. It would also break:

- the schema, and every stored document and Yjs document that uses it;
- `list_change` records and their review (`listChange.ts`, `listStructure.ts`),
  which #228 built on containers;
- the AI list operations (`insertListItem`, `deleteListItem`, `moveListItem` in
  `packages/ai/src/ai-toolkit/applyStructuralEdits.ts`) and the semantic parts
  that address list items;
- markdown, HTML paste and copy, input rules and the list commands, all written
  against containers.

None of the bugs above needs it. Each has a root cause in a seam that the
container model already has, and the containers convert to `numPr` losslessly
(the mapping above).

**What would make us revisit.** Any of these, measured rather than guessed:

1. The fidelity report shows list structure that containers cannot hold. For
   example, numbering that continues across a heading inside a table cell, or
   one list whose items sit at depths that skip a level, in more than a couple
   of the fixtures.
2. Track changes needs Word's own numbering revision (`numberingChange`, or
   `pPrChange` on `numPr`) for a case `list_change` cannot express.
3. Users ask for per-paragraph list formatting Word offers, such as legal
   numbering (`1.1.1`, `isLgl`) or a custom `lvlText` per level.

## Design, seam by seam

Nothing here adds a node, a mark or a document attribute. Each item says what
it builds on, and anything NEW says why the existing shape cannot carry it.

### 1. One owner for "what is a list" (L1)

`isListType` moves from `plugins/src/track-changes/lib/listStructure.ts:6-7`
into core, next to the level table, and is exported from `@scrivr/core`.

- Location: `packages/core/src/model/lists.ts`. It follows the precedent of
  `model/sections.ts`, which owns `isSectionBreak` for layout while the
  `SectionBreak` extension declares the node. Layout must not import from an
  extension.
- The predicate stays structural (`contentMatch.defaultType === listItem`).
  One more helper, `listKind(node): "bullet" | "ordered" | null`, is the only
  place that reads the two type names.
- The six sites in (14) switch to it. `listStructure.ts` re-exports nothing; its
  callers import from `@scrivr/core`.

### 2. The level table (L1)

A typed table of nine levels in `model/lists.ts`, read by layout, PDF (through
layout) and DOCX export. NEW, as a module, because today the same facts live in
two places that already disagree (24px on screen, 720 twips in Word).

```ts
interface ListLevel {
  /** Left edge of the item's text, from the content edge. */
  textIndent: number;   // px
  /** Distance from the marker's left edge to the text. */
  hanging: number;      // px
  bullet: { glyph: string; shape: "disc" | "circle" | "square" };
  ordered: { format: "decimal" | "lowerLetter" | "lowerRoman"; text: string };
}
export const LIST_LEVELS: readonly ListLevel[]; // length 9
export function listMarker(kind: "bullet" | "ordered", depth: number, n: number): string;
```

- **Geometry follows Word's built-in lists:** text at 0.5in × (depth + 1),
  marker 0.25in before it, so 48px per level and a 24px hanging (720 and 360
  twips, which `defaults.ts:286-287` already writes). The marker is drawn
  left-aligned at `textIndent − hanging`, as Word's `lvlJc="left"` (also
  already written). See Risks: this moves every existing list 24px right.
- **Bullets** cycle `•`, `◦`, `▪` by depth — the glyphs the exporter already
  uses (`List.ts:304-306`). The `shape` lets PDF draw the marker when its font
  cannot encode the glyph (§4).
- **Ordered levels** cycle `1.`, `a.`, `i.` by depth (decided below).
- **Depth past 8** is clamped to level 8 wherever it is read, and Tab refuses to
  nest past it (§5), as Word allows nine levels.

### 3. Layout recursion (L1)

`collectLayoutItems` recurses through list items with the depth it is at,
using the `LayoutItem` fields that already exist:

- each block in an item becomes an item with `indentLeft =
  LIST_LEVELS[depth].textIndent` (plus the block's own `indent` attr, as today
  at `PageLayout.ts:2241`), `styleKey: "list_item"`;
- only the item's first block gets a `listMarker`, from `listMarker(kind,
  depth, n)`, where `n` starts at the list's `order`;
- a nested list recurses with `depth + 1`, so its marker and indent come from
  the next level;
- `nodePos` comes from the same walk (`walk(item, itemPos + 1)`), so hit-testing
  and the `CharacterMap` see continuation blocks and nested items with no other
  change.

`listMarkerX` becomes `blockX − hanging` (left edge) rather than `blockX −
MARKER_RIGHT_GAP` (right edge), and `ListItemStrategy` draws with
`textAlign = "left"`. A marker wider than the hanging less a 4px gap (`viii.`,
`xviii.`) pushes the first line's text right by the overflow, through the
first-line offset `layoutBlock` already applies for `textIndent`
(`BlockLayout.ts:513-532`) — Word moves
the text to the next tab stop in the same case.

A table inside a list item keeps today's full-width rows; indenting a table is
out of scope and pinned as a known gap.

### 4. PDF (L1)

PDF draws `LayoutBlock.listMarker` already (`export-pdf/src/context.ts:355-376`),
so (1)-(2) fix PDF with layout. One gap remains: with a standard font the
marker goes through `sanitizeForWinAnsi` (`:367-369`), and `◦` and `▪` are not
in WinAnsi, so they print as `?`.

NEW: `LayoutBlock` carries the level's `bullet.shape` next to `listMarker`, and
the PDF exporter draws a disc, ring or square path when the resolved font cannot
encode the glyph. The canvas keeps drawing the glyph. Any marker drawn on canvas
must reach the PDF (repo rule), and font coverage is not something a document
author controls.

### 5. Keys: Tab, Shift-Tab, Backspace (L2)

Built on the existing bindings; the tracked behaviour comes from `list_change`,
which #228 already records for wraps and lifts.

| Key, where | Today | After |
|---|---|---|
| Tab, item 2+ | `sinkListItem` nests it (invisible) | Same; drawn at the next level. Refused (consumed, no change) at level 8 |
| Tab, first item of a list | `sinkListItem` returns `false`, so the key is not consumed | Consumed, no change. See decision D4 |
| Shift-Tab, nested item | `liftListItem` to the parent list | Same |
| Shift-Tab, top-level item | `liftListItem` to a paragraph | Same (decision D1) |
| Backspace at start, item 2+ | `joinBackward`: becomes a continuation block of the item above (invisible) | Same, now drawn: unnumbered, at the item's indent. Numbering below renumbers. This is Word's first Backspace |
| Backspace at start, first item | `joinBackward` lifts it to a paragraph | Same |
| Backspace at start of a continuation block | Joins it into the block above | Same. Word would first outdent it; noted, not copied |

Each key is one transaction, so one undo step. L2 adds the Tab refusal and the
first-item consumption (`List.ts:176`); the rest is coverage that pins
behaviour L1 makes visible.

### 6. Tracked break across depths (L2)

The seam is the step classification, not acceptance.

In `deleteAndMergeSplitNodes` (`plugins/src/track-changes/lib/deleteAndMergeSplitNodes.ts`):

- A node whose range **contains** the gap (`pos < gap.start && nodeEnd >
  gap.end`) is structure the join closes, never a `delete-node`.
- When a `ReplaceAroundStep` is this kind of join (insert 0, the gap is inline
  content of one textblock, the slice brings no content of its own), the
  textblock whose end token is deleted gets a `join-node` step, as `:71` does
  today for the same-depth join. The deleted text either side stays
  `delete-text`. Nodes wholly between the two sides stay `delete-node`.
- `trackReplaceAroundStep` (`:213-220`) then has nothing to re-insert for the
  gap, because the tracked document keeps its structure until Accept.

`deleteBreak` records the `node_join` as it does for paragraphs, and
`acceptBreakDeletion` joins across depths (probed above). Reject drops the
record; nothing structural was changed, so nothing needs rebuilding.
`listLeaves` / `buildLists` are not needed for this fix.

### 7. DOCX export (L3)

Built on `onBeforeExport`'s existing walk (`List.ts:291-340`) and
`listItemHandler`.

- **One instance per top-level list.** The walk asks for a numbering instance
  per top-level list node. Nested lists use their top-level list's `numId` at
  `ilvl = depth`, as Word does, so a nested level restarts under each parent
  item through Word's default `lvlRestart`. A nested list whose kind differs
  from the one already defined at that level in this instance (item 1 nests a
  bullet list, item 2 an ordered one) gets its own instance.
- **NEW: `instance` and `start` on `numbering.getOrCreate`.** Config-keyed
  dedupe (`createContext.ts:143-152`) cannot say "same definition, different
  list". `instance` (any object; the list node) gives each list its own `w:num`;
  lists with equal levels share one `w:abstractNum`. `start` maps `ilvl` to
  the first number and is written as `w:lvlOverride/w:startOverride`. Every
  instance writes level 0's override, `order` or 1, so no list ever continues
  another. The builder stops assuming `abstractNumId === numId`
  (`defaults.ts:266`).
- **Nine levels** from the level table. `DocxNumberingLevel.format` gains
  `"lowerLetter"` and `"lowerRoman"`, and optional `left` and `hanging` in twips,
  so `numbering.xml` writes the table's geometry rather than its own constants
  (`defaults.ts:286-287`). Both additions are NEW and needed: the first by D2,
  the second so screen and Word read one table.
- **Continuation blocks** get `<w:ind w:left=…>` at their level's text indent and
  no `numPr`, from `listItemHandler`, which today returns them unchanged.

### 8. DOCX import (L3)

Built on `readNumberingMap` and `reconstructLists`.

- **Per-level kind.** `NumberingResolver.resolve(numId)` becomes
  `level(numId, ilvl)`, returning the kind, start and text indent of that
  level, with `w:num/w:lvlOverride/w:startOverride` applied over the abstract
  level's `w:start`. `buildList` asks for the level it is building.
- **`start` → `order`.** The import model's list block gains `start?: number`
  (NEW; `core/src/exports/docx.ts:498` has nowhere to carry it). `List`'s
  `addImports` writes it as `order`.
- **Resumed lists get a computed `order`** (decision D3). The pass keeps a
  count of level-0 items per `numId`. A run of a `numId` that already had items
  becomes a new list whose `order` continues the count, unless its instance
  restarts.
- **Continuation blocks.** A run of unnumbered paragraphs between two paragraphs
  of the same `numId`, each with a left indent equal to the preceding level's
  text indent, joins the previous item as continuation blocks. This needs
  `w:ind/@w:left` on `DocxParagraphAttrs`, which the fidelity RFC's Phase 3 also
  adds; whichever lands first adds the field and the other reuses it.
- **`numId` 0** is not a list paragraph (`parser.ts:399`).

Out of scope, and reported through the fidelity report rather than fixed here:
numbering through paragraph styles (4 fixtures), formats beyond
`decimal`/`lowerLetter`/`lowerRoman`/bullet (imported as the nearest kind), and
`lvlText` other than `%n.`.

### 9. Paste (L3)

- **Google Docs.** Before the DOM parser runs, `cleanPastedHtml` rebuilds any
  list whose `<li>` carry `aria-level` from those levels, whatever nesting the
  HTML used. It reuses the Word paste's levelled builder: `buildWordList`
  (`PasteTransformer.ts:851`) is generalised to take `{ level, ordered,
  content }` items and serves both. The first commit captures a real Google Docs
  clipboard payload as a fixture, because the HTML shape is not documented.
- **Markdown.** The line parser's list branch (`PasteTransformer.ts:507-525`)
  reads indentation and builds through the same levelled builder, so the
  fallback nests like markdown-it does.

## Decisions

- **D1 — Shift-Tab on a top-level item lifts it to a paragraph.** Today's
  behaviour; Google Docs does the same.
- **D2 — Nested ordered levels go `1.` / `a.` / `i.`**, repeating every three
  levels, by absolute depth (an ordered list inside a bullet list inside an
  ordered list is at depth 2 and uses `i.`). This is Word's built-in numbered
  list.
- **D3 — Continuing a list across an interruption is a computed `order` on
  import.** The interruption stays where it was, outside the list. The
  alternative, pulling the interruption into the list as continuation blocks,
  would indent headings and unindented paragraphs that the author put outside
  the list; the fixtures show both kinds of interruption.
- **D4 — Tab on a list's first item is consumed and changes nothing.** Word
  instead moves the whole list's indent, which our lists have no attribute for.
  Revisit if a list-level indent is added. Approved by the user on 2026-11-08.
- **D5 — Word geometry for the level table** (0.5in per level, 0.25in hanging,
  left-aligned marker). It is the most visible change here. Approved by the
  user on 2026-11-08.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Move to Word's model now | Breaks schema, stored and collab documents, `list_change`, AI list ops and semantic parts, for bugs that each have a local fix. See "What would make us revisit" |
| Fix layout in `PageLayout.ts` alone, keep the name checks | Fixes the screen, leaves six definitions of a list and two of its geometry, so DOCX and PDF drift again |
| Forbid multi-block items (`listItem` content `paragraph`) | Word has continuation paragraphs; Backspace already makes them; DOCX import needs them |
| Rebuild the joined structure at Accept with `listLeaves` / `buildLists` (`deleteBreak.ts`) | Accept already joins correctly. The record is wrong; repairing it at Accept would hide a wrong record from Reject and from the review cards |
| One `w:abstractNum` per list to restart numbering | Duplicates identical definitions, and whether Word restarts between instances of one definition without an override is not something to rely on. `startOverride` on each instance says it explicitly |
| Store depth as an attribute on list nodes | Derivable from nesting; a stored copy can disagree with the tree |
| Keep right-aligned markers | Word and our own DOCX export (`lvlJc="left"`) align left; the screen would keep disagreeing with the file |

## Scenarios

All assert relations, never pixels: an item's `indentLeft` against its parent's,
a marker's string, an `x` relative to its block. Each runs on screen layout and,
where marked, through PDF and DOCX.

| # | Scenario | Asserts | PR |
|---|---|---|---|
| 1 | Nested render | `ul(li(p one, ul(li(p child))))`: `child` is laid out, marker `◦`, `indentLeft` one level past `one`'s | L1 |
| 2 | Tab / Shift-Tab | Tab on item 2 nests it under item 1 and it is drawn at level 1; Shift-Tab brings it back; each is one undo step | L1 draws, L2 keys |
| 3 | Tab on the first item | Key consumed, document unchanged; Tab at level 8 likewise | L2 |
| 4 | Multi-block item | `li(p one, p more)`: `more` is laid out, has no marker, same `indentLeft` as `one` | L1 |
| 5 | Backspace at item start | Item 2 becomes a continuation block of item 1 and is drawn; in an ordered list the item below renumbers (3 → 2); on the first item it becomes a paragraph | L2 |
| 6 | `order = 3` | Markers `3.`, `4.`, `5.`; DOCX `startOverride` 3 | L1, L3 |
| 7 | Two ordered lists | Separated by a paragraph, both start at 1 on screen; in DOCX they have different `numId`s, each with a level-0 override | L1, L3 |
| 8 | Mixed nesting | `ol > ul`: `1.` then `◦`; `ul > ol`: `•` then `a.`; `ol > ol > ol`: `1.`, `a.`, `i.` | L1 |
| 9 | PDF | Both depths' markers drawn; `◦` and `▪` drawn as shapes, never `?`, with a standard font | L1 |
| 10 | DOCX round trip | 4 deep, with continuation blocks: `numbering.xml` has 9 levels, `ilvl` 0–3, continuation paragraphs have `w:ind` and no `numPr`; re-import gives the same structure | L3 |
| 11 | DOCX import | `w:start` and `startOverride` → `order`; level 0 decimal + level 1 bullet → `ol > ul`; a resumed ordered list continues its count; `numId` 0 is a paragraph | L3 |
| 12 | Paste | Google Docs `aria-level` items nest, from a captured payload; indented markdown nests through both parsers | L3 |
| 13 | Tracked cross-boundary delete | Paragraph → item, item → paragraph, item → nested item, paragraph → a two-item list: the tracked run records text deletions and one break deletion and no node deletions; Accept all equals the untracked edit; Reject all equals the original. Added to `trackedGestures.test.ts` | L2 |
| 14 | Tracked Tab | Recorded as one `list_change`; Reject un-nests; Accept keeps it; the nested item is drawn throughout | L2 |
| 15 | Undo | Tab, Shift-Tab, Backspace, a tracked cross-boundary delete and its Accept are each one undo step | L2 |

Known gaps: numbering through paragraph styles is not imported; Backspace on a
continuation block joins rather than outdents. (A table inside a list item was
listed here; L1 indents it — see What shipped.)

## PR slices, in order

| PR | Contents | Scenarios | Gate |
|---|---|---|---|
| **L1** | `model/lists.ts` (`isListType`, `listKind`, levels, `listMarker`); the six call sites switch; `collectLayoutItems` recursion; left-aligned markers and Word's tab rule for wide numbers; marker shapes on canvas and in PDF; DOCX levels, continuation indents and schema order (brought forward from L3) | 1, 2 (drawn), 4, 6, 7, 8, 9, and 10's levels and continuation indents | Core, plugins, PDF and DOCX suites green; incremental and streamed layout agree with a fresh layout; **the float re-break fix has landed (after W1) and turned its `it.fails` tests green** |
| **L2** | `deleteAndMergeSplitNodes` gap classification; Tab refusal at level 8 and first-item consumption | 2 (keys), 3, 5, 13, 14, 15 | `trackedGestures` contract holds for the new rows |
| **L3** | `numbering.getOrCreate` `instance` / `start` and the abstract/num split, so separate lists restart in Word; import per-level kind, start, resumed `order`, continuation, `numId` 0; paste `aria-level` and markdown | 6 and 7 (DOCX), 10 (round trip), 11, 12 | Fidelity report: list counts change only where intended; round trip of the 13 list fixtures |

L1 first: everything else is invisible until it lands. L2 next, because its
scenarios need nested items drawn. L3 last; it touches `packages/docx` and
`List.ts`, which W3's block revisions also touch, so W3's PR B follows it or
merges it in.

W1 also edits `PageLayout.ts` (`reflowFlowsAgainstExclusions`). L1 carries one
fix in that function: forwarding a block's first-line settings (a wide
number's push, and the line a float-only first paragraph keeps) on the float
re-break paths. It waits for W1 to land on `main` and is made in the merged
code. **L1 does not merge until that fix is in and its `it.fails` tests pass.**

## Risks

- **Every existing list moves.** D5 shifts level-0 text from 24px to 48px.
  The PDF op-log baselines are built from hand-written layouts and do not
  move; the change shows on screen, in PDF and in DOCX.
- **Incremental and streamed layout.** A list marker is part of what a cached
  measurement describes, and streamed chunks replay a waiting marker. Both are
  covered by tests that compare against a fresh layout in one pass, including
  edits made through the editor's own keys.
- **Content that was invisible becomes visible.** Documents edited since nested
  lists stopped drawing may hold nested items or continuation blocks the author
  never saw. That is correct, and it may surprise.
- **First-line settings beside a float.** A wide number's push, and the line
  a float-only first paragraph keeps for its number, are lost on the paths
  that re-break lines against a float. This blocks the L1 merge; see "Not
  shipped yet" below.
- **A painter that skips `paintBlock` drops list numbers.** Core no longer
  draws markers through a block strategy, so a surface that loops over blocks
  and calls strategies itself paints no numbers. Every surface in the
  repository goes through `paintBlock`; pages, pageless tiles, table cells
  and header and footer bands each have a test that a list's numbers are
  drawn on them.
- **Google Docs clipboard shape** is undocumented and changes. The captured
  fixture pins one version.
- **Word's paragraph-mark rule.** In Word, the paragraph that survives a join
  keeps the properties of the paragraph mark that survives. Scenario 13 takes
  the untracked ProseMirror edit as the reference; if a real Word file shows a
  different result for paragraph → list item, that is a follow-up on the
  untracked edit, not on tracking.

## Release

- **This RFC:** no changeset. Docs only.
- **L1:** `patch` for `@scrivr/core`, `@scrivr/plugins` and
  `@scrivr/export-semantic` (the list predicate moves to core),
  `@scrivr/export-pdf` (marker shapes and face) and `@scrivr/docx` (numbering
  levels). Public changes: `isListType`, `bulletShape`, `bulletBox`,
  `listMarkerFont`, `paintBlock` and their types are new; `ListItemStrategy`
  is removed, and a painter registered under `list_item` is never called;
  `LayoutBlock.listMarkerX` is now the marker's left edge;
  `BlockLayoutOptions.firstLineOffset` and `keepAnchorLine`,
  `DocxContext.textWidthTwips`, and the two `DocxNumberingLevel` formats and
  indents are new.
- **L2:** `patch` for `@scrivr/plugins` and `@scrivr/core`.
- **L3:** `patch` for `@scrivr/core` (`getOrCreate` options, import model
  `start`) and `@scrivr/docx`.

## What shipped

Updated as each PR lands. Where this disagrees with the design above, this
section is what is true.

| PR | Landed | What it changed |
|---|---|---|
| **L1** | `feat/word-lists` (not yet merged) | `model/lists.ts` owns what a list is (`isListType`, `listKind`, `listStart`), the nine levels (`listLevel`) and markers (`listMarker`, `bulletShape`, `bulletBox`); `layout/listMarkers.ts` owns the marker's face (`listMarkerFont`) and its painting (`drawListMarker`); `renderer/paintBlock.ts` paints every block with its marker. The six call sites ask them. `collectLayoutItems` lays out every block of an item at its level's indent, with the number on the item's first block. D5 geometry, with Word's tab rule for a number that reaches its text. Bullets drawn as shapes on canvas and in PDF, in the face of the item's first text. DOCX export brought forward from L3: nine levels with the drawn formats, glyphs and indents, continuation paragraphs, tables and sourced blocks indented to the item's text, and properties in schema order. Scenarios 1, 2 (drawn), 4, 6 and 7 (screen), 8, 9 green; scenario 5's continuation block is drawn |
| **L2** | — | Not built |
| **L3** | — | Not built. Its export half is a `numId` per list and `start` (`w:startOverride`): until then every ordered list shares one `numId`, so separate lists — including short lists in separate table cells, where independent lists are most common — continue each other's numbering in Word, and `order` is not exported |

### Decisions taken while building L1

- **D6 — An item whose first paragraph holds only a floating image is
  numbered on that paragraph** (user decision, 2026-11-08). Word numbers a
  paragraph, not its text: numbering is a paragraph property (`w:numPr`,
  ECMA-376 Part 1 §17.3.1.19), so a paragraph whose only content is an
  anchored picture still carries its number and draws it on its own line, and
  our DOCX export already writes `w:numPr` there. Layout now does the same:
  such a paragraph keeps one line when it opens a list item
  (`BlockLayoutOptions.keepAnchorLine`). This is a deliberate, scoped
  exception to "an anchor-only paragraph is never a flow citizen": it holds
  only for a list item's first block. It replaces the earlier hand-off of the
  number to the item's next block, which is removed with `LayoutItem.listItemPos`
  and its streamed replay; with it go the cases where a handed-on number was
  lost on a table row or a nested list, or drawn on a code block.
- **D7 — New API approved** (user, 2026-11-08): `paintBlock`,
  `DocxContext.textWidthTwips` and `BlockLayoutOptions.keepAnchorLine`.

### Where the code differs from the design above

- **The level table is not exported, and its type changed.** §2's
  `ListLevel` is `ListLevelStyle`, because track changes already has a
  `ListLevel`. Its `ordered.text` is gone (the marker text is
  `listMarker`'s, and DOCX writes `%n.`), and so is `hanging`: every level
  hangs by the one constant `LIST_MARKER_HANGING`. `listLevel(depth)` builds a
  level from the depth instead of indexing a table, and its parts are frozen,
  so nothing outside can change it. `@scrivr/core` exports only `isListType`,
  `bulletShape`, `bulletBox`, `listMarkerFont`, `paintBlock` and their types,
  the pieces another package reads.
- **`isListType` holds only for a node whose content allows list items and
  nothing else.** §1 moved the predicate as it was, "content defaults to
  `listItem`", which also matched a custom `(listItem | paragraph)+`
  container and numbered its loose paragraphs. It now walks the content
  expression and requires every child it allows to be a `listItem`.
- **A wide number follows Word's tab rule, not "overflow less a gap".** §3
  pushed the text when the number came within 4px of it. Word follows the
  number with a tab: `w:suff` (ECMA-376 Part 1 §17.9, `ST_LevelSuffix`
  `tab | space | nothing`) is "assumed to be tab" when omitted, and "this tab
  will follow normal tab stop rules". So the text moves only when the number
  reaches it, and then to the next default half-inch stop past the number; a
  paragraph's own first-line indent counts once. When no stop is left before
  the line's end, the text follows the number after a space, as `w:suff="space"`
  would place it. What Word does with the tab in that case is not documented
  and could not be checked here; the rule chosen keeps the text clear of the
  number. A number that runs past the whole line keeps its text after it,
  overflowing, rather than under it.
- **The marker's face is the item's first text.** The first text run on the
  item's first line, past any image or anchor that opens it, as Word sizes a
  number from the paragraph's text; 14px Arial only when the line has no text.
  `listMarkerFont` returns the face and its resolution, so layout measures,
  and canvas and PDF draw, the number in one face.
- **No new `LayoutBlock` field for the bullet shape.** §4 proposed carrying the
  shape beside `listMarker`. The shape is a function of the glyph, which comes
  only from the level table, so canvas and PDF both read it with
  `bulletShape(listMarker)`. A marker that is not one of the table's glyphs is
  drawn as text, as before.
- **Markers are painted by core, over every painter.** Every surface that
  paints laid-out blocks — pages, pageless tiles, table cells and both
  header/footer loops — goes through `paintBlock`, which paints the block
  through its strategy (or the default painter) and then its marker on top, so
  a painter's background cannot cover the number. A block that carries a
  marker keeps its own `blockType`. `ListItemStrategy`, which existed only to
  draw markers on blocks relabelled `list_item`, is removed; a header list lost
  its numbers on canvas until the band loops went through `paintBlock` too.
  The PDF does the same in its one block route (`renderBlocks`): it draws the
  marker after the block's handler, so a handler that never calls
  `draw.lines` keeps its number.
- **NEW: `MeasureCacheEntry.listMarker`, `BlockLayoutOptions.firstLineOffset`
  and `BlockLayoutOptions.keepAnchorLine`.** A marker draws on its block, can
  move its first line, and keeps a line for an anchor-only first paragraph, so
  the marker and its indent are part of what a cached measurement describes: a
  renumbered item, or one whose indent a page-size change moved, is a cache
  miss. Without it, incremental layout reused blocks from the previous layout
  with their old numbers (Tab, Shift-Tab and joins showed stale or duplicate
  numbers while the PDF, laid out fresh, did not). The editor shows this from
  its second edit on: the first edit stamps every block with its id, which
  replaces every node once and so hides the stale tail. The tests type a word
  first, then press the keys.
- **A list's start is kept within 0–32767**, in layout, copied HTML,
  and markdown alike (all read `listStart`). The
  schema's `ST_DecimalNumber` allows any integer, and no published Word limit
  for `w:start` was found. 32767 is Word's documented cap for the nearest
  equivalent, the line-numbering start (MS-OI29500, Part 1 §17.6.8). Without a
  cap, a pasted or synced `start=2147483647` built a marker 82 million
  characters long.
- **Any block's indent leaves at least an inch of text.** At depth 8 a list's
  text indent is 4.5in, more than an A5 page's text width, and a paragraph's
  own `indent` can exceed the page too. Word's behaviour when an indent exceeds
  the text width is not documented, and Word cannot be run here to see it.
  Layout bounds every block's indent at the content width less one inch, list
  or not; deeper levels on a narrow page share that edge.
- **A table in a list item is indented with the item and fits beside it.** On
  the canvas its grid is scaled to the width left beside the indent. In DOCX it
  gets `w:tblInd` (ECMA-376 Part 1 §17.4, `CT_TblPrBase`), and its preferred
  width (`w:tblW`, type `pct`, fiftieths of a percent) is narrowed by the same
  share: review found Word measures a percentage width against the whole text
  column, so an indented table left at 100% ran into the right margin. The
  column's width reaches handlers as `DocxContext.textWidthTwips` (NEW), set
  from the section the exporter writes.
- **A sourced block in a list item is indented to the item's text** in DOCX
  too: the item descends into the content control (`w:sdt` / `w:sdtContent`).
- **Lists inside table cells are laid out.** A cell's content is `block+`, so
  it can hold a list (pasting one into a cell makes one), but cells laid each
  child out with `layoutBlock` directly: the list became one empty line and its
  text was never painted, on canvas or in PDF (already so on `main`). The body
  and every cell now collect their blocks through one walk
  (`layout/layoutItems.ts`: `collectChildItems`) and take the same fully
  resolved item (`resolveItem`: fitted indent, marker placement, the item's
  own style), so a list in a cell is numbered, nested, indented and spaced as
  in the body, and a table nested in a cell lays out its rows and closes with
  its last row's border. DOCX already numbered lists in cells.
- **In a narrow cell the number stays inside the cell.** A cell an inch or
  so wide leaves no room for a list's indent, so the indent shrinks to fit;
  the marker's hanging shrinks with it, so the number never sits over the
  previous column's grid line, and a number that then reaches the text pushes
  it to the next stop as anywhere else. Our DOCX keeps the number inside the
  cell too. How Word places a number whose hanging indent does not fit a
  cell is not documented and could not be checked here; this keeps it inside
  the box Word draws for the cell.
- **Known gaps in cells, not lists' own:** a cell adds its blocks' margins
  together where the body collapses them (already so on `main`), and a cell
  of a table nested in a cell cannot be selected, because cell hit-testing
  (`cellAtCoords`) looks only at top-level rows.
- **A block that holds blocks is laid out through its blocks.** A container
  that is neither a list nor a table — such as a custom `(listItem |
  paragraph)+` node, no longer a list since `isListType` tightened — has no
  lines of its own, so its blocks are laid out in its place, as a transparent
  node's are; before, it painted as one empty line. A node that declares
  `layout: { kind: "block" }` explicitly keeps its own box and the painter it
  registered, as the `NodeLayout` contract promises; only an undeclared
  container is laid out in place. A transparent or container first block of
  an item passes the item's number to its own first block only.
- **DOCX paragraph and table properties are written in schema order.** One
  ordered insert per properties element (`CT_PPrBase` / `CT_PPr`,
  `CT_TblPrBase` / `CT_TblPr`) places `w:numPr`, `w:ind` and `w:tblInd`.
- **The nested-list streaming check lives with the list tests.**
  `listLayout.test.ts` lays lists out in chunks of 1, 2, 3 and 5 blocks and
  requires the same result as one pass, rather than adding fixtures to the
  general streaming tests in `PageLayout.test.ts`.

### Not shipped yet — blocks the L1 merge

- **First-line settings beside a float.** `reflowFlowsAgainstExclusions`
  re-lays a block beside a float without the measurement's first-line
  settings. A wide number's push is lost, so the text starts under the number
  (pinned: "moves the first line past a wide number beside a float too"). A
  list item's float-only first paragraph loses `keepAnchorLine` in the float's
  own exclusion pass, so its line collapses: the number is drawn at the line's
  top edge, about one ascent above where its line would sit — in the top
  margin when the item is first on a page — and in the fallback face, since
  the collapsed line holds no text (pinned: "keeps the image's paragraph a line
  for its number", and the PDF position test in `listFloatMarkers.test.ts`).
  `rebreakWrappedLinesWithoutExclusions` drops the same settings when a wrapped
  block moves page; probing could not reach it with a list item, because the
  float travels with its anchor onto the item's page. The fix is a single
  `layoutBlockWithMarker` call in place of `layoutBlock` in
  `reflowFlowsAgainstExclusions` (which keeps it through W1's rewrite), and
  the same settings forwarded in `rebreakWrappedLinesWithoutExclusions`; it
  gives these
  settings one owner on the measured entry and forwards them on every
  re-break path. It waits for W1, which rewrites
  `reflowFlowsAgainstExclusions`, to land on `main`. **L1 does not merge until
  that fix is in and the three `it.fails` tests pass.**
