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
  than changing it. `TrailingNode` sets it, so its trailing paragraph is no
  longer recorded as the author's suggestion.

**Track changes**

- Deleting pending work cancels it only when it is entirely your own. Deleting
  someone else's suggestion keeps it and records your deletion beside it, for
  text and whole nodes alike.
- An edit is linked to the act it belongs to, decided where its record lands.
  Your edits inside your own pending insertion fold into it (`creationId`).
  Another author's depend on it (`dependsOn`, closed by `foldingClosed`). A
  deletion recorded on a node and on the text inside is one change
  (`deletionId`), and so is a record split by later typing or a paragraph break
  (`continuesId`, with a unique id per span).
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
  `ReviewDecisions` instead of `{ status, ids }`. The `setChangeStatuses`
  command is unchanged.
- Tracking refuses a gesture it cannot represent rather than recording part of
  it, and reports the outcome on plugin state as `lastTracking`. A refusal
  survives all append rounds in the same dispatch; undo and redo clear it.
  Gestures of more than 20 steps used to go untracked silently and
  are now tracked in full.
- Selection survives tracking: a range stays a range in its direction, and the
  caret lands after typed or replacing text.
- `TrackChangesState` names the plugin state read from `trackChangesPluginKey`.
- Known gap, covered by an expected-failure test: a gesture mixing a mark step
  with a position-shifting step still under-records the mark.

**React**

- Every Accept and Reject in the panel and popovers goes through
  `useReviewAction`. A click either completes, or `ReviewRefusalNotice` says
  what stopped it on the surface that was clicked. Dependent work is listed and
  needs a second confirmation that replans first.
- Conflict resolution ("Keep insertion" / "Keep deletion") is one decision and
  one undo step.
- A suggestion split by another author's typing shows as one card.
