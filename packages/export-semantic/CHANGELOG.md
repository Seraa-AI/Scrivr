# @scrivr/export-semantic

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

- 3d45744: A node declares that it breaks the page or the line. Page breaks and line
  breaks work exactly as before, now from `PageBreak` and `HardBreak` instead of
  by name in the engine. (Which blocks are bookmarked in a PDF is declared by
  `outlineLevel` on the node spec; see the outline-level note.)

  - **`NodeLayout` gains `{ kind: "break", breaks: "page" | "line" }`** (`BreakKind`).
    A block that breaks the page starts the next block on a new page; an inline
    node that breaks the line ends its line. A break its context cannot honour
    lays out as a plain leaf; a node that holds content ignores it. A page
    break's flow `blockType` is its node's name. `breakOf(type)` reads it, and
    the semantic exporter, the agent's rich diff and the header/footer surfaces
    honour declared breaks as they do the built-in ones.
  - **Pasted markdown goes through the tokens extensions declare.**
    `Strikethrough` declares `~~text~~`, so it pastes struck through. Markdown
    holding a construct no extension declares (a pipe table without `Table`)
    pastes as plain text, one paragraph per line. Inline code, links,
    blockquotes and images that no extension declares paste as their markdown
    text; inline code was dropped before.

  **Breaking:**

  - Removed the `addMarkdownRules()` extension hook, `MarkdownBlockRule`,
    `ExtensionManager.buildMarkdownRules()` and `ResolvedExtension.markdownRules`.
    Declare markdown tokens with `addMarkdownParserTokens()` instead.
  - `PasteTransformer`'s constructor drops its `extraMarkdownRules` argument:
    `new PasteTransformer(schema, markdownParserTokens, options)`.

- 07b6e41: A block declares its outline level on its node spec (`outlineLevel`), read
  by both the PDF bookmarks and the semantic outline, so a custom block heads a
  section in both. `Heading` declares it; headings bookmark, nest and head
  breadcrumbs as before.

  - `outlineLevelOf(node)` reads the declaration.
  - The semantic walker, its heading-led grouping and `toDocumentOutline` read
    the declared level instead of the name `heading`.

  **Breaking:**

  - A node whose semantic handler returns `{ type: "heading" }` but whose spec
    declares no `outlineLevel` no longer opens a section in `toDocumentOutline`
    or heads breadcrumbs: declare `outlineLevel` on its spec.

- f72a5b3: The PDF bookmarks and the semantic outline visit the same headings.

  - A heading nested in a list, sourced block or table cell heads the semantic
    breadcrumbs of what follows it and opens a section in `toDocumentOutline`,
    as it is a PDF bookmark. A unit lists the headings it holds in the new
    `SemanticUnit.headings` (`SemanticHeading`).
  - A heading whose proposed text is empty (blank, or all proposed for deletion)
    heads nothing in either outline; `headingLevel` is absent on such a unit.
  - A section's title is its heading's text, without a grouped lede.
  - `outlineTitleOf(node, isRemoved)` is the one title rule: the proposed text,
    a line break as a space, trimmed. Bookmark and semantic titles now match.

- ba07451: Lists lay out, print and export like Word's.

  - **Nested lists and multi-block items are drawn.** Layout used to lay out
    only each list item's first paragraph, so an item nested with Tab, a second
    paragraph in an item (which Backspace at the start of an item makes), and any
    text in them vanished from the canvas and the PDF while staying in the
    document. Every block of an item is now laid out, with the number on its
    first block — as in Word, even when that paragraph holds only a floating
    image, which then keeps one line for its number. A heading or code block in
    an item keeps its own style and painter; a table in an item is indented with
    it.
  - **Word's geometry.** Each level's text sits half an inch further in than
    the level above (the first level half an inch from the margin, where it was a
    quarter inch), and the marker hangs a quarter inch before the text,
    left-aligned. The text is never drawn over the number. Existing lists move a
    quarter inch to the right.
  - **Lists inside table cells are drawn.** A list in a cell (pasting one
    there makes one) used to lay out as one empty line, its text never painted
    on canvas or in PDF. A cell now lays out its blocks as the page body does:
    numbered, nested, indented and spaced, the number and the first word kept
    inside even a narrow cell, and a table nested in a cell shows its rows and
    its bottom border.
    A block that holds other blocks but is not a list or a table — a custom
    container, say — lays out the blocks it holds instead of one empty line
    (and still takes a line when it holds none), unless its node spec declares
    `layout: { kind: "block" }`, which keeps its own box and the painter it
    registered.
  - **No block is indented past an inch from the right margin.** Any block's
    indent — a deeply nested list, or a paragraph's own `indent` — leaves at
    least an inch of the line for its text.
  - **Markers by depth.** Bullets cycle •, ◦, ▪; ordered levels number
    1. / a. / i., each nested list counting from its own start. Lists nested
       past nine levels stay at the ninth. A list's start is kept within
       0–32767 on the page, in copied HTML and in markdown.
  - **Numbers stay right while editing.** A renumbered item is laid out
    afresh, so Tab, Shift-Tab and joining items never leave an old number on
    screen.
  - **Bullets are drawn as shapes**, on the canvas and in the PDF alike, so a
    second- or third-level bullet no longer prints as `?` with a standard PDF
    font. Numbers are drawn in the face and size of the item's first text, past
    any image that opens the line, on the canvas and in the PDF. Lists in
    headers and footers draw their numbers again. In the PDF a block's number
    is drawn once, after its handler, so a custom PDF handler that never calls
    `draw.lines` keeps it.
  - **DOCX levels match the screen.** Numbering has nine levels with the same
    formats, glyphs and indents the editor draws; an item's further blocks
    export as Word's unnumbered continuation paragraphs, a table in an item with
    `w:tblInd` and a width that fits the rest of the column, and a sourced block
    indented with them; list properties are written in schema order.

  **API changes**

  - `@scrivr/core` exports `isListType`, moved here from track changes and
    now what the list extension, Clear formatting, the semantic exporter and
    track changes ask.
  - `ListItemStrategy` is removed, and blocks are no longer relabelled
    `blockType: "list_item"`. Core draws a block's list marker itself, over
    whatever painter draws the block, through the new `paintBlock` export —
    use it in any loop that paints laid-out blocks. **Migration:** a painter
    registered under `list_item` is never called now; register it under the
    node type (`paragraph`, …) instead.
  - `isListType` holds only for a node whose content allows list items and
    nothing else.
  - `nodeLayout` now defaults an undeclared node whose content is blocks to
    `{ kind: "transparent" }`: its blocks lay out in its place.
    `DEFAULT_NODE_LAYOUT` (`{ kind: "block" }`) is the default for undeclared
    nodes that hold inline content or nothing. **Migration:** a container node
    that holds blocks must declare `layout: { kind: "block" }` to keep its
    registered painter; left undeclared, its painter is never called.
  - `AvailableSegment.indentFrom` (new) records where a first line started
    before its indent moved it.
  - `LineBreaker.breakIntoLines` takes `firstLineMayStayEmpty` (new: a first
    word that fits only the next line leaves the first line empty, as a list
    number's push does) and `firstLineIndent` (new: how far the provider's first
    line is indented, for a line a float starts some way in, so a float's
    narrowing is told apart from the indent's).
  - Up and Down step over a line that holds no text: a number left alone on
    its line, and the gap a full-width image leaves in any paragraph, on the
    same page or across one.
  - `DocxContext.textWidthTwips` (new, required): the width of the exported
    section's text column. Code that builds a `DocxContext` by hand must now
    set it; contexts from `@scrivr/docx` have it.
  - `DocxNumberingLevel.format` accepts `"lowerLetter"` and `"lowerRoman"`, and
    takes optional `left` / `hanging` indents in twips.

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

## 1.0.22

### Patch Changes

- 80b90e0: A semantic unit can now be recognised in a document it did not come from.

  `unit.id` addresses one block in one document, and `unitContentHash` answers
  whether that block changed between two versions of the same document — it folds
  in the breadcrumb for exactly that reason. Neither survives the clause being
  seen somewhere else, which is the question a corpus asks on ingestion: is this
  the indemnity I already hold, or a new one?

  `unitContentKey` answers that one. It covers the unit's text alone, NFKC-
  normalized with whitespace collapsed, so a clause that has been through a DOCX
  round-trip or re-wrapped still keys the same. It is a companion to `unit.id`,
  not a replacement: a corpus indexes by both — the instance id to find this block
  again, the content key to find everywhere else the clause appears.

  The key is SHA-256, added to `@scrivr/core` as `sha256Hex` — sync and
  dependency-free, because `crypto.subtle` is async and Node's `crypto` is absent
  in the browser, and an identity key computable on only one side of the wire is
  not an identity key. The existing `fnv1aHex` stays where it belongs: it compares
  a block against one prior value of itself, where 32 bits is ample. A corpus key
  is compared against every key already held, so collisions follow the birthday
  bound rather than luck — two fee clauses differing only in an amount collide
  readily at 32 bits — and these documents arrive from counterparties, who are in
  a position to aim for one.

  It is still only a key. A hash cannot prove equality, so a corpus that acts on a
  match — merging records, discarding an upload — confirms it by comparing
  `unitAlignmentInput`, which is published for that purpose.

  NFKC normalization is a deliberate loss of distinction, not just cleanup. It
  folds the compatibility forms an importer introduces — ligatures, full-width
  Latin, non-breaking spaces — and in doing so makes `m²` and `m2` the same text.
  That is the right trade for matching a clause across formats and the wrong basis
  for asserting two documents are byte-identical.

  It is not a similarity measure. Two clauses differing by a word get unrelated
  keys, by design; near-duplicate scoring is a separate question and a hash is the
  wrong tool for it.

  Grouping matters to the answer. A heading and its lede are deliberately one
  unit, so a grouped unit carries its heading in `text`. Cross-document alignment
  emits with `groupBlocks: false`, where a heading is its own unit and a clause is
  keyed on the clause. `unitAlignmentInput` is exported alongside so a consumer
  can see precisely what the key covers.

  The rich lane now publishes its preimages too — `unitRichInput` and
  `semanticPartRichInput`, the values `unitRichHash` and `semanticPartRichHash`
  already hashed. A digest says a leaf changed; the preimage says which run did,
  which is what a formatting-aware diff needs. Both are extracted from the hash
  functions rather than restated, so the preimage and the digest cannot drift, and
  both return named types — `UnitRichInput` and `SemanticPartRichInput` — so a
  consumer reads `.spans` rather than asserting its way past the return type.

- 0332bcc: Per-editor state belongs to the editor, not to a configured extension.

  Six extensions kept per-editor state in a map keyed by their own options object.
  Options identify a _configured extension_, and one of those can serve several
  editors — configure once, mount twice is the ordinary split-view shape. So the
  second editor overwrote the first's entry, a seeding hook reset it on every
  construction, and teardown nulled it for everyone.

  `Collaboration` stored its Y binding that way, read by undo, redo and three
  keymap handlers: undo in one pane drove the other pane's history, building a
  second pane left the first with no binding at all, and closing either pane
  disarmed its sibling. The binding moves into `collaborationRegistry`, which was
  already keyed by the editor and already documented as such.

  `PdfExport`, `DocxExport`, `DocxImport` and `SemanticExport` each stored _the
  editor itself_ the same way — so `exportPdf` in one pane saved the other pane's
  document, and `importDocxFromFile` **wrote** into it. All four now read
  `this.editor()`, which resolves per editor, so the map, the `InstanceState`
  type, the seeding plugin and the registration hook all delete. `PdfExport` needs an
  editor with a layout pipeline, which is now a runtime check on what the export
  actually calls — so any `IEditor` qualifies, not only the concrete browser
  `Editor` the old view-only hook required.

  `Image` held the same map with nothing reading it — its `onViewReady` already
  returned the cleanup it needed. Removed.

  `CollabState` gains a required `binding`, which a host names as
  `CollabState["binding"]`. Teardown now deletes the editor's registry entry
  instead of mutating a shared one.

  Two behaviour changes worth knowing. These commands reach their editor through
  `this.editor()`, which throws when an `ExtensionManager` was built without one,
  where the old lookup returned `undefined` and the command returned `false` — no
  production path builds an editorless manager, so this is latent rather than
  something that happens today. And `exportPdf` now warns on the path it refuses,
  the way `exportDocx` and `exportSemantic` already did, instead of returning
  `false` silently.

- 490abaf: `toDocumentOutline` — the section hierarchy the headings imply.

  `toSemanticUnits` answers an ordered flat list, which states the document's
  structure without describing it. Every consumer that wanted a navigable outline
  rebuilt one: opening and closing sections on heading level, threading ancestor
  titles, naming the content that precedes the first real heading. Each of those
  is a judgement about what a section is, made by a consumer rather than by the
  editor that owns the structure — so two places could disagree.

  Three rules now live with the editor: content before the first heading is a
  section and needs a name; a heading closes every open section at its level or
  deeper; a section's range is heading-inclusive and ends where the next one
  opens, so an outer section contains its children's range.

  Each `OutlineSection` carries `id`, `parentId`, `heading`, `headingNodeId`,
  `level`, `path`, and a `startUnit`/`endUnit` range into the same unit list.
  `headingNodeId` is null exactly when the section covers content preceding the
  first heading — there is no heading block to anchor a citation to, and the
  absence says so without a second flag. The name for that section is the
  `untitledHeading` option, because it is text a reader sees in a language only
  the host knows.

  Deterministic from the same units: every id is a unit's own anchor, so two
  reads of an unchanged document return the same sections and a cached chunk
  anchor keeps resolving. Nesting depth is read from the breadcrumb the walker
  already threads rather than re-derived from heading levels, so a section's path
  and its units' breadcrumbs cannot drift apart.

- Updated dependencies [aa8529f]
- Updated dependencies [297dba9]
- Updated dependencies [24eccf9]
- Updated dependencies [d4fc43d]
- Updated dependencies [80b90e0]
- Updated dependencies [0332bcc]
- Updated dependencies [654c043]
- Updated dependencies [24abe2c]
- Updated dependencies [297dba9]
- Updated dependencies [490abaf]
- Updated dependencies [8098340]
- Updated dependencies [bb357f6]
  - @scrivr/core@1.0.22

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

## 1.0.20

### Patch Changes

- Updated dependencies [58c97b9]
- Updated dependencies [5d962d5]
- Updated dependencies [6ae5713]
- Updated dependencies [0136058]
- Updated dependencies [5d962d5]
- Updated dependencies [32ad7e7]
  - @scrivr/core@1.0.20

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

- 90e96e9: Substrate for node-level incremental re-embedding (freshness engine).

  `@scrivr/export-semantic` — new change-detection helpers so a consumer can
  re-embed only what changed between document versions instead of the whole doc:

  - `unitEmbeddingInput(unit)` — the canonical string to embed (`breadcrumb + text`),
    one source of truth for both embedding and hashing.
  - `unitContentHash(unit)` — deterministic hash of that input. Identical hash ⇒
    the vector is unchanged ⇒ skip re-embed. Formatting-only edits (bold, color,
    alignment) don't change it; a text or breadcrumb change does.
  - `diffSemanticUnits(prev, next)` — matches units by stable anchor id and returns
    `{ added, removed, changed, unchanged }`. Editing one paragraph marks exactly
    one unit changed.
  - `unitRichHash(unit)` — a formatting-aware companion hash (`type` + `breadcrumb` +
    `text` + `spans` + `attrs`). Unlike `unitContentHash` it DOES change on a
    formatting-only edit (bold, color, alignment), so it's the detector for the
    upcoming rich AI-edit loop, not embedding freshness.

  `@scrivr/core` — collab-safe stable ids. `UniqueId` now stamps a `nodeId` only on
  LOCAL edits; a remote Yjs apply (tagged `COLLAB_SYNC_META` by the collaboration
  binding) is skipped, so a block's id is assigned once by its author and synced
  rather than re-stamped with a divergent uuid on every receiving client. Also
  exports `fnv1aHex` + `stableStringify`, the shared hash + canonical serializer used
  by the document fingerprint and the per-unit hashes (no parallel copies).

  `@scrivr/plugins` — the Yjs binding marks remote applies with `COLLAB_SYNC_META`.

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

- d677454: `@scrivr/plugins`

  - Track-changes engine: `mergeTrackedMarks` now fuses adjacent **formatting**
    marks (bold/highlight/color/…), not only tracked insert/delete text. A run of
    the same mark with the same author, operation and status collapses to one
    tracking id — the grouping typed text already got, now for formatting. Marks
    with different own attrs (e.g. two colors) never merge. `trackTransaction`
    invokes the merge after `AddMarkStep`/`RemoveMarkStep` at both boundaries.

    Fixes a live-editing bug: bolding two adjacent words (or applying a mark in
    several steps over a run) previously produced one tracked change per segment
    instead of a single reviewable change.

- Updated dependencies [287c6c0]
- Updated dependencies [ff38bc1]
- Updated dependencies [da917c2]
- Updated dependencies [90e96e9]
- Updated dependencies [de5fff9]
- Updated dependencies [d677454]
  - @scrivr/core@1.0.18

## 1.0.17

### Patch Changes

- aea772a: `@scrivr/export-semantic` — new `semantic` export lane that emits AI-ready
  `SemanticUnit[]` for RAG pipelines. `toSemanticUnits(editor)` walks the document
  tree headless (ServerEditor, from `contentJSON`) and produces ordered units
  carrying structure, stable identity (`nodeId`, with a deterministic positional
  fallback), and heading breadcrumb. Ships a `SemanticExport` extension — add it to
  the editor and call `editor.commands.exportSemantic()` (downloads a `.json`, or
  pass `{ onExport: units => … }` to receive the data headlessly), mirroring
  `DocxExport` / `PdfExport`.

  `@scrivr/core` — `IBaseEditor` now declares `getMarkdownSerializer()` (both
  `Editor` and `ServerEditor` already implement it) so headless export lanes can
  serialize arbitrary node groups.

  Lossless formatting on `SemanticUnit` (markdown can't express alignment/color/font):

  - `attrs` — the block's non-default styling (`align`, `indent`, `fontFamily`, list
    start, …), with identity/level bookkeeping stripped.
  - `spans` — inline formatting runs (`InlineSpan`), each carrying its marks + attrs
    (bold, italic, color, highlight, fontSize, link, …). Reconstructs `text` exactly.
  - Both also on `TableCell`; both emitted only when non-empty. Tracked-change marks
    are review metadata (surfaced in `changes`) and are excluded from `spans`; the
    TrackChanges extension registers a `trackedInsert` seam handler so it is kept in
    text but not treated as formatting.
  - `view: "proposed"` states the text contract explicitly (pending inserts included,
    pending deletes excluded into `changes`). `markdown` is a lossy convenience
    projection and is omitted when a unit has `changes`, so its redline rendering
    never contradicts the proposed `text`. Grouping's "short lede" test uses
    mark-aware length; `spans` are emitted only when they reconstruct the final text.

  `@scrivr/core` — adds the canonical `semantic` handler types (`SemanticUnit`,
  `TableCells`, `SemanticNodeHandler`, `SemanticMarkHandler`, `UnitCtx`) and, via
  the per-extension `addExports().semantic` seam, node handlers for paragraph,
  heading, list, table (structured cells with gridSpan/vMerge), codeBlock,
  horizontalRule, pageBreak, and image. Unregistered nodes degrade to a visible
  `type:"unknown"` unit rather than being dropped.

  `@scrivr/plugins` — TrackChanges contributes a `semantic` mark handler so
  suggested-deletion text is excluded from unit text (not embedded) while inserted
  text is kept.

  Deterministic block identity (fixes non-deterministic chunk ids):

  - `UniqueId` now ships in `@scrivr/core` and is bundled in **StarterKit** (opt
    out with `StarterKit.configure({ uniqueId: false })`), so stable, persisted
    block `nodeId`s are the default with or without the AI toolkit. It also now
    preserves pending `storedMarks` when it stamps, so mark inheritance across an
    Enter split is unaffected. `@scrivr/plugins` re-exports `UniqueId` /
    `findNodeById` from core for back-compat.
  - `ServerEditor` no longer fabricates block ids on load. A headless read/emit
    surface must be deterministic: it preserves persisted `nodeId`s and never
    stamps random ones, so loading the same `contentJSON` twice yields the same
    ids (previously every load churned ids, breaking chunk identity and causing
    duplicate chunk sets). The interactive `Editor` still assigns ids on load, and
    `normalizeDocument({ assignIds })` remains available for explicit assign passes.

- Updated dependencies [aea772a]
  - @scrivr/core@1.0.17
