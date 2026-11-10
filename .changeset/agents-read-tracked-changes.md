---
"@scrivr/core": patch
"@scrivr/export-semantic": patch
"@scrivr/plugins": patch
"@scrivr/ai": patch
"@scrivr/react": patch
---

Agents read pending tracked changes and can review them.

- `SemanticChange` gains `at`, `length`, `moveId`, `oldAttrs` and `image`.
  Each change is placed by offset into the text it belongs to: `unit.text`,
  `part.text` or `cell.text`. Its `id` is the act's id, the one to pass to
  `reviewChanges`, shared by every piece of the act.
- `SemanticPart` gains `changes`. `UnitRichInput.changes` and
  `SemanticPartRichInput.changes` carry them into the rich hashes.
- `SemanticUnit` and `SemanticPart` gain `proposedForDeletion: true` when the
  block itself — not only its text — is proposed for deletion. Such a unit
  cannot be edited (`applyRichEdit` rejects it) or placed after.
- `@scrivr/export-semantic` re-exports `SemanticImage` and `SemanticPart`.
- `SemanticHandlers` gains `nodeChanges`, which runs for every node, text
  included: it reports records on a block's own attrs and on a text node's
  formatting marks, returning `SemanticNodeChange[]` (exported from
  `@scrivr/core` and `@scrivr/export-semantic`). It also gains
  `isMarkRemoved`, so a formatting mark proposed for removal is left off the
  proposed spans.
- `UnitCtx` gains `doc`, the document being read. **It is required:** code
  that builds a `UnitCtx` itself, such as a mock in a handler test, must now
  supply it.
- `semanticImage(node)` is exported from `@scrivr/core`; `moveShadowRanges(doc)`
  from `@scrivr/plugins`.
- TrackChanges reports pending insertions, deletions (including line breaks),
  block insertions and deletions, paragraph joins and splits, heading, list and
  formatting changes, wrapped and structurally moved nodes, table rows and
  moves. An act reads as one change per type: a replacement or a move is its
  two halves under one id, a formatting change over text with different
  prior marks is one change per run, and each image an act adds or removes is
  a change of its own — all under the act's id. An insertion reads what
  remains of it in the proposed text. Text whose deletion is already decided
  stays in the proposed text, as `proposedForDeletion` reads it.
- A tracked record naming an operation the engine does not know — including
  one like `"toString"` from a synced document — is read as an unknown
  operation instead of breaking `findChanges`.
- `ai.reviewChanges(decisions)` accepts or rejects changes by the ids an agent
  read, returning the `ReviewOutcome` type from `@scrivr/plugins`. It is a
  pass-through to `reviewChanges`, so the host's `canAcceptReject` still
  decides whether an agent may review.

**`SemanticChange.type` gains two members**, `suggestedInsert` and
`suggestedAttrs`. An exhaustive `switch` on it, or code that assumed every
change is a deletion, must handle both.

One-time changes to watch for:

- **Hashes change once for any unit with a pending change.** `unitRichHash` and
  `semanticPartRichHash` now cover `changes` when there are any. A unit with
  none hashes exactly as before. An `expectedContentHash` pinned before the
  upgrade on a unit with any pending change reads `stale` once.
- **Change ids stored before the upgrade can change.** `SemanticChange.id` is
  now the act's id: both halves of a replacement or a move, and every piece of
  a block act, report one id.
- **A block proposed for deletion now appears in `getRichBlocks`,** reading
  `text: ""` with its deletion in `changes`. Only the copy a pending move
  leaves behind stays out.
- **A deleted hard break, and a formatting mark proposed for removal, leave the
  proposed view,** where they used to read as present.
- **`markdown` is omitted on units with any pending change,** not only those
  with pending deletions.
- **Block ids are now unique after a split.** `UniqueId` gives the block an
  edit creates — a split's new half, a list Enter's new item, a pasted copy
  (rules and page breaks included) — a fresh id when another block already
  carries its id. The copy holding the block's first words keeps it: Enter at
  the start of a paragraph or a list item makes the empty one before it the
  new block. Only the
  author's client assigns it; a change arriving through sync is never
  re-keyed, and undo and redo never rename. A pending move's two copies still
  share their id. A tracked cut pasted elsewhere is a move, as Word tracks it,
  so a pasted block the cut took whole keeps its id (approved by the user,
  2026-11-09). A pasted copy of a block that is still in place is not that
  cut, even when it reads the same.
  Documents saved with duplicates keep them; edits never repair them.
- **An agent's edit to a block proposed for deletion is rejected.**
  `findLiveNodeById` returns `null` for an id two live blocks carry, so every
  write that resolves an id through it — the agent's edits and structural ops,
  ghost text, suggestions, image layout — refuses that id rather than acting
  on the first copy. That can happen in a document saved with duplicates, or
  after concurrent cut-and-paste of one block in collaboration.
- `blockIdOf(node)` is exported from `@scrivr/core` (approved by the user,
  2026-11-09): the one answer to which nodes carry a block id. An empty
  `nodeId` counts as none, so `UniqueId` now stamps it as it stamps `null`.
- `ReferenceAttrs` gains `originalNodeId`, the id the block had when a tracked
  split was made. Rejecting the split gives the rejoined block that id back.
- **Track changes marks its own recording transaction `NORMALIZATION_META`,**
  as bookkeeping nobody authored.
- **A tracked Enter in a list item is recorded as a split** of the item and
  its paragraph, as Enter in a paragraph is, no longer as an inserted item.
  Rejecting it joins both levels back under the ids they had (user decision,
  2026-11-09). Which half of a split keeps its ids is core's rule in either
  order of registering `UniqueId` and `TrackChanges`: `planDuplicateIdAssignments`
  is exported from `@scrivr/core` for it (approved by the user, 2026-11-09).
- Deleting the moved copy of a pending move proposes its deletion and drops
  its move record. Before, the move record was stripped from whatever block
  then sat at the copy's old place: the block after it lost its id, level and
  records, or, with nothing after it, the deletion threw.
- An agent's reply is diffed against the proposed view it read: another
  author's pending formatting removal stays theirs, and a pending deleted line
  break no longer turns a small edit into a rewrite of the block.
- An inserted, deleted or moved empty line — a new empty list item or
  paragraph — is marked on the canvas again. The caret's zero-width glyph on
  the line counted as text, so it was left unmarked.
- Review cards and the change popover name a block added or removed by what
  it is — "List item added", "Paragraph added", "Image removed" — instead of
  "Block added", and leave out the preview line of a block with no words.
  `ChangePopoverInfo.nodeTypeName` (new) says which block a node change is on,
  so a host can name it too (asked for by the user, 2026-11-09).
- An attribute change reads its values in words on cards and in the popover:
  an object value is spelled out (`x 0, y 48`), never `[object Object]`, and an
  equal value written anew is not listed. `describeAttrChanges` and
  `changedAttrKeys` (new, `@scrivr/plugins`) are that one description, shared
  by the popover and the panel. An image whose older `floatOffset` changed
  with its `yOffset` reads as moved: `IMAGE_PLACEMENT_ATTRS` includes
  `floatOffset`.
- Deleting what you added yourself takes it back out, as Word does: Backspace
  on a list item you added with Enter, or Delete from the item above it, joins
  it back and leaves no change, as it already did for a paragraph. The caret
  stays in the line it was in. An image or horizontal line you added and then
  delete leaves no change either.
- `editor.getMarkdown()` no longer throws on a document with formatting
  Markdown cannot write — a colour, a font size, a tracked change. That text
  keeps its words and drops only the formatting.
