# @scrivr/ai

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
- Updated dependencies [297dba9]
- Updated dependencies [490abaf]
- Updated dependencies [8098340]
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
