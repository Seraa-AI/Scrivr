# RFC: Tracked changes for agents, and Word revisions in DOCX

Status: approved by the user on 2026-11-08, including D1–D12.

Builds on, and does not repeat:

- [Rich semantic editing](./rich-semantic-editing-rfc.md): semantic units, the
  edit protocol, D7 (a move is one `move` record) and D8 (an agent's rewrite
  reads as a person's edit).
- [Revision projection](./revision-projection-rfc.md): one revision-bearing
  document, several views of it. The semantic lane is the *proposed* view.
- [DOCX fidelity](./docx-fidelity-rfc.md): a Word file comes back as Word had
  it, and import says what it dropped.
- [Structural diff](./structural-diff-rfc.md): produces the same tracked records
  from two versions. Records imported from Word must have the shapes that diff,
  live editing and the agent protocol already produce.

## TL;DR

Two PRs. Each extends a seam that already exists. It does not add a parallel
one.

- **PR A, agents read and review.** `SemanticChange` gains `suggestedInsert`,
  `at`, `length`, `moveId` and `oldAttrs`. The semantic lane reports every
  pending record: insertions, block insertions and deletions, joins and splits,
  heading and list changes, rows and moves. Each change is placed in the text
  the agent reads. A unit's rich hash covers its `changes` only when it has
  some, so accepting a change moves the hash. `ai.reviewChanges` passes straight
  through to the engine's `reviewChanges`.
- **PR B, DOCX revisions.** Export writes `w:ins`, `w:del`, `w:moveFrom`,
  `w:moveTo`, paragraph-mark revisions, `w:pPrChange` and row revisions. Import
  reads them back as pending records instead of silently dropping the text.
  Revision wrappers become synthetic `DocxMark`s that go through the existing
  marks dispatch. TrackChanges owns `addImports().docx` and
  `addExports().docx`.
- **Formatting revisions (`w:rPrChange`) are out of scope.** Import claims them
  silently. Export writes the current formatting.

## Problem

### Agents read the document as if every insertion were already accepted

The semantic lane is the agent's only window. It reports one kind of review
record, the deletion:

```ts
// packages/core/src/exports/semantic.ts:197-205
export interface SemanticChange {
  type: "suggestedDelete";
  text: string;
  id?: string; authorId?: string; status?: string; createdAt?: number; groupId?: string;
}
```

- **Insertions are invisible.** TrackChanges' handler for `trackedInsert` is the
  identity, `(run) => run` (`packages/plugins/src/track-changes/TrackChanges.ts:248`).
  It keeps the text and records nothing. So an agent cannot tell its own pending
  proposal from accepted text. It cannot tell another author's suggestion apart
  either.
- **Records on nodes are invisible.** The semantic seam has a handler for each
  mark (`TrackChanges.ts:249-267`) and `isRemoved` for nodes
  (`semantic.ts:268-277`). Nothing reads a node's `dataTracked`. A deleted
  paragraph break (`node_join`), a split, a paragraph turned into a heading
  (`set_attrs` with `oldNodeTypeName`), a list change, and a row inserted or
  deleted never appear.
- **Nothing says where a change sits.** `extractSemantic` collects changes with
  no offset (`packages/export-semantic/src/context.ts:94-128`). A list unit's
  changes are flattened onto the unit (`packages/export-semantic/src/walker.ts:97-98`).
  `SemanticPart` has no `changes` (`semantic.ts:186-195`), so the agent cannot
  tell which item a change belongs to.
- **The hash ignores review state.** `unitRichInput` covers type, breadcrumb,
  text, spans, attrs, parts, cells and image. It does not cover changes
  (`packages/export-semantic/src/changeDetection.ts:104-118`). Accepting an
  insertion leaves the text and the hash unchanged. A stale-edit guard keyed on
  the hash cannot see that a reviewer acted.
- **Blocks proposed for deletion vanish from `getRichBlocks`.** `liveUnits`
  drops every unit that a pending node deletion covers
  (`packages/ai/src/ai-toolkit/AiToolkit.ts:103-127`, via `shadowRanges`,
  `packages/plugins/src/track-changes/liveNode.ts:40-58`). That covers the
  shadow a move leaves behind, which is correct: one unit per id. It also covers
  a plain deleted block, which then has no unit at all.
- **An agent cannot review.** `reviewChanges(editor, decisions)` exists
  (`packages/plugins/src/track-changes/reviewChanges.ts:53-76`), but
  `AiToolkitAPI` does not expose it. Agents work only through `AiToolkit`.

Measured on `main`@288119e with `toSemanticUnits(editor, { groupBlocks: false })`.
This was a throwaway probe, not committed:

| Edit, tracked | What the agent reads | Hash |
|---|---|---|
| Type `NEW ` at the start of "Alpha one" | `text: "NEW Alpha one"`, no `changes` | changes |
| Delete the break between two paragraphs (`node_join`) | identical to before | **unchanged** |
| Turn a paragraph into a heading (`set_attrs`) | `type: "heading"`, no record of the old type | changes |
| Delete a whole paragraph | `text: ""` and one `suggestedDelete`. The node record is not reported | changes |

### DOCX import silently drops text inside revisions

`parseParagraphInlines` reads only `w:r`, `w:fldSimple` and `w:hyperlink`
(`packages/docx/src/import/parser.ts:407-436`). Every other child is skipped
with no diagnostic: `w:ins`, `w:del`, `w:moveFrom`, `w:moveTo`, and the move
range markers. So text a Word user inserted with Track Changes on **disappears
on import**, and so does text they deleted. Moved text vanishes from both of
its places. Further gaps:

- Inside a hyperlink, only direct `w:r` children are read (`parser.ts:420-433`).
  So `w:hyperlink > w:ins > w:r`, which is valid OOXML, is dropped too.
- `parseRun` reads `w:t` but not `w:delText` (`parser.ts:501-527`, `:508`).
  Descending into `w:del` alone would still produce nothing.
- `parseParagraphProperties` reads `pStyle`, `jc` and `numPr`
  (`parser.ts:375-405`). Paragraph-mark revisions (`w:pPr/w:rPr/w:ins|w:del`)
  and `w:pPrChange` are ignored.
- `parseTable` reads only `w:tblHeader` from `w:trPr` (`parser.ts:323-333`).
  Row revisions are ignored.
- Range markers at body level (`w:moveFromRangeStart`, …) are not in
  `IGNORABLE_BODY_CHILDREN` (`parser.ts:180-188`). Each one draws an
  `unsupported-docx-element` warning (`parser.ts:114-122`), which says nothing
  useful.
- `w:rPrChange` in a run's `w:rPr` becomes mark kind `"rPrChange"`
  (`parser.ts:686-710`). Nobody claims it, so `transformMarks` warns
  `unsupported-mark` once for each run (`packages/docx/src/import/transform.ts:177-190`).

### DOCX export writes deleted text as live text

TrackChanges contributes no `docx` handlers. The walker's run builder always
writes `w:t` (`packages/docx/src/export/walker.ts:126-141`, `:137`). The rPr
builder leaves the tracked marks out on purpose
(`walker.ts:197-200`, and the reserved `DocxRunProps.trackedInsert` /
`trackedDelete`, `packages/core/src/exports/docx.ts:129-132`). So a document
with pending deletions exports with the deleted words in it as ordinary text,
plus one `unsupported-mark` warning per run (`walker.ts:88-95`). Pending
insertions export as accepted. Node records are lost.

### There are no fixtures

None of the 25 committed Word documents (`packages/docx/src/wordTestFiles/`)
contains `w:ins`, `w:del`, `w:moveFrom`, `w:moveTo`, `w:pPrChange`,
`w:rPrChange` or `w:delText`. Each was scanned. PR B adds documents saved by
Word with Track Changes on (see Risks).

## Word's revision model (ECMA-376 Part 1, §17.13.5)

Checked against the 5th-edition text and its schema (Annex A,
`https://github.com/QtExcel/ecma-376-5th`).

**Three forms** (§17.13.1-3):

- **Inline.** An element encloses the revised content: `w:ins`, `w:del`,
  `w:moveFrom`, `w:moveTo` around runs.
- **Cross-structure.** A start element and an end element share a `w:id`:
  `w:moveFromRangeStart` / `w:moveFromRangeEnd`, and the `moveTo` pair.
- **Property.** A child of a properties element: paragraph-mark revisions in
  `w:pPr/w:rPr`, row revisions in `w:trPr`, and `w:pPrChange`.

| Element | Where | Meaning |
|---|---|---|
| `w:ins` (§17.13.5.18) | paragraph content, around `w:r` | inserted run content |
| `w:del` (§17.13.5.14) | paragraph content, around `w:r` | deleted run content; its text is `w:delText` (§17.13.5.14 example) |
| `w:ins` (§17.13.5.20) | `w:pPr/w:rPr` | **this paragraph's mark** was inserted |
| `w:del` (§17.13.5.15) | `w:pPr/w:rPr` | this paragraph's mark was deleted. The content joins the *following* paragraph. The content itself is not implied deleted |
| `w:moveFrom` / `w:moveTo` (§17.13.5.22, .25) | around `w:r` | moved-away / moved-here run content |
| `w:moveFrom` / `w:moveTo` (§17.13.5.21, .26) | `w:pPr/w:rPr` | this paragraph's mark was moved away / here. Says nothing about its content |
| `w:moveFromRangeStart` / `End`, `w:moveToRangeStart` / `End` (§17.13.5.23-24, .27-28) | paragraph or body level | the move's container. The **start** carries `w:name`. A source and a destination with the same `w:name` are one move |
| `w:pPrChange` (§17.13.5.29) | last child of `w:pPr` | holds the **complete former** paragraph properties in an inner `w:pPr` |
| `w:ins` / `w:del` (§17.13.5.17, .12) | `w:trPr` | the row was inserted / deleted. Says nothing about cell content, which is revision-marked on its own |
| `w:rPrChange` (§17.13.5.30-31) | `w:rPr` | former run properties. **Out of scope** |

Attributes. These come from the schema, which is stricter than the prose in
places:

- `w:id`: `ST_DecimalNumber`, **required** (`CT_Markup`). The prose says each
  is "a unique identifier for an annotation within a WordprocessingML document".
  A range's start and end share one id, and that shared id is how they pair.
- `w:author`: **required** on every revision element (`CT_TrackChange`,
  `use="required"`). The prose says "if this attribute is omitted, then no
  author shall be associated". The schema wins, so export always writes one.
- `w:date`: `ST_DateTime`. Optional on `w:ins`, `w:del`, `w:moveFrom`,
  `w:moveTo` and `w:pPrChange`. **Required** on `w:moveFromRangeStart` and
  `w:moveToRangeStart` (`CT_MoveBookmark`, which also requires `w:author` and,
  through `CT_Bookmark`, `w:name`).
- The end elements (`*RangeEnd`) are `CT_MarkupRange`. They carry `w:id` and
  **no `w:name`**.

Validity rules we must not break on export:

1. **`w:pPrChange` is the last child of `w:pPr`.** The `CT_PPr` sequence is
   the base properties, then `w:rPr`, then `w:sectPr`, then `w:pPrChange`. Its
   inner `w:pPr` is `CT_PPrBase`: no `rPr`, `sectPr` or `pPrChange`. It is
   required even when empty (`minOccurs="1"`).
2. **Paragraph-mark revisions come first in `w:pPr/w:rPr`, in the order `ins`,
   `del`, `moveFrom`, `moveTo`** (`EG_ParaRPrTrackChanges`). Formatting
   follows, and `w:rPrChange` comes last.
3. **Row revisions come after the base row properties** in `w:trPr`. The order
   is `w:ins`, `w:del`, `w:trPrChange`.
4. **A revision wrapper never encloses `w:hyperlink` or `w:fldSimple`.**
   `CT_RunTrackChange` admits only `EG_ContentRunContent`: runs, nested
   revisions, `smartTag`, `sdt`, `customXml`, range markup. `w:hyperlink` and
   `w:fldSimple` are `EG_PContent`, which *does* admit revisions. So the valid
   nesting is `w:hyperlink > w:ins > w:r`.
5. **`w:ins` may contain `w:del`** (multi-author: inserted by A, then deleted
   by B), because `EG_ContentRunContent` includes `EG_RunLevelElts`.
6. **Moves need both containers.** A `moveFrom` outside a source container with
   a matching destination is non-conformant (§17.13.5.21-22). So are two
   containers around the same text, and duplicate start ids (§17.13.5.24).
7. **`w:id` is unique per annotation in the document.** Today Scrivr's export
   writes no other annotations with ids: no bookmarks, no comments. A future
   comments export must share the counter (see Risks).

Two notes on the spec text. The prose of §17.13.5.20 (inserted paragraph) says
"shall be treated as deleted". That is copied from §17.13.5.15, and the example
shows an insertion. The examples in §17.13.5.22 show `w:t` inside `w:moveFrom`.
Import accepts both `w:t` and `w:delText` there. Export writes `w:delText`
inside `w:moveFrom`, as inside `w:del`, which needs confirming against a file
Word saved (see Risks).

## Our records → OOXML

The records come from `packages/plugins/src/track-changes/types.ts:28-178`. An
**act** is what `changeActs` groups as one decision
(`reviewPlan.ts:149-195`).

| Our record | Lives on | Export | Import (inverse) |
|---|---|---|---|
| `trackedInsert` | text | `w:ins` around the run | `w:ins` → `trackedInsert` |
| `trackedDelete` | text | `w:del` around the run; `w:t` → `w:delText`, `w:instrText` → `w:delInstrText` | `w:del` (`w:delText`) → `trackedDelete` |
| `trackedDelete` + `trackedInsert` sharing `groupId` (D8 replacement) | text | adjacent `w:del` then `w:ins`, same author and date. Word has no group, so `groupId` is not written | an adjacent `w:del`/`w:ins` pair with the same author and date → one `groupId` (D11) |
| `trackedDelete` / `trackedInsert` with `moveId` (text move) | text | `w:moveFrom` / `w:moveTo`, each inside its range container; one `w:name` per `moveId` | range `w:name` → one fresh `moveId` for both halves |
| node `insert` on a textblock (+ `creationId` on its text) | paragraph | its runs in `w:ins`, plus `w:pPr/w:rPr/w:ins` on its own mark | mark inserted **and** all content inserted → node `insert`; text gets `creationId` |
| node `delete` on a textblock (+ `deletionId` on its text) | paragraph | its runs in `w:del`, plus `w:pPr/w:rPr/w:del` | mark deleted **and** all content deleted → node `delete`; text gets `deletionId` |
| `node_join` ("the break ending this block was deleted") | paragraph | `w:pPr/w:rPr/w:del` only. Exactly §17.13.5.15 | mark deleted, content not all deleted → `node_join` on that block |
| `node_split` on the second block + `reference` on the first (`lib/fragments.ts:80-98`) | the first paragraph | `w:pPr/w:rPr/w:ins` on the paragraph holding the `reference`: the new mark ends it | mark inserted, content not all inserted → `reference` on it, `node_split` on the next block |
| `move` with `moveNodeId` (the destination copy) | block | content in `w:moveTo` + `w:pPr/w:rPr/w:moveTo`, in a `moveTo` range | imported as a text move first (D5) |
| `delete` with `moveNodeId` (the shadow left behind) | block | content in `w:moveFrom` + `w:pPr/w:rPr/w:moveFrom`, in a `moveFrom` range with the same `w:name` | as above |
| `set_attrs` with `oldAttrs` / `oldNodeTypeName` (heading level; paragraph ↔ heading) | paragraph, heading | `w:pPrChange` holding the former `w:pPr`, last in `w:pPr` | `w:pPrChange` → `set_attrs` with the old node's attrs, and `oldNodeTypeName` when the type differs |
| `list_change` with `oldList` | paragraph | `w:pPrChange` whose former `w:pPr` has the old `w:numPr`, or none when it was in no list | former `numPr` differs → `list_change` with `oldList` rebuilt from it |
| row `insert` / `delete` (`tableRow` node-change) | row | `w:trPr/w:ins` / `w:trPr/w:del`; cell content carries its own act records | `w:trPr/w:ins|del` → row `insert` / `delete` |
| inline leaf `insert` / `delete` (`hardBreak`, `image`) | node `dataTracked` | `w:ins` / `w:del` around the run the node's handler wrote | a revision mark on the inline → node `dataTracked` |
| `mark-change` (formatting) | marks | **out of scope**: current formatting written, no diagnostic | `w:rPrChange` claimed and dropped silently |
| `set_attrs` on a node with no OOXML property revision (image size, anchor) | node | current state written, one `revision-not-expressible` diagnostic | — |
| `wrap_with_node`, `structure` | node | current state written, one `revision-not-expressible` diagnostic | — |

`isConflict`, `dependsOn`, `foldingClosed` and `placementDependsOn` are engine
bookkeeping. They are neither exported nor imported. Imported records have none
of them, as if typed fresh.

## What agents see

### The extended `SemanticChange`

```ts
// packages/core/src/exports/semantic.ts
export interface SemanticChange {
  type: "suggestedDelete" | "suggestedInsert" | "suggestedAttrs"; // suggestedAttrs: NEW, see D7
  /** The text the change removes or adds; "\n" for a paragraph break; "" for an object or an attribute change. */
  text: string;
  /**
   * Where it sits, as an offset into the text of the list it appears in:
   * `unit.text`, `part.text` or `cell.text`. Absent when a node handler
   * overrides the unit's text, because the offset would index text the
   * walker did not produce.
   */
  at?: number;
  /**
   * How much of that text it covers. 0 for a deletion, because deleted text
   * is not in the proposed text. Covers the whole block for an attribute change.
   */
  length?: number;
  id?: string;
  authorId?: string;
  status?: string;
  createdAt?: number;
  /** The two halves of one replacement (D8). */
  groupId?: string;
  /** The two halves of one move: the record's `moveId`, or `moveNodeId` for a block move. */
  moveId?: string;
  /** suggestedAttrs only: what the block was. */
  oldAttrs?: Record<string, unknown>;
}
```

Invariants, each tested:

- For a `suggestedInsert`, `owner.text.slice(at, at + length)` is its `text`,
  except where another author's change sits inside it — an insertion typed
  into it is in the slice but not in `text`, and a deletion of part of it
  takes that part out of the slice. Text across blocks keeps the break between
  them in both.
- For a `suggestedDelete`, `length === 0` and `at` is where its first piece
  stood.
- A hard break counts as 1 in `at` (D6), because it is `"\n"` in `text` and in
  `spans`. A deleted one is in neither. An inline image counts as 0.
- Changes are listed in document order. Every change in a part or a cell is also
  in its unit's list, re-based on `unit.text`. The same contract as
  `TableCell.changes`.

`SemanticPart` gains `changes?: SemanticChange[]` (NEW field, D8). Its offsets
index `part.text`, which is where an agent edits.

### What each record reads as

| Record | Reported as |
|---|---|
| text insert / delete | `suggestedInsert` / `suggestedDelete` with its text |
| replacement | both halves, sharing `id` and `groupId` |
| text move | `suggestedDelete` + `suggestedInsert`, sharing `id` and `moveId` |
| block move | `suggestedInsert` covering the destination block, with `moveId`. The copy left behind is not read through `getRichBlocks`: it carries the moved block's ids, and an agent edits by id, so reading both would offer two targets for one block. It is in `toSemanticUnits` |
| block insert / delete | one `suggestedInsert` covering the block, or one `suggestedDelete` with the block's text at 0. Its text records are folded into the block's act |
| `node_join` | `suggestedDelete`, `text: "\n"`, at the end of the block |
| `node_split` | `suggestedInsert`, `text: "\n"`, at the end of the first block. It is reported through its `reference` and has one id |
| `set_attrs` | `suggestedAttrs`, `oldAttrs` = the former styling attrs as `attrsOf` filters them, plus `level` for a heading and `nodeType` when the type changed |
| `list_change` | `suggestedAttrs`, `oldAttrs: { list: ["bulletList", …] }`, outermost list first, `[]` when it was in none |
| row insert / delete | on the table unit, covering the row's text; the cell records are folded into the row's act |
| `reference` | the split it belongs to (see `node_split`) |
| `wrap_with_node` | `suggestedInsert` covering the container added around its content |
| `structure` | `suggestedInsert` covering the copy a structural change moved, with `moveId` |
| formatting (`mark-change`) | `suggestedAttrs` covering the formatted text, `oldAttrs: { marks: [...] }` = the text's formatting marks before; one change per run with different prior marks, all under the act's id. A mark proposed for removal is left off the spans |
| hard break deleted | leaves the proposed text; `suggestedDelete`, `text: "\n"`, `length: 0` |
| image inserted / deleted | `suggestedInsert` / `suggestedDelete` with `image` saying which image |

### Example

An agent replaced "30" with "45". Someone else deleted the break after the
paragraph. A second block was promoted to a heading:

```json
[
  {
    "id": "p-7", "type": "paragraph", "view": "proposed",
    "text": "The fee is due in 45 days.",
    "changes": [
      { "type": "suggestedDelete", "text": "30", "at": 18, "length": 0,
        "id": "c1", "authorId": "AI Assistant", "groupId": "g1", "status": "pending", "createdAt": 1794141158501 },
      { "type": "suggestedInsert", "text": "45", "at": 18, "length": 2,
        "id": "c1", "authorId": "AI Assistant", "groupId": "g1", "status": "pending", "createdAt": 1794141158501 },
      { "type": "suggestedDelete", "text": "\n", "at": 26, "length": 0,
        "id": "c3", "authorId": "jane", "status": "pending", "createdAt": 1794141160020 }
    ]
  },
  {
    "id": "p-8", "type": "heading", "headingLevel": 2, "text": "Late payment",
    "changes": [
      { "type": "suggestedAttrs", "text": "", "at": 0, "length": 12,
        "id": "c4", "authorId": "jane", "oldAttrs": { "nodeType": "paragraph" }, "status": "pending", "createdAt": 1794141161000 }
    ]
  }
]
```

Both halves of the replacement read under one id, `c1`, the act's.
`ai.reviewChanges({ accepted: ["c1"], rejected: [] })` accepts the whole
replacement, because `sameReplacement` puts both records in one act
(`reviewPlan.ts`). The result is the engine's own `ReviewOutcome`.

## Design per seam

### PR A: agents read and review

**`@scrivr/core`, `exports/semantic.ts`.** Extends `SemanticChange` as above,
and `SemanticPart` with `changes?`. `SemanticHandlers` gains one node-level
contribution, which is NEW (D8):

```ts
/** Review records written on a node rather than on its text. Placed by the walker. */
nodeChanges?: (node: PmNode) => Array<{ change: SemanticChange; place: "covers" | "after" }>;
```

`isRemoved` is the precedent. The node's own extension owns `nodes[name]`, which
classifies the node. The mark handlers never see node attrs. So the extension
that reads `dataTracked` needs a contribution keyed on any node, and only
TrackChanges supplies it. `place` exists because a break record (`node_join`,
or a split's `reference`) sits *after* the block's text, while every other
record covers it.

**`@scrivr/export-semantic`.**

- `extractSemantic` (`export-semantic/src/context.ts`) keeps a running offset into the text
  it builds, in the same pass that builds the spans. It stamps `at`/`length` on
  the changes from each run (after the mark handlers fold) and on each node's
  `nodeChanges`. In a container it follows `joinGroups`' rule: empty groups add
  no `"\n"`. Then it merges adjacent entries with the same `id` and `type` into
  one (D1). It returns offsets relative to the node it was called on.
- `collectParts` (`export-semantic/src/walker.ts`) asks `ctx.toChanges(child)` for each part,
  which gives offsets relative to `part.text`. The unit-level list re-bases the
  same records on `unit.text`.
- The walker drops `at`/`length` when `result.text` overrides the unit text.
  This is the same rule that already drops `spans` (`walkSemantic`).
- `unitRichInput` adds `...(unit.changes?.length ? { changes: unit.changes } : {})`,
  and `semanticPartRichInput` does the same for parts. This follows the
  `image` precedent in `unitRichInput`. A unit with no review changes
  hashes exactly as before.

**`@scrivr/plugins`, `TrackChanges.addExports().semantic`.** Owns what every
record means:

- `keepInserted` now records a `suggestedInsert`, and keeps the text.
  `dropDeleted` keeps its current behaviour and adds `moveId` (from `moveId`, or
  from `moveNodeId`).
- `nodeChanges` maps a node's `dataTracked` entries by the table above. It
  returns nothing for a `node_split` record, because its `reference` reports
  it.
- The id each piece reports is its **root**: `creationId ?? deletionId ??
  continuesId ?? (reference ? referenceId : id)`. Folding a block's text
  records into the block record is then the same id-merge as joining a split
  deletion. On `main` this holds already: a whole-paragraph deletion's text
  record has `deletionId` = the node record's id, and an inserted paragraph's
  text record has `creationId` = the node record's id. Both were measured.

**`@scrivr/ai`, `AiToolkit`.**

- `reviewChanges(decisions: ReviewDecisions): ReviewOutcome` is NEW (agreed).
  It returns `reviewChanges(this.editor, decisions)` and nothing more. Policy
  stays with the host. Without `canAcceptReject: true` the answer is
  `blocked / not-permitted` (`reviewChanges.ts:22-28`).
- The auto-diff in `applyRichEdit` compares a returned unit as if it carried
  the current unit's `changes`. The comparison is in `applyRichEdit`. So an
  agent that drops or reorders `changes` is not read as editing. `changes` is
  read-only to an agent. It proposes through `spans`, `attrs` and structural
  ops. The stale guard is unchanged. It compares the pinned hash, which now
  moves when a reviewer acts. That is the point.
- `liveUnits` (shipped as `unitsToRead`) drops a unit or part only when it is
  **the copy a pending move left behind**: it carries the moved block's ids, and
  an agent edits by id, so reading both would give two targets for one block.
  A block proposed for deletion stays. It reads `text: ""` with its `suggestedDelete`, so an
  agent can see and review it. An edit to it is already reported as rejected,
  because `findLiveNodeById` returns null. See D9.

### PR B: DOCX revisions

**Export, `@scrivr/core/exports/docx.ts` and `@scrivr/docx`.**

- `DocxHandlers.nodeWrappers?: Record<string, DocxNodeWrapper>` is NEW
  (agreed), with
  `DocxNodeWrapper = (out: XmlNode[], node: PmNode, ctx: DocxContext) => XmlNode[]`.
  `walkNode` runs `nodeWrappers[node.type.name]` on a handler's output, as
  `wrapRun` runs `markWrappers` on a run (`walker.ts:109-124`). Collected like
  `markWrappers` (`export.ts:153-169`). It is keyed by node type because each
  block type's OOXML shape decides where its revision goes: `w:p` → the
  paragraph mark, `w:tr` → `w:trPr`, an inline leaf's `w:r` → a wrapper. The
  owner of a custom block's XML can register for it.
- TrackChanges registers `markWrappers` for `trackedInsert` and
  `trackedDelete`. The wrapper looks at the record. With `moveId` or
  `moveNodeId` it writes `w:moveTo` / `w:moveFrom`. Otherwise it writes
  `w:ins` / `w:del`. `w:del` and `w:moveFrom` rewrite `w:t` → `w:delText`. When
  handed a `w:hyperlink` or `w:fldSimple`, the wrapper goes *inside* it
  (rule 4). That is needed because `wrapRun` applies wrappers in mark-rank
  order. With StarterKit registered before TrackChanges, the usual order,
  `link` ranks first, so the hyperlink is already around the run. On multi-author text the insertion wraps the
  deletion (`w:ins > w:del`).
- TrackChanges registers `nodeWrappers` for `paragraph`, `heading`,
  `codeBlock`, `bulletList`, `orderedList`, `listItem`, `table`, `tableRow`,
  `hardBreak`, `image`, `horizontalRule` and `pageBreak`.
  - A `w:p` gets its paragraph-mark revision by rule 2.
  - A container's insert, delete or move is applied to every paragraph mark and
    run in its output.
  - Adjacent revision elements in one paragraph that come from one record are
    merged into one element, so one record reads as one Word revision.
- `w:pPrChange`'s former `w:pPr` is computed as:
  - the current `w:pPr`,
  - minus what the current node's own handler renders,
  - plus what the **former** node renders.
  - The former node is
    `schema.nodes[oldNodeTypeName ?? type].create(oldAttrs, content)`. It is
    wrapped in a doc and walked with `ctx.walkContent`, with its
    `dataTracked` cleared so the wrapper does not recurse.
  - The block's owner decides its OOXML. A list paragraph's `w:numPr`, which
    `listItem` adds, survives into the former properties. Without that,
    rejecting an alignment change in Word would also take the paragraph out of
    its list.
  - For `list_change` the former `w:numPr` comes from `oldList`.
- `w:pPr` children are placed in `CT_PPr` order by one helper,
  `insertParagraphProperty(p, child)` in `exports/docx.ts`, which is NEW (D12).
  Today `addNumPrToParagraph` *appends* `w:numPr` to the end of `w:pPr`
  (`packages/core/src/extensions/built-in/List.ts:47`). The list item's handler
  runs after the paragraph's wrapper, so its `numPr` would land after
  `w:pPrChange`. That breaks rule 1. Both List and TrackChanges call the helper.
- `onBuildTreeComplete` (an existing hook) pairs moves. It puts one range start
  before the first element of each move and one range end after the last, with
  `w:name = "move" + n`, `w:author` and `w:date`, in source and destination.
  The wrappers record which element belongs to which move in `ctx.shared`.
- Ids: one counter per export in `ctx.shared`, starting at 1. It is shared by
  every revision element and range marker (D3). `w:author` is
  `docxAuthor(authorID)`, falling back to the raw `authorID` (D2). `w:date` is
  `createdAt` as ISO 8601 UTC to the second (D4).
- The reserved `DocxRunProps.trackedInsert` / `trackedDelete`
  (`docx.ts:99-101,129-132`) and the comment at `walker.ts:197-200` are
  deleted. Revisions wrap runs. They are not run properties. A field that can
  never be emitted is a dead hook.

**Import, `@scrivr/docx` Stage 1 (parser).**

- `parseParagraphInlines` descends into `w:ins`, `w:del`, `w:moveFrom` and
  `w:moveTo`. It also descends into them inside `w:hyperlink`, whose inner
  content now goes through the same function. Each inner inline gets a
  synthetic `DocxMark` through `addMark`, as hyperlinks already do
  (`parser.ts:438-451`): `{ kind: "ins" | "del" | "moveFrom" | "moveTo",
  attrs: { id, author, date, move? } }`. The kind is the element's local name,
  the `DocxMark` convention (`docx.ts:373-391`). Nesting gives two marks of
  different kinds, so `layer`'s by-kind merge (`styles.ts:92-101`) keeps both.
  Word never nests two of the same kind.
- `parseRun` reads `w:delText` as text.
- One parse state per document tracks the open move ranges: range `w:id` →
  `w:name`, across paragraphs and body level. A moved element is stamped with
  `move: name`. The range markers join the ignorable children at both levels.
  They are read, not unsupported.
- The paragraph block and `DocxTableRow` gain `revisions?: DocxMark[]`. That is
  data in the intermediate model, not a seam. The paragraph-mark
  `w:ins|w:del|w:moveFrom|w:moveTo` go there. So does `w:pPrChange`, as
  `{ kind: "pPrChange", attrs: { id, author, date, former: DocxParagraphAttrs } }`,
  with `former` parsed by the same `parseParagraphProperties`. A row's
  `w:trPr/w:ins|w:del` go on the row.

**Import, Stage 2 (`transform.ts`) and TrackChanges.**

- Text: the synthetic marks go through the existing `marks` dispatch.
  TrackChanges' `addImports().docx.marks` claims `ins` and `moveTo` (→
  `trackedInsert`), and `del` and `moveFrom` (→ `trackedDelete`). Ids are
  minted fresh, one per Word revision element, through a `w:id` → id map in
  `ctx.shared`. `moveId` is minted per `w:name`. `authorID` is `w:author`.
  `createdAt` is `Date.parse(w:date)`, or the import time when the date is
  missing. It also claims `rPrChange` and returns `null`, so that formatting
  revisions are silent.
- `DocxImports.revision?: (node: PmNode, revisions: readonly DocxMark[], ctx,
  former?: PmNode) => PmNode` is NEW (agreed). Stage 2 calls it with the node a
  block transform produced, whoever owns that block. For `pPrChange` it also
  passes `former`: the same block transformed with `attrs: former` and no
  content, so Heading's `paragraphStyles` decides what `Heading2` meant before,
  exactly as it decides now. It is called the same way for rows (matched to
  `DocxTableRow` by index after Table's handler returns; a count mismatch is a
  diagnostic) and for inline leaves. `hardBreak`, `image` and `field` take the
  revision on the node's `dataTracked`, not as a mark. Today `transformInlines`
  creates the hard break with no marks at all (`transform.ts:126-136`).
  TrackChanges supplies the one handler. It classifies by the table above:
  insert vs split, delete vs join. It stamps `creationId` / `deletionId` on the
  content.
- `onImportComplete` (an existing hook) does what needs neighbours:
  - It places a split's `node_split` on the next block.
  - It pairs an adjacent `w:del`/`w:ins` with the same author and date into one
    `groupId` (D11).
  - It emits `docx-block-move-as-text` once per move whose halves are whole
    paragraphs (D5).

**Without TrackChanges** (D10). Nobody claims `del` or `moveFrom`. Stage 2
drops that text and keeps inserted text. Deleted rows and wholly deleted
paragraphs are dropped. A deleted paragraph mark alone keeps the two paragraphs
apart. One `docx-revisions-accepted` warning names what was resolved. That is
Word's "Accept All", short of the join. It replaces today's silent loss of both
sides.

**When DOCX fidelity's report lands,** TrackChanges reports `kept("revision", n)`
on both sides. This RFC does not depend on it.

## Rejected alternatives

- **A separate review type or lane** (e.g. `SemanticReviewChange`, or a
  `review` array next to `changes`). Two places would say what is pending, and
  consumers of `changes` already exist (`TableCell.changes`). Extending is the
  agreed direction.
- **Hand agents the `ChangeSet`** (`findChanges`) instead. Its positions are
  ProseMirror positions, and agents address by `nodeId` + text. It would
  duplicate the semantic lane's knowledge of what text a record covers.
- **Encode revisions as run properties.** These are the reserved
  `DocxRunProps.trackedInsert` / `trackedDelete`. `w:rPr` cannot enclose a run,
  so the rPr builder could never emit them. They are deleted.
- **New `DocxInline` / `DocxBlock` variants for revisions.** Every inline
  consumer and every block handler would have to learn them. Synthetic marks
  ride the dispatch that text already goes through. Blocks carry `revisions`
  as data, and their owners never see it.
- **Accept revisions on import.** Simplest, and it loses exactly what a
  reviewer opened the file for. It is kept only as the fallback when
  TrackChanges is absent.
- **Keep Word's `w:id` as our record id.** It is unique only within one file.
  Two imports, or an import into a collaborative document, would collide.
- **Derive `w:id` from our record ids** (e.g. a hash). It must be
  `ST_DecimalNumber` and unique per annotation. A per-export counter is both,
  trivially.
- **Import a block move as a real block move** (`move` + `moveNodeId`) in PR B.
  Word lets content change inside a moved paragraph, and our block move assumes
  the copy equals its shadow (`nodeContentEquals`, rich-semantic D7). The text
  move represents both. A true block move is a later step (D5).
- **Show agents every shadow.** Drop the `liveUnits` filter entirely. A move
  would then give two units with one id. #229 settled that agents read one unit
  per id.
- **Report each piece as stored.** A deletion that later typing split, or a new
  paragraph and its text, would read as several changes for one act.
- **One generic "after every node" export hook instead of keyed
  `nodeWrappers`.** Keying mirrors `markWrappers` and the handler dispatch. A
  generic hook would make TrackChanges guess the XML shape of blocks it does
  not own.

## Scenario matrix

Assertions are relations: XML structure, record shapes, offsets into strings.
Never pixels or widths. "Round-trip" means export, then import into a fresh
`ServerEditor` with `StarterKit` + `Table` + `TrackChanges`.

| # | Scenario | PR | Given → then |
|---|---|---|---|
| 1 | Insert, export | B | Tracked insertion "NEW " → `w:ins` with `w:author`, `w:date`, a numeric `w:id`, around a `w:r` with `w:t`. Ids unique across the file. No `unsupported-mark` diagnostic |
| 2 | Delete, export | B | Tracked deletion → `w:del` around `w:r` with `w:delText`. No `w:t` holds the deleted text |
| 3 | Agent replacement, export + re-import | B | `applyRichEdit` replacement → adjacent `w:del` then `w:ins`, same author and date. Re-import gives two records with one `groupId`, and `changeActs` returns **one** act |
| 4 | Import a Word file with revisions | B | Word-saved fixture → every inserted and deleted word is in the document as a pending `trackedInsert` / `trackedDelete`. Author from `w:author`. `createdAt` = `w:date`. No text lost. No `unsupported-*` diagnostics for revision elements |
| 5 | Text move | B | A tracked text move (`moveId`) exports as `moveFrom` + `moveTo`. Each sits in a range container, the containers share `w:name`, and the start elements carry `w:author` and `w:date`. Re-import gives one shared `moveId`. Accepting one half decides both |
| 6 | Block move | B | A `moveBlock` exports as paragraph-mark + content `moveFrom` / `moveTo` in ranges. Re-import gives a text move: node `delete` + node `insert` with one `moveId`, plus one `docx-block-move-as-text` warning. Accept and reject leave the same text as accepting and rejecting the original |
| 7 | Heading level via `pPrChange` | B | H1 → H2 tracked → `w:pPrChange` is the last child of `w:pPr`, and its inner `w:pPr` has `pStyle Heading1`. Re-import gives `set_attrs` with `oldAttrs.level === 1` |
| 8 | Paragraph → heading via `pPrChange` | B | Re-import gives `set_attrs` with `oldNodeTypeName: "paragraph"`. Reject restores a paragraph |
| 9 | List change | B (after W2 L3) | A paragraph tracked into a bullet list → `w:pPrChange` whose former `w:pPr` has no `w:numPr`. The current `w:numPr` comes before `w:pPrChange`. Re-import gives `list_change` with `oldList: []` |
| 10 | Paragraph join | A + B | Agent: `suggestedDelete` `"\n"` at `unit.text.length`. Export: `w:pPr/w:rPr/w:del` on that paragraph only; its runs are not wrapped. Re-import gives `node_join` on the same block |
| 11 | Row inserted | A + B | Agent: a `suggestedInsert` on the table unit covering the row's text, and its cell records folded in. Export: `w:trPr/w:ins` after the base row properties. Re-import gives a row `insert` |
| 12 | Row deleted | A + B | The same, with `suggestedDelete` and `w:trPr/w:del`. Accept removes the row on both sides of the round trip |
| 13 | Multi-author nesting | A + B | Inserted by A, then deleted by B. The agent reads A's `suggestedInsert` with `length: 0` and B's `suggestedDelete` at the same `at`. Export writes `w:ins` (A) around `w:del` (B) around `w:delText`. Re-import gives both records, with their authors |
| 14 | Accept / reject all after a round trip | B | For a document carrying scenarios 1-12: accept all on the original and on the round-tripped copy gives the same `toSemanticUnits` text and types. Reject all does too |
| 15 | Agent reads a replacement | A | `suggestedDelete` + `suggestedInsert`, same `groupId`, `authorId: "AI Assistant"`, ids present, and `at` such that `unit.text.slice(at, at + length) === "45"` |
| 16 | Structural changes visible | A | Join, split, block insert, block delete (still in `getRichBlocks`, `text: ""`), heading change (`suggestedAttrs` with `oldAttrs`), list change, and row insert/delete each appear once. A list item's change is in that part's `changes`, with `at` into `part.text`. A block move shows on the destination only |
| 17 | Hash moves on accept | A | `unitRichHash` changes when a pending insertion is accepted and when one is rejected. A unit with no changes keeps the hash it has on `main` (golden values) |
| 18 | `ai.reviewChanges` by id | A | Ids taken from `getRichBlocks` decide their acts. Accepting one half of a replacement accepts both. Without `canAcceptReject` the result is `blocked / not-permitted`. An unknown id gives `missing-changes` |

## Slices

**PR A: agents read pending changes and review them.** Branch
`feat/agents-read-tracked-changes`.

1. Core types: `SemanticChange` fields, `SemanticPart.changes`,
   `SemanticHandlers.nodeChanges`. API snapshot, patch changeset.
2. `export-semantic`: offsets, merging, part changes, hash. Scenarios 15 and
   17 go red, then green.
3. TrackChanges `semantic`: insertions, node records, roots, `moveId`.
   Scenarios 10, 11, 12, 13 and 16 (agent half).
4. `AiToolkit`: `reviewChanges`, the auto-diff ignoring `changes`, `liveUnits`
   keeping sole-copy deletions. Scenario 18.
5. Docs: the semantic-export and `@scrivr/ai` pages, and the plugins page
   (`apps/docs/content/docs/packages/plugins.mdx`).

**PR B: DOCX revisions.** It starts after W2's DOCX slice (L3) lands, or merges
main onto it. Both touch `List.ts` and `packages/docx`. It may split as B
(slices 1-2) + C (slice 3).

1. Text revisions: export `markWrappers`, ids, author, date, element merging,
   `docxAuthor`, removal of the reserved run props. Import: parser wrappers,
   `w:delText`, the TrackChanges `marks`, `rPrChange` claimed, groupId pairing,
   the no-TrackChanges fallback. Word-saved fixtures. Scenarios 1-4 and 13.
2. Block revisions: `nodeWrappers`, `DocxImports.revision`,
   `insertParagraphProperty`, paragraph-mark insert/delete/join/split, rows,
   `pPrChange` for headings, inline leaves. Scenarios 7, 8, 10, 11 and 12.
3. Moves and lists: range pairing on both sides, block move as text move,
   list `pPrChange`. Scenarios 5, 6, 9 and 14.

## Decisions

**D1–D12 were approved by the user on 2026-11-08**, as recommended below,
including the NEW pieces in D7, D8 and D12.

- **D1: Report the record id, merged by root.** *Recommended.* Pieces of one
  record merge into one entry and report the root's id. Pieces are a split
  deletion, or a block and the text it created or deleted. The root is
  `creationId ?? deletionId ?? continuesId ?? (referenceId for a reference) ??
  id`. Deciding any piece decides the act (`sameAct` in `reviewPlan.ts`),
  so the reported id always decides what the agent read. Halves of a
  replacement or a move are *not* merged: their meaning differs. `groupId` and
  `moveId` link them.
- **D2: `w:author` is the raw `authorID`, with a `docxAuthor` option.**
  *Recommended.* `TrackChanges.configure({ docxAuthor?: (authorID: string) =>
  string })` maps on export. An empty result falls back to the raw id, because
  `w:author` is required. Import reads `w:author` verbatim as `authorID`.
- **D3: Number `w:id` per export. Mint fresh ids on import.** *Recommended.*
  One counter in `ctx.shared`, starting at 1, shared by every revision element
  and range marker. On import, one fresh id per Word element, so the runs of one
  `w:ins` share a record id.
- **D4: `w:date` is `createdAt` in ISO 8601 UTC, to the second**
  (`2026-11-08T14:03:00Z`, Word's form). *Recommended.* On import, a missing or
  unparsable date becomes the import time.
- **D5: A block move is imported as a text move first.** *Recommended.*
  Paragraph-mark `moveFrom` / `moveTo` read as a deleted / inserted mark carrying
  the move's `moveId`. A whole moved paragraph becomes node `delete` + node
  `insert` with one `moveId`, one decision. It warns `docx-block-move-as-text`.
  A real block move (`moveNodeId`, identity kept) waits for a reviewer to need it.
- **D6: A hard break counts as 1 in `at`.** *Recommended.* It is `"\n"` in
  `text` and in `spans`, so offsets index the string the agent holds.
- **D7: `"suggestedAttrs"` is a new value of `SemanticChange.type`.** NEW, and
  approved (2026-11-08). An attribute or list change adds no text and removes none.
  Reporting it as `suggestedInsert` with `oldAttrs` would make "inserted text"
  mean two things, and an agent counting proposed words would count headings.
  The fallback, had it been refused: `suggestedInsert` with `text: ""`, `length` covering
  the block, and `oldAttrs` present.
- **D8: `SemanticHandlers.nodeChanges` and `SemanticPart.changes`.** NEW, and
  approved (2026-11-08). `nodeChanges` is justified in the PR A design: no existing
  contribution sees node attrs on TrackChanges' behalf. `SemanticPart.changes`
  exists because an offset is meaningful only against the text it indexes, and
  a part is what an agent edits. It mirrors `TableCell.changes`.
- **D9: A block proposed for deletion stays in `getRichBlocks`** when no live
  copy shares its id. *Recommended.* It is the only way an agent sees a
  deletion of a whole block. Move shadows stay out, as #229 decided.
- **D10: Without TrackChanges, import resolves revisions to the accepted view**
  with one diagnostic, short of joining paragraphs. *Recommended* over keeping
  deleted text live, which is what an unclaimed `del` mark would do today
  (`transform.ts:177-190` drops the mark and keeps the text).
- **D11: An adjacent `w:del`/`w:ins` pair with the same author and date imports
  as one replacement** (`groupId`). *Recommended.* That is what Word writes when
  someone types over a selection. It is what D8 makes our export write. It also
  keeps scenario 3 at one act. Different authors or dates stay separate.
- **D12: `insertParagraphProperty`, a `CT_PPr`-ordered `w:pPr` writer in core
  `exports/docx.ts`.** NEW, and approved (2026-11-08). Two contributors patch one
  `w:pPr`, and Word enforces the order (rules 1 and 2). One place knows it.
  List's `addNumPrToParagraph` (`List.ts:35-56`) moves onto it. W2's L3 rewrites
  that function, so whichever PR lands second adopts the helper.

## Risks

- **Word's strictness.** Wrong nesting (`w:ins > w:hyperlink`) or wrong
  property order can make Word refuse the file or "repair" it silently. Every
  export scenario validates the result against the schema order rules above.
  PR B adds Word-saved fixtures with revisions, opened in Word once by hand
  before merge. Today none of the 25 fixtures has any.
- **`w:delText` inside `w:moveFrom`, and `w:ins > w:del` nesting order.** The
  spec's examples are not Word's output. Confirm both against a Word-saved file
  in slice B1. Import accepts either way.
- **`w:date` time zones.** Word commonly writes local time with a `Z` suffix.
  We read it as UTC, so imported times can be off by the author's offset.
  Accepted. Dates are display-only.
- **The final paragraph of a container.** Word does not let the last paragraph
  mark of a cell or document be deleted. Inserting or deleting a last block is
  exported by marking the *preceding* paragraph's mark. On reject, the result
  takes the following paragraph's properties, as in Word. Covered by a scenario
  in slice B2.
- **Hashes change for units that already have deletions.** "Old hashes stay
  unchanged" holds only for units with **no** review changes. A unit carrying a
  `suggestedDelete` on `main` gets a new `unitRichHash` after PR A. A pinned
  `expectedContentHash` from before the upgrade then reads `stale` once. It is
  one-time, and called out in the changeset.
- **`markdown` disappears from units with pending insertions.** The walker
  omits `markdown` when `changes` is non-empty (`walkSemantic`). Today that
  means deletions only. With insertions reported, it covers any pending change.
  The alternative mixes CriticMarkup into it. Called out in the changeset.
- **An agent's review is attributed to the host user.** `reviewedByID` is the
  plugin's `userID`, not the agent's. `AiToolkit.reviewChanges` stays a thin
  pass-through, and the host decides whether agents may review at all
  (`canAcceptReject`).
- **`docxAuthor` is export-only.** An id mapped to a display name comes back
  as that name. A host that needs ids back maps them in `onImportComplete`.
- **A root id that names no record.** If the first piece of a `continuesId`
  chain was itself removed, the root names nothing, and `reviewChanges` would
  answer `missing-changes`. Slice A3 tests this. If it can happen, the merged
  entry reports its first live piece's id instead.
- **Overlap with W2.** `List.ts` (`numPr` placement, `pPrChange` for lists) and
  `packages/docx` are shared. PR B is sequenced after W2's L3. Scenario 9 is
  gated on it.
- **Header and footer parts.** Revision wrappers apply there too, because
  `walkContent` uses the same handlers. Move ranges are paired only in the body.
  Scrivr's move ops are body-only.
- **A future comments export** must draw `w:id` from the same counter. The
  counter lives in `ctx.shared` under one documented key.

## What shipped

Updated as each PR lands. Where this disagrees with the design above, this
section is what is true. Line references in the Problem section are to
`main`@288119e, before PR A.

| PR | Landed | What it changed |
|---|---|---|
| **A** | branch `feat/agents-read-tracked-changes` (not yet merged) | `SemanticChange` gained `suggestedInsert`, `suggestedAttrs`, `at`, `length`, `moveId`, `oldAttrs` and `image`. `SemanticPart` gained `changes`. `SemanticHandlers` gained `nodeChanges` and `isMarkRemoved`; `UnitCtx` gained `doc`; `semanticImage` is exported from core and `moveShadowRanges` from plugins. `extractSemantic` places every change by offset into unit, part and cell text, and merges the pieces of one act. TrackChanges reports the records in the reading table above (`track-changes/semanticChanges.ts`), each under its act's id from `changeActs` over the pending changes, reading every record field through a type check. A deleted hard break and a formatting mark proposed for removal leave the proposed view. The rich hashes cover `changes` only when there are some. `getRichBlocks` keeps every block but the copy a pending move leaves behind (D9). The auto-diff puts the document's own changes back on a returned unit, its parts and its cells before comparing. `AiToolkit.reviewChanges` passes decisions through; the playground agent reviews by id with a browser-side `review_changes` tool that returns the editor's outcome. Scenarios 10–13 (agent half) and 15–18 are covered in `plugins/.../__tests__/semanticReview.test.ts` and `ai/.../__tests__/AiToolkit.review.test.ts` |
| **B** | — | Not built. DOCX revisions |

### New public pieces beyond D7, D8 and D12

The user approved these on 2026-11-08:

- `UnitCtx.doc` — required, so code that builds a `UnitCtx` itself must supply
  it; the changeset says so.
- `SemanticChange.image`.
- The `semanticImage` export from `@scrivr/core`.

The user also approved, on 2026-11-08, two added in the second review round:

- `SemanticHandlers.isMarkRemoved` — a formatting mark proposed for removal
  has no other way off the spans.
- The `moveShadowRanges` export from `@scrivr/plugins` — the move records, not
  duplicated ids, say what is a move's left-behind copy. It shares one cached
  walk with `shadowRanges`.

NEW in the third review round, awaiting the user's approval:

- **`SemanticUnit.proposedForDeletion` and `SemanticPart.proposedForDeletion`**
  (`true` when present). Whether a block itself is proposed for deletion — not
  only its text — is the engine's fact (`proposedForDeletion` in
  `track-changes/helpers.ts`, surfaced as `isRemoved`), and nothing on a unit
  carried it. A reader that guessed it from `text` and `changes` got it wrong
  both ways: a live paragraph whose words are all struck read as deleted, and a
  deleted one holding another author's insertion read as live. The walker sets
  it from `ctx.isRemoved`; `applyRichEdit` rejects an edit to such a unit, and
  the playground stops placing blocks after one.
- `@scrivr/export-semantic` re-exports `SemanticImage` and `SemanticPart`
  (types already public from core).

### Where PR A differs from the design above

- **A change's id is its act's primary record, not a root computed from
  `creationId`/`deletionId`/`continuesId`.** It is read once per document from
  `changeActs` over the pending changes — exactly what the review plan groups —
  so ids agree however deep the act nests and in whatever order the walker
  reads it. Both halves of a replacement or a move therefore share one `id`
  (D1, as refined). `UnitCtx.doc` exists for this: an act spans nodes, so
  naming it needs the document.
- **One change per act and type.** An act's pieces merge wherever they fall.
  Its `text` is its own pieces in order, with the break between pieces from
  different blocks. An insertion's extent spans from its first piece to its
  last; a deletion sits where its first piece stood, with `length: 0`. An
  image carries from whichever piece has it. Another author's change inside it
  stays its own change. A formatting change merges only touching runs that had
  the same prior marks, so each change states its runs' marks correctly.
- **A covering insertion with no text of its own** (a moved block, a line
  break) reads the text it spans.
- **`nodeChanges` receives the `UnitCtx`**, like a node handler does, and runs
  for text nodes too, which is how formatting changes are reported.
  `SemanticNodeChange`, the `{ change, place }` pair, is exported from
  `@scrivr/core` and `@scrivr/export-semantic`.
- **`SemanticChange.image`** says which image an inserted or deleted image is,
  reusing `SemanticImage`. Each image an act adds or removes is a change of its
  own under the act's id — chosen over widening the field to a list, which would
  change an approved field's type and make one change carry several objects. A
  deleted image's unit still reads as a paragraph: the image is no longer in
  the proposed view, so the paragraph no longer is one.
- **An insertion reads what remains of it** in the proposed text; a part
  another author proposed deleting is left out of its `text`.
- **Decided records are not reported.** Text whose deletion is already decided
  stays in the proposed text, as `proposedForDeletion` reads it. Malformed
  record fields are left out rather than passed on; a former node type that
  cannot stand in for the block falls back to the block's own.
- **A formatting change's `oldAttrs.marks` is the text's marks before any
  pending formatting change on it**, so a mark both added and proposed for
  removal reads absent in both the spans and `oldAttrs`.
- **Units handed back to `applyRichEdit` are matched by the copy of their id**
  they were read as: a split or a list Enter leaves two blocks with one id.
- **`findChanges` looks operations up in a map**, so a synced record naming
  `"toString"` is an unknown operation rather than a crash on load.

### Not shipped in PR A

- Deleting text across a hard break ("b⏎c") reads as three changes, because
  the engine records three acts, and a reviewer decides three. The lane follows
  `changeActs`.

### Follow-ups

- **One gesture, one act** (engine): a single deletion across a hard break is
  recorded as three unrelated records, so a reviewer decides it three times and
  an agent reads three changes. Tracked for the track-changes engine; the
  semantic lane will read it as one change once the engine records one act.
