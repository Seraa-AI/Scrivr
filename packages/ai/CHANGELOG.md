# @scrivr/ai

## 1.0.23

### Patch Changes

- 31a013e: Agents can read the document as originally agreed, and structural edits know
  when what they name has changed.

  - **The original view.** `toSemanticUnits(editor, { view: "original" })` and
    `ai.getRichBlocks({ view: "original" })` read the document as it was before
    every pending proposal — what rejecting all of them would leave, computed by
    TrackChanges' own Reject on a copy. Its units say `view: "original"` and carry
    no `changes`. `SemanticTextView` is now `"proposed" | "original"`, and
    `SemanticHandlers` gains `documentIn(doc, view)`.
  - **Only the proposed view is editable.** `applyRichEdit` reports a unit read in
    another view under the new `wrongView` list and writes nothing for it. A unit
    hash covers its view when it is not the proposed one; proposed hashes are
    unchanged.
  - **Structural ops carry hashes.** `expectedContentHash` on an op's own block
    and `anchorContentHash` on its anchor; a mismatch is reported in `stale` and
    nothing is written. `applySemanticEdits` returns `SemanticEditResult`, which
    adds `alreadyProposed` (a delete whose block another author already proposed
    for deletion) and `anchorProposedForDeletion` (an anchor that disappears on
    Accept). Both were refused before, inside `rejected`. Hashes are judged
    against the units `getRichBlocks` hands out; an id the document does not hold
    is `notFound`, not `stale`.
  - `@scrivr/export-semantic` exports `resolveNodeId`, the id rule units are
    keyed by; `@scrivr/plugins` exports `originalDocument(doc)`, the original
    document with the mapping into it.

- 4657757: Agents read pending tracked changes and can review them.

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
  - **An id two live blocks carry is refused.**
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
    Markdown cannot write: a colour or a font size is dropped and its words
    kept. With TrackChanges installed, a pending change is written as
    CriticMarkup.

- 288119e: An agent edits like a person: it moves blocks, list items, headings and images,
  its rewrites land as the phrases a person would change, and every edit is a
  tracked suggestion a reviewer decides in one click.

  **Agents — what they can do**

  - `moveBlock` and `moveListItem` join `StructuralSemanticEditSchema`: an agent
    reorders a document by naming a node and an anchor. `moveListItem` takes an
    item id or a leaf inside it, and refuses a cross-list move before writing any
    steps. The engine pairs the delete-at-old and insert-at-new into one
    `CHANGE_OPERATION.move`, accepted or rejected as one decision.
  - A heading's level is set with `richText` `attrs.level`: 1–6 on a heading
    changes its level and on a paragraph makes it a heading; 0 makes a heading a
    paragraph. It is tracked with the old type, so rejecting it restores the block.
  - Images go through the protocol an agent already has. A paragraph holding one
    image is an `image` unit carrying `image` (`src`, `alt`, `width`, `height`,
    `wrap`, `align`); `insertBlock` adds one with `block.type: "image"` (`src`
    must pass `safeImageUrl`); `richText` `attrs`, or the unit handed back with its
    `image` edited, change `wrap`, `align`, size or `alt`; `deleteBlock` removes
    it. Only the fields that change are checked, so an image placed by drag
    (`align: "custom"`) can be handed back untouched. A new `src`, paragraph
    styling on an image unit, and invalid values are rejected. Setting `wrap` or
    `align` on an image laid out by the legacy `wrappingMode` takes effect.
  - Every edit an agent makes is its suggestion: with TrackChanges installed,
    `applySemanticEdits` tracks text, image and structural edits as `authorID`'s
    (default "AI Assistant") whether or not the person is suggesting.
  - The result says what happened. An edit that changes nothing — the level a
    heading already has, attrs an agent may not set, an image layout it already
    has, a move to where the block already is — is `rejected`, never `changed`
    and never silently dropped. An edit is taken whole or not at all: attrs it
    cannot apply refuse its text too. Restating the original to withdraw the
    agent's own earlier suggestion is a change.
  - A batch touches content once. A move or delete overlapping content the batch
    already moved or added to, or adding an item or row inside content it moved,
    is refused; so is a list or table op named by a node holding several of what
    it acts on, such as a nested list.
  - `getRichBlocks(from, to)` keeps image units inside the range.

  **Rewrites read as a person's edit**

  - `applyDiffAsSuggestion` and `applyRichDiffAsSuggestion`, for any caller, turn
    a rewrite into phrase replacements: each run of changes is one deletion and
    one insertion, a short unchanged gap inside a replacement is taken in, and no
    change is made inside a word. A gap holding a line break, a newline, an
    inline image, formatting or another author's suggestion is never taken in,
    and words added near each other stay additions.
  - A replacement is decided as one. Its two halves share a `groupId` nothing
    else carries, from this diff or any other, and accepting or rejecting either
    half — through a card,
    `setChangeStatuses`, `reviewChanges` or accept-at-caret — decides both.
  - The AI suggestion overlay groups the same way, so a proposal reads the same
    before it is applied as after. `phraseReplacements` and `bridgeable` are
    exported from `@scrivr/plugins` for hosts that build their own diffs;
    `pairReplacements` stays for word-pair grouping.

  **Resolving ids in a tracked document**

  - A pending move leaves a deleted shadow and a live copy with the same `nodeId`.
    `findLiveNodeById` in `@scrivr/plugins` decides which is live, and every
    consumer uses it — rich and structural edits, drift detection, suggestion
    overlays and popovers, ghost text, streamed insertion, block markers and
    citation reveal. Writing into a shadow used to succeed and then vanish when
    the deletion was accepted. `@scrivr/ai` re-exports it beside `findNodeById`.
  - `findNodeById` in `@scrivr/core` takes an optional `accept` predicate and
    returns the first match that satisfies it. It used to return the last match.
  - `shadowRanges`, `isShadowNode` and `ShadowRange` are exported for a host
    resolving ids itself. The ranges are memoised per document.
  - **Hosts:** a helper that takes the first node with a `nodeId`
    reads the shadow of a block moved down. Switch it to `findLiveNodeById`.

  **Tracking**

  - A deletion pairs with an insertion as a move only when they match, by content
    and by id. Two blocks that only read the same — two empty paragraphs, a
    `deleteBlock` beside an `insertBlock` of the same text — are a deletion and an
    insertion.
  - Rejecting a block added after a list or table, together with a later move, no
    longer deletes the list's text; deleting a paragraph while typing its words
    elsewhere in one transaction no longer errors.

  **Review surfaces**

  - Moves read as moves: double-underlined where the content went and
    double-struck where it was, in one move colour (`renderTrackedMove`).
  - A table row added or removed is washed and framed as a row, dashed when
    removed (`renderTrackedRow`). With the caret anywhere in it, the popover
    offers the row: "Accept row", "Reject row", previewed as "Adding row:
    Headset · On request · Yes".
  - `changePreviewText(doc, change, pending)` previews a block change as it will
    read, and a move once, by where it went; the popover and the panel both use
    it. A move's card reads "Moving".

  **Semantic view**

  - A semantic contribution can name what the proposed view leaves out
    (`isRemoved`). Track changes supplies `proposedForDeletion`, exported, so an
    image proposed for deletion is not read as present, and a paragraph whose
    other text is proposed for deletion reads as its image. **Breaking** for a
    hand-built `UnitCtx`: `isRemoved` is a required member.
  - An image unit's rich hash covers its `image`, so an edited image is seen as
    changed. Other units' hashes are unchanged.
  - Core names the image values: `ImageWrap`, `ImageAlign`, `IMAGE_WRAPS`,
    `IMAGE_ALIGNS` and `IMAGE_NODE_ATTRS`, with `SemanticImage`;
    `SemanticImageAttrsSchema` in `@scrivr/ai` is built from them.

  **Markdown**

  - `getMarkdown()` writes pending changes as CriticMarkup — `{++added++}`,
    `{--removed--}` — instead of throwing.
  - Pasting a markdown table, or loading markdown that holds one, makes a table,
    with the header row as header cells.

- 1a5936d: `@scrivr/ai` exports the types of what `applySemanticEdits` returns
  (`SemanticEditResult`) and what `getRichBlocks` takes (`RichBlocksOptions`).
- f72a5b3: Any inline node can float: its spec declares `anchored: { read, write }` and
  the engine places, wraps, hits, drags, resizes and exports it as it does an
  image, writing every placement change through `write`. Images behave exactly
  as before.

  - `anchoredOf(node)`, `floats(node)`, `placementAttrs(node, patch)`,
    `AnchoredPlacement`, `AnchoredSpec` and `PlacementPatch` are new;
    `isXAlignValue` is exported. A node that declares a placement is laid out at
    the size it declares.
  - `addPasteFiles()` declares which pasted files become which nodes
    (`PasteFileSpec`, `PasteFileHandler`); `ExtensionManager.buildPasteFiles()`
    and the `pasteFiles` option of `PasteTransformer` carry them.
  - `addExports().pdf.embeds` (`PdfEmbedSource`) declares where a node's
    embedded file lives.
  - A later-registered extension takes a pasted file first, and
    `normalizeDocument`'s new `pasteFiles` option sweeps any extension's
    orphaned placeholder.
  - An agent's image layout is written through the node's declaration.

  **Breaking:**

  - `normalizeImageAttrs` and `NormalizedImageAttrs` are removed: read a node's
    placement with `anchoredOf` (`AnchoredPlacement`).
  - `Editor.convertImageToInlineAtVisualPosition(docPos)` is now
    `placeInlineAtVisualPosition(docPos)`, for any anchored node.
  - `dropPendingPlaceholders(doc, isPending)` takes the predicate;
    `normalizeDocument` sweeps placeholders only for the `pasteFiles` it is
    given (the editors pass theirs).
  - A `PasteTransformer` built without `pasteFiles` inserts no pasted files;
    `Editor` passes them.
  - `ResolvedExtension.pasteFiles` is required: a hand-built resolved extension
    passes `{}`.

- 31a013e: Three asks from hosts building their own review UI on suggestions.

  - **Turn off the change colours.** `TrackChanges.configure({ renderMode: "none" })`
    paints no tracked changes on the canvas; they are still recorded, reviewed
    and exported. `AiToolkit.configure({ aiSuggestion: { renderMode: "none" } })`
    passes the suggestion overlay's options through; `aiSuggestion: false` still
    leaves it out.
  - **A suggestion keeps its author.** `computeAiSuggestion` puts the `authorID`
    it is given on the suggestion, and applying it records text and formatting
    changes by that author. Before, every applied suggestion was by
    `"ai:assistant"` whatever author it was computed for.
  - **Hard breaks survive an agent's rich edit.** A `"\n"` an agent writes in a
    rich edit is the block's line break, as the semantic export reads one:
    `spansToFragment` builds the schema's line-break node (a newline in a code
    block, a space where the schema has none), and `applyRichDiffAsSuggestion`
    records it like any insert. One insertion is one change, breaks included, and
    restating the original withdraws it. Before, an added break became a space.
    The plain-text lanes (`applyDiffAsSuggestion`, `insertAsSuggestion`, AI
    suggestion apply) read a block without its breaks, so they still write
    `"\n"` as a space.
  - **Formatting survives a paste in suggestion mode.** Adjacent runs with
    different formatting no longer merge under the first run's marks
    (`equalMarks` compared a node with itself).

- a395c98: Track changes keeps its boundaries: editing content that already holds
  suggestions no longer destroys authorship, selection, or unrelated decisions.

  **Core**

  - `editor.commands.*` and `runCommand` return whether the command ran, instead
    of `void`. A read-only editor returns `false`. **Breaking** for an
    `IBaseEditor` double: its `runCommand` must return a boolean.
  - A node's `marks` restriction now limits formatting only. Review marks are
    admitted wherever track changes is installed, so edits inside a code block
    are tracked like any other text.
  - `NORMALIZATION_META` marks an edit that keeps the document well-formed rather
    than changing it. `UniqueId`, `TrailingNode` and the table normalizer set it,
    so ids, trailing paragraphs and table repairs are never recorded as anyone's
    suggestion.
  - `TrailingNode` takes away the empty paragraph it added once the document ends
    in a paragraph again, unless someone typed in it or put the caret in it.
  - Cut and paste mark their transactions `uiEvent: "cut"` and `uiEvent: "paste"`,
    so a plugin can tell them from deleting and typing.
  - `renderTrackedObject` frames an image, rule or other object a change covers;
    `renderTrackedFormatting` washes text whose formatting changed.
    `TrailingNode`, `Typography` and `IMAGE_PLACEMENT_ATTRS` are exported.
  - The overlay repaints after every content repaint, so overlay marks drawn over
    a freshly painted tile no longer go missing.

  **Track changes**

  - Deleting pending work cancels it only when it is entirely your own. Deleting
    someone else's insertion keeps it and records your deletion beside it, for
    text and whole nodes alike.
  - An edit is linked to the act it belongs to, decided where its record lands.
    Your edits inside your own pending insertion fold into it (`creationId`).
    Another author's depend on it (`dependsOn`, closed by `foldingClosed`). A
    deletion recorded on a node and on the text inside is one change
    (`deletionId`), and so is a record split by later typing or a paragraph break
    (`continuesId`, with a unique id per span).
  - `changeActs` is the one answer to what a decision covers: it groups records
    into acts, each with a `primary` to show and name. Deciding any record of an
    act decides all of it, so a whole-paragraph change can be decided from its
    node or its text, and a paragraph break from either of its halves.
  - Later steps inside what the same gesture inserted are now part of that
    insertion, so inserting a block and typing in it no longer loses the typing. A
    step that writes both inside and outside an insertion is split at its edge
    where it can be (otherwise it is refused): inside, it takes back your own
    text; outside, it proposes deleting what was there.
  - Every tracker writes through the replay, so a gesture mixing formatting or
    attribute changes with a position-shifting step records them on the right text.
  - Formatting across someone else's insertion no longer spreads that insertion
    over the text beside it, which made rejecting it delete real words.
  - A decision is its own undo step. Undoing an accept brings the change back to
    pending instead of also removing the edit.
  - Rejecting a move takes the content back with the edits made since. Work done
    on the moved-from shadow keeps its own record and must be explicitly reviewed
    before either accepting or rejecting the move consumes that shadow.
  - Review is planned before it runs. `planChangeReview`, `planReviewIn` and
    `planReview` preview a decision; `reviewChanges` carries it out and returns
    what happened. A decision is `ReviewDecisions` — `{ accepted, rejected }` —
    so resolving a conflict is a single decision. Dependent work is never decided
    silently. A refusal names its reason: `dependent-changes`, `missing-changes`,
    `contradictory-decisions`, `not-permitted`, `read-only` or `invalid-result`.
  - Before publishing, review validates the content it rewrote and checks that
    selected identities were settled and unselected pending identities survived.
    Unrelated invalid content does not block the decision.
  - **Changed:** the low-level `setChangeStatuses` action payload is now
    `ReviewDecisions` instead of `{ status, ids }`.
  - **Changed:** the `setChangeStatuses` command keeps its signature, but returns
    `false` and decides nothing when the plan is blocked, including when other work
    depends on the change. A host ignoring the result sees a click that does
    nothing; use `reviewChanges` to learn why.
  - An edit tracking cannot represent is stopped before it applies, so someone
    suggesting never changes the text directly. `onRefused` on
    `TrackChanges.configure` receives the reason (`overlapping-steps`,
    `unsupported-step`, `duplicate-transform-package`) so the host can say why.
    Gestures of more than 20 steps used to be partly untracked and are now
    tracked in full. `lastReview` reports the last decision.
  - Nothing can be edited while viewing a snapshot of the changes.
  - Deleting a paragraph break is a change of its own, `node_join`: the
    paragraphs stay apart until it is accepted. Deleting a break you added
    yourself takes it back instead.
  - Moving paragraphs into, out of or between lists is a change to each
    paragraph's place, `list_change`, kept as `oldList`; rejecting it rebuilds the
    lists around it.
  - Moved content is one change: a drag of text, or a cut pasted back by the same
    author while the cut is still pending, links its deletion and insertion with
    `moveId`, and deciding either decides both. Dragging a block, several blocks
    at once, or a floating image alone in its paragraph is one move too. Undoing
    the paste and pasting again is still the move.
  - Pasted paragraphs are recorded as inserted, not as a paragraph break, so
    rejecting a paste removes it. Enter at the end of a paragraph records the new
    paragraph as inserted.
  - Reviewing a formatting change keeps the mark's value, so colour, size and
    link changes can be accepted and rejected. Neighbouring pieces of one
    formatting change by the same author are one card, decided together.
  - Changed objects are framed. Formatting changes are washed and barred in the
    margin, as Word marks them, instead of looking like an insertion or a deletion.
  - A collaborator's edit arriving through Scrivr's own sync is never recorded as
    the local author's suggestion.
  - Accepting a deleted break between list items names any change recorded on the
    item it joins as dependent work, instead of failing; `joinsAt` on the change
    says where the joined block starts.
  - Selection survives tracking: a range stays a range in its direction, and the
    caret lands where the gesture left it, through every step of a multi-step
    gesture.
  - `TrackChangesState`, `TrackingResult` and `TrackingRefusal` name what a host
    reads from `trackChangesPluginKey`.
  - `CHANGE_OPERATION` gains `node_join` and `list_change`, with `ListLevel` naming
    an entry of a list change's `oldList`. A host that switches on the operation
    should name them.

  **React**

  - Every Accept and Reject in the panel and popovers goes through
    `useReviewAction`. A click either completes, or `ReviewRefusalNotice` says
    what stopped it on the surface that was clicked. Dependent work is listed and
    needs a second confirmation that replans first.
  - Conflict resolution ("Keep insertion" / "Keep deletion") is one decision and
    one undo step.
  - `useTrackChangesPanel` gives each act one card, in `items`, with its records in
    `pieces`; its `review` is the card's `useReviewAction`, and `accept`, `reject`,
    `acceptAll` and `rejectAll` return the outcome. The panel's badge counts cards.
    It takes any `IBaseEditor`, and `TrackChangesDisplayItem` names an item's type.
  - Changes are named from one table, in the panel and the popover alike:
    "Paragraph break added" and "removed", "List changed", "Moved", and "Image
    moved" for an image dragged on its page. `ChangePopoverInfo.moveId` marks
    either half of a move.
  - `describeSuggestionRefusal` gives the message and remedy, as
    `SuggestionRefusalText`, for a refusal passed to `onRefused`.

- Updated dependencies [31a013e]
- Updated dependencies [4657757]
- Updated dependencies [288119e]
- Updated dependencies [e40e3d9]
- Updated dependencies [a9e05e0]
- Updated dependencies [5603fff]
- Updated dependencies [aec0e05]
- Updated dependencies [189b6fa]
- Updated dependencies [6330e0a]
- Updated dependencies [f72a5b3]
- Updated dependencies [5287a8d]
- Updated dependencies [544d74e]
- Updated dependencies [fb180bb]
- Updated dependencies [3d45744]
- Updated dependencies [07b6e41]
- Updated dependencies [f72a5b3]
- Updated dependencies [01cc927]
- Updated dependencies [31a013e]
- Updated dependencies [7aca935]
- Updated dependencies [a395c98]
- Updated dependencies [ba07451]
- Updated dependencies [22fb8f1]
  - @scrivr/core@1.0.23
  - @scrivr/export-semantic@1.0.23
  - @scrivr/plugins@1.0.23

## 1.0.22

### Patch Changes

- 27a85a2: `acceptedTextMapFor` — the accepted-text map, memoised on the block node.

  Building it walks every inline child of a block, and the AI suggestion overlay
  asked for one per suggested block, per page, on every paint frame. At the
  default `renderMode: "active-only"` that is one block, which is why this never
  bit; at `renderMode: "all"` on a long document it is a full inline walk per
  block at the frame rate.

  A ProseMirror node is immutable, so the node reference is the invalidation
  signal — an edit produces a different node and misses the cache on its own,
  with no staleness flag to keep in step. The node's position is compared too,
  because the map holds absolute document positions: a block nobody touched that
  text was inserted in front of needs a fresh one.

  The suggestion overlay, the suggestion popover and the drift pass read through
  it. `buildAcceptedTextMap` is unchanged and still exported — it is the pure
  function the memo wraps, and what the tests compare against.

- 44e6423: Two things the AI review surface could not express.

  **A marker that proposes no edit.** A finding can be a Pass, or a decision a
  person has to make. `computeAiSuggestion` drops a block whose proposed text
  matches what is already there, which is correct — a diff overlay is not where a
  finding with no change belongs — and there was no other layer, so such a
  finding existed in the panel and nowhere the reader was looking.

  `BlockMarkers` is that layer. `setBlockMarkers(editor, source, markers)` hangs
  `{ nodeId, kind, summary }` on a block, `getBlockMarkers` reads them,
  `activeBlockMarkers` answers the ones on the innermost marked block holding the
  cursor, and `createBlockMarkerOverlay` — with `useBlockMarkerOverlay` in
  `@scrivr/react` — gives them the show / move / hide lifecycle the suggestion
  popover has.

  Every call names its writer, which is what makes the layer additive: several
  bridges write to the same surface and none owns it, so a writer replaces and
  clears its own markers without erasing what the others say. Nothing is written
  to the document and nothing enters history. A marker whose block has left the
  document is dropped on read, and markers resolve in one pass over the document
  rather than one walk each. `BLOCK_MARKERS_SET` is public, so a payload whose
  markers are not markers is refused whole rather than half-applied.

  **Accepting a span rather than a block.** `accept(blockId)` applied every op the
  block carried, so a finding scoped to one sentence rewrote the clause around it.
  `applyAiSuggestion` now takes `range`, and `actions.acceptRange(blockId, range,
mode?)` exposes it. It returns whether it wrote, so a refusal is visible instead
  of silent — including through `AiToolkit.apply`.

  `range` carries the accepted text its offsets were measured against, and is
  refused unless the block still holds that text. This is the part that makes a
  scoped accept safe: settling rewrites a block's `acceptedText`, so comparing the
  document against it proves nothing, and a caller still holding offsets from
  before an earlier accept would edit whichever words now sit at those numbers.
  Also refused: a span that is inverted, collapsed, or reaches outside the block.

  Only groups the span covers are applied; one it merely clips is left pending. A
  pure insertion is zero-width, so it belongs to the single span that starts at or
  before its point and ends strictly after — otherwise both neighbouring sentences
  claimed it. Every covered group is applied in one pass and settled as one set:
  `rebaseAfterSettle` now takes the set of settled groups, because told one at a
  time it read the pass's own writes as reader drift and discarded the groups the
  span deliberately left pending.

  **`docRangeToAcceptedRange`** (`@scrivr/plugins`) converts a document range to
  the accepted-text offsets `range` wants. Only the forward direction existed, and
  accepted text omits runs pending deletion, so arithmetic on document positions
  was wrong in exactly the tracked-changes documents this serves — and wrong
  silently.

  **Drift has one owner, and it is no longer silent.** `staleBlockIds` had two
  production readers — the card's `isStale` and the canvas overlay, which dims a
  stale block — and no writer at all, so both read false for every block forever.
  The plugin now computes it whenever the answer can change: a new suggestion (a
  host can hand over one that was already out of date), a settled one (the rebase
  refreshes each surviving block against the document the settlement left), or an
  edit. Identical answers return the previous state unchanged, so the card
  subscription's identity skip still holds.

  Every accept path reads it and refuses a block the reader has edited since the
  proposal was computed — the unscoped block accept, a group accept, and accept-all
  as well as the new span accept. Previously only the span accept checked, so one
  card had a button that refused and a button that wrote the model's words into
  text that had moved: `"The quick fox"` edited to `"!The quick fox"` and then
  accepted produced `"!Theslowk fox"`. Accept-all still applies the blocks that do
  match and leaves the drifted ones pending, because an edit in one block says
  nothing about the rest.

  `AiSuggestionCardActions` gains a required `acceptRange`, so a hand-written
  implementation of that interface needs the new member. `applyAiSuggestion` and
  `AiToolkit.apply` returning `boolean` instead of `void` is a widening and breaks
  no caller.

- 297dba9: An AI suggestion can now be about how the text reads, not only what it says.

  `computeAiSuggestion` takes `proposedSpans` alongside `proposedText`. Plain text
  is the narrow case of the same thing — a proposal that says nothing about
  formatting, which is the same statement as "no marks" — so there is one path,
  not two. `AiOp` carries the marks of the run it proposes, and an op whose
  formatting changes partway is split so that an op always reads one way.

  Two things this makes possible that were not expressible before. A proposal can
  be about formatting alone, where the wording is untouched: every op is a `keep`,
  so the change is found by comparing the formatting the block would end up with
  against the formatting it has, and applying it sets the marks on the kept run —
  adding what the proposal asks for, removing what it drops, and leaving
  tracked-change marks alone because those describe review state rather than how
  the text reads. And an accepted insertion now lands with its marks, so a
  suggested bold term is bold once accepted instead of quietly flattening.

  Formatting is applied in its own transaction before any text moves, so every
  range resolves against the document the suggestion was computed from. Tracked
  mode leaves that transaction tracked — a formatting change has its own tracked
  representation, and the engine builds it from an ordinary mark step, so a
  reviewer rejects proposed formatting exactly as they reject proposed words.
  Writing it inside the skip-tracked transaction would have made it permanent and
  unreviewable, which is the one thing the tracked lane exists to prevent.

  Accepting a single replacement group applies no formatting at all. A keep's
  marks describe the whole block, and applying them removes what the proposal
  omits — so doing that for one group would strip the reader's own formatting from
  text that group never spoke about.

  Agent-supplied marks on retained text go through `resolveInlineMark`, the same
  seam inserted text already used. Retained text is not a softer target: a
  `javascript:` href was being sanitized on an inserted run and written on a kept
  one, and a `link` sent without its required `href` threw out of the accept.

  Marks are compared attrs-aware and order-insensitively. Document marks arrive in
  schema order and an agent emits them in whatever order it wrote them, so a
  literal comparison would read a reordered `[bold, italic]` as a change, and a
  link whose `href` the proposal restates would read as one too.

  `proposedSpans` takes the protocol's own inline runs, so `parseSemanticEdits`
  output feeds `computeAiSuggestion` directly. The package publishes one vocabulary
  for inline runs and every public entry point speaks it; a consumer holding
  validated agent output should not have to convert between two spellings of the
  same thing, least of all in a repo that gives it no `as` to do it with.

  `applyRichEdit` and `applySemanticEdits` no longer accept `asSuggestion`. It was
  declared on both and read by neither, so `asSuggestion: false` returned
  `applied: true` having applied a tracked suggestion — the opposite of what the
  caller asked for. Both always apply as suggestions, which is what an agent's
  edit is; applying agent output straight into the document is the existing
  `applyAiSuggestion({ mode: "direct" })` lane.

- 297dba9: The AI edit protocol can now change a document's shape, and every node can say
  what happened to it.

  `applySemanticEdits` handles the six structural ops — `insertBlock`,
  `deleteBlock`, `insertListItem`, `deleteListItem`, `insertTableRow`,
  `deleteTableRow` — alongside the inline `richText` edits it already took. Each
  addresses the document through a `nodeId` the agent was shown plus a side:
  "an item after this one", never an index or a document position. An id may name
  a container or the leaf inside it, and ops that act on a container climb to it,
  because the agent sees leaves.

  Nothing in the adapter marks a change as tracked. The engine already tracks the
  transactions it sees, so an op's whole job is to resolve an anchor and build a
  node; a structural batch is one transaction, and so one undo step and one review
  unit.

  **Every node now declares `dataTracked`.** It was on paragraphs, headings, code
  blocks and lists, and missing from tables, images, horizontal rules, page breaks,
  section breaks and hard breaks. A node without it is not rejected by the
  engine — it is skipped, and the change is either attributed to a neighbour or
  lost outright. Two consequences were live: inserting an image recorded no change
  at all, and accepting a suggested table-row deletion left the row behind, empty,
  because only the text inside it had been marked. A schema test now fails if a
  node is added without it.

  `insertBlock` and `deleteBlock` act on the document's own flow and now refuse an
  id that resolves inside a list or a table. They used to climb to the top-level
  ancestor, so `deleteBlock` on a list item's paragraph — the natural way to say
  "remove this clause", since the agent is shown leaves — marked the entire list
  deleted and reported success. `deleteListItem` and `deleteTableRow` are how
  those are reached.

  Attributes an agent supplies pass the same gate the rich lane already applies,
  now shared rather than re-derived. An open `attrs` record reaching the document
  let agent output write `nodeId` — colliding with the ids the protocol addresses
  by — and `dataTracked`, forging a review history.

  `deleteTableRow` names its target `nodeId`, matching `deleteBlock` and
  `deleteListItem`. It was `anchorNodeId`, and everywhere else in this protocol an
  anchor is a neighbour you position against rather than the thing being acted on —
  an agent reading the three delete ops together would reasonably have concluded it
  deleted the row beside the one it named.

  **Breaking:** `parseRichEdits` is `parseSemanticEdits` and validates the whole
  protocol rather than the inline half — a structural edit fed to the old name was
  rejected as malformed. `applySemanticEdits` no longer returns `unsupported`. The
  field could never be populated: the union it guarded had one member, and now the
  schema itself refuses an op it does not define, by name, at parse time. A caller
  reads `rejected` from the parse instead.

- cc42506: A diff op now says where in the proposal it came from, and the ops reconstruct
  the proposal they were built from.

  `pairReplacements` emits deletes first so a consumer clears a whole deleted
  range before writing its replacement — that is what keeps document-side offsets
  correct, and it stays. What follows consumes the proposal, and is now emitted in
  the proposal's own order. Absorbing a keep that sits inside a replacement turns
  it into a re-insert, and that re-insert can belong _before_ a boundary keep:
  rewriting "alpha beta gamma delta" to "beta delta epsilon" moved "beta" behind
  "delta" and applied as " deltabeta epsilon". The ops described something the
  proposal never said.

  Each op that consumes the proposal carries `proposedOffset`, stamped where the
  order still is the proposal's own. A consumer counting as it walks cannot
  recover it, because the order it walks is the document's — which is how an
  agent's bold landed on a word it never named.

  Text that did not change is one keep, however long. The quadratic guard answered
  "delete everything, insert everything" for two identical strings, so a
  formatting proposal on a paragraph over ~450 characters — ordinary in a
  contract — rewrote every character to change none of them, taking comment
  anchors and existing tracked marks with it.

  Generated group ids carry their block. They were an index into one block's ops,
  so two paragraphs with a change at the same position shared an id, and settling
  one settled the other.

  Settling one group re-expresses what is left of the proposal against the
  document that group left behind — but only when that document is the one the
  settlement produced. If it moved for any other reason, the reader typed or a
  collaborator edited, the remaining ops describe text that is no longer there and
  rebuilding from them proposes putting it back: the reader's own edit returns as
  a suggested deletion, wearing a refreshed `acceptedText` that makes it look
  current. Nothing can map an intent through an edit it never saw, so the proposal
  is spent and the block is dropped. The reader asks again. A suggestion's ops are offsets into the block's
  text as it was when the suggestion was computed, so accepting or rejecting one
  group invalidated every remaining op: the next accept landed on the wrong
  characters, or past the end of the old text, where it silently did nothing —
  accept a rewrite, then accept the formatting alongside it, and the formatting
  never arrived.

  Marking a group settled and stepping over it does not fix that, because the
  offsets are still the old ones. So there is no settled-group bookkeeping at all
  now: the outcome is known where the group is settled, the remaining proposal is
  rebuilt there, and a settled group simply no longer exists. A block with nothing
  left to propose is removed, and a suggestion with no blocks left is cleared —
  an empty proposal used to be reported as a deletion of the whole paragraph.

  Settling dispatches `AI_SUGGESTION_RESOLVE` rather than replacing the
  suggestion, which used to clear the active block and blank the rest of the
  overlay until the caret moved.

  `AiSuggestionCardData.kind` gains `"format"`. Additive for a consumer that
  switches with a default, but a consumer narrowing exhaustively against `never`
  will stop compiling until it handles the new member — which is the point of
  writing it that way.

  A card can say `kind: "format"`; a formatting proposal was reported as a
  deletion labelled with the paragraph's own text. The popover describes it
  through `formattedText` instead of rendering an empty replaced→inserted pair.
  `FormatRenderInstruction` is exported, so a consumer can name the arm it
  narrows to. The underline groups glyphs by `lineY`, so a run of mixed sizes
  draws one straight rule rather than disjoint stubs.

- cc42506: A formatting proposal is now something the reader can see, point at and accept.

  Proposing formatting computed and applied correctly and showed nothing. Its
  words do not change, so it produces no delete strike and no insert caret, and
  the overlay skipped `keep` ops entirely — the card offered a change that had no
  mark on the page and no position to anchor to.

  `marks` on a `keep` now means one thing: the formatting _here_ changes. A run the
  proposal restates unchanged carries none, so a single field answers what the
  overlay draws, what the apply writes, and what a card counts. That also removes
  the second derivation of "did the formatting change" — it is read off the ops
  themselves now, so the preview and the result cannot disagree about it.

  Each such run gets its own `groupId`, so formatting is accepted the way a word
  swap is: one run at a time, scoped to the text that run spoke about. Accepting a
  word swap still touches no formatting, because it is a different group.

  A group id carries the block it belongs to. Groups are addressed across the
  whole suggestion, so numbering them per block meant accepting a run in one
  paragraph applied a different run in another.

  Runs are split at the formatting boundaries the _document_ already has, as well
  as the ones the proposal introduces. ProseMirror lets formatting change inside a
  word, so judging a run by its first character hid any change that began after
  it: half-bold "alpha" restated as plain looked like no change at all.

  New: a `format` render instruction and `renderFormatHighlight`, drawn as a solid
  underline beneath the run — distinct from the dashed red of a deletion, because
  this text is staying and only its appearance is in question. A wrapped run draws
  one stroke per line rather than a rule across the gap between them.
  `SuggestionGroupInfo` gains `formattedText`, so a popover rendering
  `replacedText → insertedText` can tell that a group proposes appearance rather
  than wording and describe it accordingly.

- bd0c3ae: The op walkers stop re-deriving the same two rules.

  `_applyDirect`, `_applyTracked` and `applyKeepFormatting` each resolved a
  suggestion's blocks in reverse document order and each advanced its own
  accepted-text offset, with the same three-branch bookkeeping. Both rules are
  easy to get subtly wrong and invisible when you do: reverse order only matters
  when two blocks settle in one pass, and the offset rule only shows up as a
  change landing a few characters off.

  `resolveBlocksInReverse` states the ordering once. The offset rule was already
  stated once — `withAcceptedOffsets`, added for the slash-command work — so the
  walkers read from it rather than keeping a counter each, and the keep and
  out-of-scope branches lose their bookkeeping entirely.

  `rejectAiSuggestion` stops walking ops altogether, which is the one behaviour
  change here. It used to remove `trackedInsert` text and `trackedDelete` marks,
  reading the same offsets as the apply walkers. That body could not be reached
  with marks present: applying settles the group out of the suggestion, so reject
  only ever sees ops that were never applied, and re-showing an applied proposal
  hands it offsets into a snapshot the document no longer matches. Reject now
  discards pending ops and touches neither content nor review marks. A change that
  has already been applied in tracked mode is a tracked change, and
  `editor.commands.setChangeStatuses` rejects it by its id — the API that
  addresses it.

  `{ blockId, groupId }` together now mean what they say: a group that does not
  belong to the named block is a no-op, where before the block filter was dropped
  and the group settled wherever it lived.

  `applyKeepFormatting` reads both shared rules too, though its ordering is
  immaterial — it writes marks only, so no position moves. It reads the shared
  resolve anyway, so a later change to either rule reaches every walker.

  What is left in each walker is only what genuinely differs — how a delete and
  an insert are written, and how much the text has shifted so far, which is why
  `insertedChars` stays local: a tracked delete marks text instead of removing
  it, so it shifts nothing.

  The walker changes are behaviour-neutral; the reject change is not, and
  `rejectBoundary.test.ts` pins what it must not disturb — a prior tracked
  insertion, a human deletion inside the accepted-text range, and a sibling group
  that is still applicable over tracked text — across all three reject scopes.

- 297dba9: Agent-proposed formatting is held to the document's own rules.

  `resolveInlineMark` is the one place that decides what an agent's mark may be,
  and it now refuses review marks and strips `dataTracked` from the ones it
  allows. Proposed formatting said how text should read; it could also say who
  reviewed it and when, which let agent output sign a change as another author.

  Marks are also resolved against the textblock that will hold them. A bold run
  proposed for a code block — which allows no marks — used to survive until
  dispatch and then throw, taking the whole batch with it; the words land
  unstyled instead, which is what the proposal meant.

  Formatting comparison runs on one canonical description (`describeInlineMark`),
  so bookkeeping a document carries and a proposal does not can no longer read as
  a difference. Restating a block's existing formatting is not a suggestion.

  Tracked formatting is applied with explicit suggestion intent rather than by
  relying on the engine's ambient status. `mode: "tracked"` on an editor whose
  tracking is switched off — the default — wrote formatting permanently, with no
  review record to reject.

  Table row inserts derive width from the grid and the row's spans rather than
  counting physical cells, so a row anchored to a merged cell no longer drops the
  content past the first column. Deleting the last child of a list or table
  removes the container instead of leaving an empty one behind.

- Updated dependencies [27a85a2]
- Updated dependencies [aa8529f]
- Updated dependencies [44e6423]
- Updated dependencies [297dba9]
- Updated dependencies [24eccf9]
- Updated dependencies [d4fc43d]
- Updated dependencies [80b90e0]
- Updated dependencies [cc42506]
- Updated dependencies [f6ff4a2]
- Updated dependencies [0332bcc]
- Updated dependencies [654c043]
- Updated dependencies [24abe2c]
- Updated dependencies [297dba9]
- Updated dependencies [490abaf]
- Updated dependencies [8098340]
- Updated dependencies [bb357f6]
  - @scrivr/plugins@1.0.22
  - @scrivr/core@1.0.22
  - @scrivr/export-semantic@1.0.22

## 1.0.21

### Patch Changes

- Updated dependencies [b356735]
- Updated dependencies [434a6b3]
- Updated dependencies [ace9a88]
- Updated dependencies [ace9a88]
- Updated dependencies [b356735]
- Updated dependencies [ca32553]
- Updated dependencies [d04f392]
- Updated dependencies [b356735]
- Updated dependencies [b356735]
- Updated dependencies [b356735]
- Updated dependencies [b356735]
- Updated dependencies [b356735]
- Updated dependencies [b356735]
- Updated dependencies [b356735]
- Updated dependencies [b356735]
- Updated dependencies [b356735]
- Updated dependencies [7e40b87]
- Updated dependencies [b15c7ea]
- Updated dependencies [bc7987e]
- Updated dependencies [76de760]
- Updated dependencies [b356735]
- Updated dependencies [3aa2340]
- Updated dependencies [e2caf29]
- Updated dependencies [ddedb24]
- Updated dependencies [ace9a88]
- Updated dependencies [ace9a88]
- Updated dependencies [ace9a88]
- Updated dependencies [ace9a88]
- Updated dependencies [ddedb24]
- Updated dependencies [94eef45]
- Updated dependencies [ff3ce5c]
- Updated dependencies [b356735]
- Updated dependencies [b356735]
- Updated dependencies [b356735]
- Updated dependencies [a6e9938]
- Updated dependencies [f2d7bbe]
  - @scrivr/core@1.0.21
  - @scrivr/plugins@1.0.21
  - @scrivr/export-semantic@1.0.21

## 1.0.20

### Patch Changes

- Updated dependencies [58c97b9]
- Updated dependencies [5d962d5]
- Updated dependencies [6ae5713]
- Updated dependencies [0136058]
- Updated dependencies [5d962d5]
- Updated dependencies [32ad7e7]
  - @scrivr/core@1.0.20
  - @scrivr/export-semantic@1.0.20
  - @scrivr/plugins@1.0.20

## 1.0.19

### Patch Changes

- 15dbf0c: **`@scrivr/core/pm` — one ProseMirror instance for the whole stack**

  `@scrivr/core` now publishes a `./pm` subpath that re-exports the ProseMirror surface Scrivr is
  built on: `prosemirror-model`, `-state`, `-transform`, `-commands`, `-keymap`, `-history`,
  `-inputrules`, `-schema-list`, `-markdown`.

  Extensions and downstream packages import from `@scrivr/core/pm` instead of the `prosemirror-*`
  packages directly, so they run against the same instance as the engine — the `instanceof` checks
  on `Node`, `Slice`, `Selection` and `Plugin` that the engine relies on can no longer be broken by
  a duplicate copy of `prosemirror-model` in the dependency tree. `prosemirror-view` is
  deliberately absent: there is no `EditorView` in Scrivr, so view-only hooks never run.

  - **`@scrivr/core`** — new `./pm` entry point (ESM + CJS + types). No change to the main barrel.
  - **`@scrivr/ai`, `@scrivr/docx`, `@scrivr/export-pdf`, `@scrivr/export-semantic`,
    `@scrivr/plugins`** — source imports moved to `@scrivr/core/pm`; direct `prosemirror-*`
    dependencies and peer ranges dropped. `@scrivr/ai` no longer declares any peer dependencies;
    `@scrivr/plugins` keeps `prosemirror-model`/`-state` peers only because `y-prosemirror` requires
    them, not for its own code.
  - **`@scrivr/export-markdown`** — dropped an unused `prosemirror-markdown` dependency.
  - **`@scrivr/export`, `@scrivr/react`** — version alignment only.

- fc33e99: **Hyperlinks survive DOCX export**

  A document exported to Word lost every hyperlink. The text came through, the
  link did not, and the export logged an `unsupported-mark` warning that no UI
  surfaces — so the first sign of it was a Word file where nothing was clickable.

  - **`@scrivr/core`** — new `DocxRunWrapper` contribution kind, and
    `DocxHandlers.markWrappers`. `DocxMarkHandler` contributes run _properties_,
    which is all bold or colour need; OOXML expresses a hyperlink as a
    `<w:hyperlink>` element wrapping the runs and carrying a relationship id, so
    no run property can produce one. That is why `Link` had no export handler at
    all rather than a broken one.
  - **`@scrivr/core`** — `Link` now contributes both halves: the wrapper that
    registers the relationship through the existing `ctx.rels.addHyperlink()`,
    and Word's built-in Hyperlink character style so the link looks like one. A
    link with no usable href stays styled text rather than emitting a `r:id` for
    a relationship that was never registered, which produces a file Word refuses
    to open.
  - **`@scrivr/docx`** — the walker applies wrapping marks around the run it just
    built, in the order the marks appear on the text, so two wrapping marks nest
    predictably.

- 87198ec: **Sourced Blocks**

  A new end-to-end system for embedding, tracking, and updating content blocks (such as clauses or definitions) that originate from an external library or provider.

  - **`SourcedBlock` Extension (`@scrivr/core`)** — A generic node wrapper that retains source metadata (`instanceId`, `kind`, `resourceId`, `versionId`, and `baseHash`). It leverages a new `insertSourcedBlock` command to seamlessly request and insert content from registered `SourceProvider` implementations.
  - **Divergence Detection (`@scrivr/core`)** — A built-in plugin hashes block content and compares it against the `baseHash` to detect if the local content has drifted from the source. Diverged blocks are visually indicated using a new `divergedGutter` theme property.
  - **Node Actions (`@scrivr/core`)** — Includes built-in Node Actions for Sourced Blocks, providing "Update to Latest", "Discard Local Edits" and "Detach from Library" capabilities based on user permissions.
  - **`layout` node spec declaration (`@scrivr/core`)** — Nodes now declare how they participate in layout, independent of what they mean in the document tree: `{ kind: "block" }` (the default — the node occupies its own box) or `{ kind: "transparent" }` (the node stays in the tree but contributes no box; its children lay out into the enclosing flow). Previously layout participation was inferred from the node's name — lists and tables expanded, everything else was assumed to be a text block — so a structural node like `sourcedBlock` laid out as a single empty line and never painted its content. The painter for a `block` node still comes from `addLayoutHandlers()`; folding the strategy into this declaration, and turning the text-block fallback into an error for undeclared nodes, is the next step.
  - **`addPasteTransforms()` (`@scrivr/core`)** — New extension seam for rewriting pasted content before it enters the document, applied by `PasteTransformer` to every clipboard flavour. This is the engine's equivalent of ProseMirror's `transformPasted` view prop, which never fires because Scrivr has no `EditorView`. Sourced blocks use it to re-mint `instanceId` so a pasted block is a second instance rather than a duplicate identity.
  - **DOCX Interoperability (`@scrivr/docx`)** — Sourced Blocks seamlessly round-trip through MS Word using `<w:sdt>` (Structured Document Tag) content controls. Source metadata is encoded in the `w:tag` attribute, meaning blocks retain their provenance even after being edited in Word. Provenance that would exceed the 255-character OOXML limit for `w:tag` is dropped with an export diagnostic rather than producing a file Word rejects.
  - **Semantic Mapping (`@scrivr/core`)** — Ensures Sourced Blocks preserve their boundaries and metadata when processed for semantic analysis.

- 1b42472: **Paste improvements**

  `@scrivr/core`

  - **Slice-accurate paste.** Copying now records the slice's open depths on the clipboard HTML (`data-pm-slice`, ProseMirror's own convention), and pasting rebuilds that slice exactly. Copy/paste inside the editor round-trips, including whitespace, which is document content in an internal slice but collapsible markup in foreign HTML.
  - **Inline HTML no longer splits the paragraph.** `fromHtml` previously forced `openStart: 0`, so pasting an inline fragment mid-sentence broke the paragraph into three. Openness is now derived from the pasted content: a default-attr paragraph merges into the cursor's block (matching Word/Docs), while anything carrying its own identity — a heading, a list, an aligned paragraph — stays a separate block and keeps its attrs.
  - **Paste without formatting (`Mod-Shift-v`).** Inserts the clipboard's text form only, skipping both HTML and markdown inference.
  - **Multi-line plain text becomes paragraphs** instead of one paragraph holding newline characters the canvas cannot render.
  - **Image paste.** A screenshot or image file on the clipboard is inserted as an image node, sized to its natural dimensions and scaled to fit the page. The default embeds an inline `data:` URL; the new `uploadPastedImage` editor option takes the bytes and returns a URL instead. Ignored when the clipboard also carries HTML, so a web-page image copy is not inserted twice.
  - **Word/Outlook lists.** Word emits lists as `mso-list`-tagged paragraphs whose bullet is literal text; these are now rebuilt into real `bulletList`/`orderedList` nodes, nesting included, with the marker glyphs dropped.
  - **Image placement survives an HTML round-trip.** `wrapMode`, `xAlign`, `x`, `yOffset`, `zIndex`, `margin`, and `verticalAlign` now serialize to and parse from `data-*` attributes; copying a floating image previously pasted it back as inline. One declaration drives both directions.
  - **`safeImageUrl`** — image `src` now accepts inline base64 `data:` URLs for raster types (png, jpeg, gif, webp, bmp, avif). `image/svg+xml` stays rejected, since SVG can carry script. Link `href` keeps the stricter `safeUrl` gate. This is what lets a pasted screenshot, and an image imported from a `.docx`, survive ingestion.
  - New public exports: `serializeSelectionToHtml`, `serializeSelectionToText`, `SLICE_DATA_ATTR`, `safeImageUrl`, `PasteOptions`, `PasteTransformerOptions`.

  `@scrivr/docx`

  - Adds a chain round-trip test covering images in all five wrap modes across export → import → clipboard copy → paste.

  Other packages are version-only (lockstep).

- e2431a2: **Section substrate**

  `@scrivr/core` gains the boundary-derived section model that per-section
  columns, page chrome, and page geometry will build on
  (`docs/sections-roadmap.md` step 1).

  - **`sectionBreak`** — a block atom carrying the settings of the section it
    terminates, mirroring DOCX's paragraph-level `sectPr` ownership. The body
    tree stays flat.
  - **`doc.attrs.finalSection`** — settings for the trailing section, which has
    no terminating break.
  - **`deriveSections(doc)`** — projects the boundaries into `{ id, from, to,
breakPos, settings }` ranges. Pure, mints no ids, and never persists
    positions, so it is safe on the read path.
  - **Commands** — `insertSectionBreak`, `setSectionSettings`,
    `removeSectionBreak`. Inserting copies the current section's settings to both
    halves; removing merges forward, which is Word's behavior and also what a raw
    deletion of the node produces.
  - **Layout** — a `continuous` break has no flow effect, `nextPage` starts the
    next page, and `evenPage`/`oddPage` skip a page when the next one has the
    wrong parity. Documents with no section break are unchanged.

  Also in `@scrivr/core`: pasted content now goes through `recloneDocumentIds`,
  so a clipboard paste no longer duplicates the source nodes' persistent
  structural ids into the destination document.

  All other `@scrivr/*` packages bump for lockstep version alignment only — no
  code changes in them.

- 4c0b3f4: **Sourced blocks: the host's half**

  Sourced blocks shipped with the document half reachable and the host half not.
  A host could register providers and insert blocks, but the reconciler the
  design hands it — read the provenance out of a document, compare a hash, see
  which instances have drifted — was never exported, and the provider callback
  for drift never fired.

  - **`@scrivr/core`** — `collectSourcedBlocks`, `computeBlockHash`,
    `sourcedBlockDivergenceKey` and `NORMALIZER_VERSION` are now exported, along
    with the provider contract a host implements against: `SourceProvider`,
    `SourceContent`, `SourceSearchResult`, `SourceCapability`,
    `SourcedBlockEvent`, `SourcedBlockChangedEvent`, `SourcedBlockOptions`,
    `SourcedBlockRecord`, `SourcedBlockDivergenceState`. Reconciliation stays the
    host's to trigger (there is no safe trigger under collaborative editing);
    core supplies the pure parts.
  - **`@scrivr/core`** — `SourceProvider.onInstanceChanged` now fires. It reports
    both facts and says which is which: `modified` is the document's, computed by
    hashing content against the base it was inserted with; `outdated` is the
    library's, and the editor only relays what the host told it. Nothing fires
    for the state a document already had when it opened.
  - **`@scrivr/core`** — new `setSourcedBlocksOutdated({ instanceIds, outdated })`
    command and an `outdated` attr on the node. A library check answers for many
    instances at once, so the command takes a list and writes one transaction:
    one undo step, one repaint. Storing it as an attr rather than plugin state
    means one peer can run the check and every collaborator sees the result, and
    it survives a reload.

- c8952d7: Extension bundles now compose instead of forwarding by hand, and keybinding
  precedence is explicit.

  `@scrivr/core`

  - **`addExtensions()`** — an extension may declare the sub-extensions it is
    composed of. `ExtensionManager` flattens them into its own list before any
    resolution phase, so every hook a member declares is collected exactly as if
    the consumer had listed it directly. `StarterKit` uses this and drops from 944
    lines to ~180: it previously re-implemented the manager's merge for **24 of
    27** contribution hooks, which meant each new seam had to be re-plumbed
    through the kit or it silently vanished for everyone using the default. Four
    hooks were already being dropped that way (`addCloneHandlers`, `addDocAttrs`,
    `addPageChrome`, `addSurfaceOwner`).
  - **`keymapPriority` + the `KeymapPriority` ladder** (`table` 400 → `codeBlock`
    300 → `list` 200 → `default` 100). Colliding keybindings now **chain** instead
    of last-wins: a command returning `false` means "not applicable here" and
    delegates to the next binding for that key. Priority decides who gets first
    refusal, which is how `Tab` can be cell navigation, code indentation, or list
    indentation depending on context. Previously bundles hand-chained this
    themselves and two independent extensions binding one key silently lost one of
    them.
  - Keymap precedence is deliberately **not** the extension list's order. That
    order already decides the schema's default block type — ProseMirror fills
    `block+` with the first registered block node — and one list cannot encode two
    orderings. `StarterKit`'s list now carries a single constraint (Paragraph
    first) and is otherwise free to reorder.
  - `findExtension()` returns the **last** match rather than the first, so
    `[StarterKit, Heading.configure({ levels: [1] })]` resolves to the caller's
    Heading rather than the kit's copy — consistent with how every other
    contribution resolves.
  - `Extension.configure()` accepts an optional argument, and `Extension.children()`
    / `flattenExtensions()` are exported for bundle authors.

  Behaviour change worth noting: an extension that previously _replaced_ a
  built-in keybinding by being registered later now chains behind it, and will not
  run if the built-in handles the key. Raise its `keymapPriority` to restore
  first refusal.

  The other packages carry a version-only bump (lockstep group).

- Updated dependencies [15dbf0c]
- Updated dependencies [fc33e99]
- Updated dependencies [87198ec]
- Updated dependencies [81f1b00]
- Updated dependencies [1b42472]
- Updated dependencies [e2431a2]
- Updated dependencies [4c0b3f4]
- Updated dependencies [c8952d7]
  - @scrivr/core@1.0.19
  - @scrivr/export-semantic@1.0.19
  - @scrivr/plugins@1.0.19

## 1.0.18

### Patch Changes

- 287c6c0: **BREAKING (`@scrivr/plugins`):** the AI toolkit and AI-suggestion overlay have
  moved out of `@scrivr/plugins` into a new package, **`@scrivr/ai`**. There are no
  compatibility re-exports (pre-1.x hard move).

  `@scrivr/ai` (new)

  - Home of the AI layer: `AiToolkit` / `AiToolkitAPI` / `getAiToolkit`,
    `GhostText`, `AiCaret`, and the AI-suggestion overlay (`AiSuggestion`,
    `computeAiSuggestion`, `showAiSuggestion` / `applyAiSuggestion` /
    `rejectAiSuggestion`, `subscribeToAiSuggestions`, `createSuggestionPopover`,
    the op render helpers, and their types).
  - Depends on `@scrivr/core` and `@scrivr/plugins`; it consumes the tracked-merge
    engine from `@scrivr/plugins`' public API.

  Migration: `import { AiToolkit, getAiToolkit, AiSuggestion, … } from "@scrivr/ai"`
  instead of `"@scrivr/plugins"`.

  `@scrivr/plugins`

  - No longer re-exports `ai-toolkit` / `ai-suggestion`.
  - The tracked-merge engine stays here and is the seam `@scrivr/ai` builds on.
    Widened the public surface with the primitives that layer needs:
    `pairReplacements` / `PairedDiffOp` and the tracked-attrs builders
    (`addTrackIdIfDoesntExist`, `createNewPendingAttrs`, `createNewInsertAttrs`,
    `createNewDeleteAttrs`).
  - Cycle fix: `applyDiffAsSuggestion` and `CitationHighlight` now import
    `findNodeById` from `@scrivr/core` (its canonical home) instead of through the
    moved `ai-toolkit`.

  `@scrivr/react`

  - The AI hooks/components (`useAiSuggestionPopover`, `useAiSuggestionCards`,
    `AiSuggestionCards`) import from `@scrivr/ai`. `@scrivr/ai` is a new optional
    peer dependency, mirroring `@scrivr/plugins`.

  Behaviour is unchanged — this is a mechanical package extraction.

- ff38bc1: **`@scrivr/core`:** namespace the `CellSelection` JSON id to `"scrivr:cell"`.

  Consumers of the same prosemirror-state instance share its selection JSON id
  registry, and `CellSelection` claimed the bare `"cell"` — the same id
  prosemirror-tables (which Tiptap ships) uses. An app running Tiptap alongside
  Scrivr threw `Duplicate use of selection JSON ID cell` at import time, whichever
  loaded second.

  `CellSelection` now registers under `"scrivr:cell"`, which cannot collide with
  theirs, and its `toJSON` emits the same namespaced id from a shared constant so
  the two can't drift. Duplicate Scrivr registrations still fail fast because two
  different `CellSelection` classes sharing one JSON id are not runtime-compatible.

  **Behavior change:** a persisted selection serialized before this release
  carries `"type": "cell"` and is no longer supported. Passing it to
  `Selection.fromJSON` throws because Scrivr no longer registers that id. The
  document itself is unaffected, and applications normally persist document JSON
  rather than transient editor selections.

  The other packages carry a version-only bump (lockstep group).

- da917c2: **`@scrivr/core`:** document clone mode.

  Create an editor with `clone` to deep-copy its initial document into a fresh id
  space: every node AND mark that carries a `nodeId` is re-minted, and the old→new
  mapping is exposed via `editor.cloneIdMap` so references held outside the doc
  (comment stores, citation indexes, semantic chunk tables) can be remapped onto
  the clone. The source content is never mutated.

  ```ts
  const editor = new ServerEditor({ content, clone: true });
  editor.cloneIdMap; // ReadonlyMap<oldId, newId> | null
  ```

  Available on both `ServerEditor` (headless) and the browser `Editor` — the logic
  lives in the shared `BaseEditor`. The underlying primitive,
  `recloneDocumentIds(doc, opts?) → { doc, idMap }`, is exported for callers that
  want to re-key a document without an editor.

  - **Schema-driven, custom nodes/marks included.** Any node (block or inline) or
    mark whose spec declares a `nodeId` attr is re-keyed — no per-type wiring.
  - **Typed lookup.** `cloneIdMap.getByType(oldId, typeName, kind?)` resolves the
    exact node, mark, or extension-owned id space when different types reuse the
    same source string; ordinary `get(oldId)` remains available for globally
    unique ids.
  - **Caller control.** `RecloneOptions` lets you restrict which types re-key
    (`shouldReclone`, so the map holds exactly what you chose) and set the new id
    values (`generate`). Pass them via `clone: { … }`.
  - **Tracked changes.** Change ids and their `referenceId`, `moveNodeId`, and
    `groupId` links are re-keyed together when the TrackChanges extension is in
    use, so a source and its clone can safely coexist.
  - **Extension hook.** Extensions can implement `addCloneHandlers()` to re-key
    their own id spaces or rewrite `nodeId` references during a clone, using the
    accumulated old→new map. Runs after the core re-key.

  Clone is a pure re-key: only non-null ids change; nulls are left as-is. Other
  custom id spaces pass through unless their owning extension contributes a clone
  handler. Clone is an explicit write, so it mints ids —
  distinct from the load-time read path, which never fabricates them.

  The other packages carry a version-only bump (lockstep group).

- de5fff9: Leaf-based rich semantic editing — an AI agent can now read a document with its
  formatting and write inline edits back that land as tracked-change suggestions,
  without churning the parts it didn't touch. The editable surface is the **leaf
  textblock addressed by its stable `nodeId`**; structure (lists, tables) stays
  read-only context. Replaces the earlier flattened-string merge that turned a
  verbatim echo of a list into hundreds of spurious changes.

  `@scrivr/ai`

  - `getRichBlocks(editor)` — the read half: semantic units where container units
    (lists, tables) expose their editable leaves as nested `parts`, each a
    paragraph/heading/codeBlock addressed by `nodeId`. The agent sees the grouping;
    every leaf is individually editable.
  - `applyRichEdit(editor, edit, { asSuggestion })` — the write half: resolves the
    target leaf by `nodeId`, auto-diffs against a per-leaf rich hash as a stale
    guard, and applies via the track-changes engine. When a whole **container**
    unit (list/table) is passed, its editable `parts` are diffed leaf-by-leaf and
    only the changed leaves are applied — the container is never sent to the
    leaf-only merge. Targets that no longer exist are reported via `notFound`; a
    rich edit resolving to a non-textblock is rejected, never flat-edited.
  - **zod schemas are first-class public API.** `RichSemanticEditSchema` plus the
    reused primitives (`InlineSpanSchema`, `InlineMarkSchema`) let any consumer
    `safeParse` untrusted agent output into validated, typed edits before it can
    touch the document. The structural-edit union is specced for later phases.

  `@scrivr/export-semantic`

  - Container units now carry `parts: SemanticPart[]` — the editable leaves inside
    a list or table, each with `nodeId` / `type` / `breadcrumb` / `text` / `spans`
    / `attrs`. A unit has EITHER `spans` (it is a leaf) OR `parts` (it is a
    container). The flat `text` projection for embedding is unchanged; `parts` is
    the universal edit surface. Table `cells` geometry stays read-only.
  - New `semanticPartRichHash(part)` — the formatting-aware hash for a single
    editable leaf, the freshness base for per-leaf auto-diff. `unitRichHash` now
    folds in a container's `parts`, so a formatting-only edit to a nested leaf is
    observable at the container level (previously invisible).

  `@scrivr/plugins`

  - Track-changes: `applyRichDiffAsSuggestion` now operates on a **single leaf
    textblock** — one text derivation over the leaf's real doc positions (no
    recursion into containers, no synthetic newline separators, no cross-package
    lockstep). Guards against non-textblock targets. Exported from the package's
    public API for `@scrivr/ai` to build on. `applyDiffAsSuggestion` imports
    `findNodeById` from `@scrivr/core` (canonical home).
  - An **attrs-only** rich edit no longer clears the author's pending inline text
    suggestion — only an edit carrying `spans` supersedes prior inline intent — so
    changing a block attr (e.g. alignment) preserves an in-flight text suggestion.

  `@scrivr/core`

  - `spansToFragment(spans, schema, opts)` reconstructs a ProseMirror inline
    fragment from agent-emitted `InlineSpan[]`, with `sameMark` / `resolveInlineMark`
    — the primitive that turns validated agent spans into real inline content.
  - `exports/semantic` gains the `SemanticPart` type and the `parts?` field on
    `SemanticUnit`.

  The other packages carry a version-only bump (lockstep group).

- Updated dependencies [287c6c0]
- Updated dependencies [ff38bc1]
- Updated dependencies [da917c2]
- Updated dependencies [90e96e9]
- Updated dependencies [de5fff9]
- Updated dependencies [d677454]
  - @scrivr/core@1.0.18
  - @scrivr/plugins@1.0.18
  - @scrivr/export-semantic@1.0.18
