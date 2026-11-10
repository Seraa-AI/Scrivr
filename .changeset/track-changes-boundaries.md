---
"@scrivr/core": patch
"@scrivr/plugins": patch
"@scrivr/react": patch
"@scrivr/ai": patch
---

Track changes keeps its boundaries: editing content that already holds
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
