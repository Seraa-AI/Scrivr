---
"@scrivr/core": patch
"@scrivr/plugins": patch
"@scrivr/react": patch
---

Track changes keeps its boundaries: editing content that already holds
suggestions no longer destroys authorship, selection, or unrelated decisions.

**Core**

- `editor.commands.*` and `runCommand` return whether the command ran, instead
  of `void`. A read-only editor returns `false`.
- A node's `marks` restriction now limits formatting only. Review marks are
  admitted wherever track changes is installed, so edits inside a code block
  are tracked like any other text.
- `NORMALIZATION_META` marks an edit that keeps the document well-formed rather
  than changing it. `TrailingNode` and the table normalizer set it, so what they
  add is no longer recorded as the author's suggestion.

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
  step that writes both inside and outside an insertion is refused with
  `overlapping-steps`.
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
- Tracking refuses a gesture it cannot represent rather than recording part of
  it. The edit itself stands, unrecorded, and `lastTracking` reports `refused`
  with a `reason` so the host can undo or warn. A refusal survives all append
  rounds in the same dispatch; undo and redo clear it. `lastReview` reports the
  last decision the same way. Gestures of more than 20 steps used to be partly
  untracked and are now tracked in full.
- Selection survives tracking: a range stays a range in its direction, and the
  caret lands where the gesture left it, through every step of a multi-step
  gesture.
- `TrackChangesState`, `TrackingResult` and `TrackingRefusal` name what a host
  reads from `trackChangesPluginKey`.

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
