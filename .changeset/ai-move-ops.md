---
"@scrivr/core": patch
"@scrivr/plugins": patch
"@scrivr/ai": patch
"@scrivr/react": patch
"@scrivr/export-semantic": patch
---

An agent edits like a person: it moves blocks, list items, headings and images,
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
