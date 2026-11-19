# Suggestion Lanes RFC — every suggestion is recorded by the engine

Status: Draft (2026-11-16, updated 2026-11-19 for 1.0.25). Answers part 1 of
#252. Parts 2 (block-level previews) and 3 (structural previews on revision
projection) follow separately.

## Question

Four lanes propose edits on someone's behalf:

| Lane | File |
|---|---|
| `applyDiffAsSuggestion` / `applyMultiBlockDiff` | `plugins/src/track-changes/lib/applyDiffAsSuggestion.ts` |
| `applyRichDiffAsSuggestion` | `plugins/src/track-changes/lib/applyRichDiffAsSuggestion.ts` |
| AI suggestion tracked apply (`_applyTracked`) | `ai/src/ai-suggestion/showHideApply.ts` |
| `insertAsSuggestion` command | `plugins/src/track-changes/TrackChanges.ts` |

Each builds `trackedInsert` / `trackedDelete` marks by hand and dispatches under
`skipTracking`, so the engine never sees the edit. Structural edits and AI
formatting already go the other way: a plain edit under
`trackAsSuggestion(tr, author)`, recorded by the step trackers.

Can the four lanes make plain edits and let the engine record them, and what
does the engine need so nothing a reviewer sees today is lost?

## Why it matters

The hand-written copy of the engine's rules only knows text. The gaps still open:

- **A rich edit cannot propose deleting an existing line break.**
  `applyTrackedDelete` (`splitRangeForNewMark`) marks text only, so a break
  inside a deleted range is silently kept. Accepting the suggestion leaves the
  break in the document.
- **The plain lanes cannot propose a break.** They read a block through
  `buildAcceptedTextMap`, which has no breaks, so every `"\n"` is written as a
  space (`applyDiffAsSuggestion.ts:247`, `TrackChanges.ts:363`,
  `showHideApply.ts` `insertedContent`).
- **Every new rule lands four extra times.** Images, deletion ownership,
  conflicts and composition were each added to the engine and then re-derived,
  or missed, in the lanes. Formatting is the latest: #265 (1.0.25) taught the
  engine to remember a replaced value and to hold another author's suggestion,
  and `applyRichDiffAsSuggestion` had to call the same rules itself
  (`restoreRuns`, `proposeRemoval` from `formatSuggestions.ts`, beside
  `trackAddMarkStep` / `trackRemoveMarkStep`) to keep up.
- **Typing discipline.** `_applyTracked` needs `as Record<string, unknown>`
  casts to attach a `groupId` to records it builds itself.

The engine already handles breaks, images and deletions correctly for a person
typing in suggesting mode. The lanes should get the same behaviour by going
through the same path.

## What the engine does today

Read from `engine/processReplaceStep.ts`, `lib/deleteTextIfInserted.ts` and
`step-trackers/`:

| Lane behaviour today | Engine behaviour for the same plain edit |
|---|---|
| Deleted text gets `trackedDelete` | Same (`delete-text` → `deleteTextIfInserted`) |
| Deleted break or image is kept (rich) / never deleted (plain) | Recorded as deleted on the node, like any inline object |
| Inserted text gets `trackedInsert` (`suggestedContent`) | Same — `suggestedContent` already uses the engine's `setFragmentAsInserted` |
| Deleting the author's own pending insertion removes it (`clearAuthorPendingMarks`) | Same — `deleteTextIfInserted` takes back the author's own insertion |
| Deletion and insertion share a `groupId` from `diffText` | **No pairing.** The two halves of a replace step get unrelated ids |
| Author's earlier pending deletion is withdrawn by removing its mark | **Not an edit.** Nothing to record; the engine has no step for it |
| Formatting on kept text (rich): hand-applied with `restoreRuns` / `proposeRemoval` | Same rules — `tr.addMark` / `tr.removeMark` recorded by `trackAddMarkStep` / `trackRemoveMarkStep`, which call those helpers (since #265) |
| Block attrs (rich): a hand-built tracked `set_node_attributes` | Same — `tr.setNodeMarkup` recorded by `trackAttrsChangeStep` / `trackSetNodeMarkupStep` |

Two rows need a decision. Everything else moves to the engine unchanged.

## Decision

1. **The four lanes make plain edits under `trackAsSuggestion(tr, authorID)`.**
   Delete with `tr.delete`, insert with `tr.insert` of plain content built by
   `spansToFragment` (a `"\n"` becomes the block's break). The rich lane sets
   formatting with `tr.addMark` / `tr.removeMark` and block attrs with
   `tr.setNodeMarkup`. No lane builds a
   tracked mark or record. `skipTracking` and the hand-built
   `refreshChanges` go from these four call sites.

2. **The engine pairs a replacement.** When one gesture both deletes and
   inserts at the same place, the engine stamps both records with one
   `groupId`. The lanes no longer stamp it. Pairing a word swap typed over a
   selection in suggesting mode comes free: today it is two cards, after this
   it is one, as in Word.
   - The lanes keep `phraseReplacements` to decide *where* one replacement
     ends and the next begins; each phrase is written as one `tr.replaceWith`,
     so "one replace step" is the unit the engine pairs.

3. **Withdrawing one's own pending deletion stays explicit.** It is review
   bookkeeping, not an edit, so it cannot go through the engine. It keeps one
   home: `clearAuthorPendingMarks`, reduced to its deletion half (the insertion
   half is now the engine's), run before the plain edit in the same
   transaction.

4. **The plain lanes read breaks.** `buildAcceptedTextMap` maps a line break to
   `"\n"`, as the rich map already does, so the plain lanes can propose and
   remove breaks too.

## Non-goals

- Block-level previews (#252 part 2) and structural previews (part 3).
- Changing what `diffText` considers a change.
- Changing the public signatures of the four lanes. Results (`applied`,
  `editDensity`, `notFound`, `rejected`) keep their meaning.

## Alternatives considered

- **Teach `applyTrackedDelete` about breaks and images.** Closes the first gap
  only, and grows the second copy of the rules this RFC removes.
- **Keep `groupId` stamping in the lanes, after the engine records.** Requires
  each lane to find the records the engine just made and rewrite them: a third
  place that knows the record format.
- **Leave `insertAsSuggestion` hand-built because it is small.** It has the
  same `"\n"` gap and would be the one lane that disagrees with the engine.

## Questions a reviewer will ask

- *Does the engine track while the host's status is disabled?* Yes:
  `trackChangesPlugin.appendTransaction` tracks any transaction carrying
  suggestion intent regardless of status.
- *Undo?* Each lane still dispatches one transaction, so it stays one undo step.
- *Can tracking refuse a lane's edit?* It can, as for any suggesting edit; the
  lane then reports `applied: false` instead of writing unrecorded marks.
- *Conflicts with another author's pending text?* The engine's existing rules
  apply, the same as two people typing. Formatting set over another author's
  pending suggestion holds it (`within` on `findChanges().pending`, since
  #265), whichever lane set it.

## Tests (written first, failing before the change)

- A rich edit that drops an existing break proposes deleting it; Accept removes
  it, Reject keeps it.
- A plain edit with `"\n"` proposes a break, not a space.
- A word swap from each lane is one act (shared `groupId`), decided whole.
- A word swap typed over a selection in suggesting mode is one act.
- Restating the original withdraws the author's earlier suggestion, in both
  directions (own insertion, own deletion).
- Each lane produces the same records as the same plain edit typed in
  suggesting mode.
- A rich recolour of another author's pending colour holds their suggestion;
  rejecting it brings theirs back (the #265 behaviour, kept through the move).

## Release

This PR is docs only: no changeset, and the PR carries the `no-release` label.
The implementation PR lists every `@scrivr/*` package as `patch`.

## Files to create / modify

- `plugins/src/track-changes/engine/` — pair the halves of one replace step.
- `plugins/src/track-changes/lib/applyDiffAsSuggestion.ts`,
  `lib/applyRichDiffAsSuggestion.ts`, `TrackChanges.ts`
  (`insertAsSuggestion`), `ai/src/ai-suggestion/showHideApply.ts`
  (`_applyTracked`) — plain edits under `trackAsSuggestion`.
- `plugins/src/track-changes/lib/acceptedTextMap.ts` — breaks read as `"\n"`.
- `lib/splitRangeForNewMark.ts` (`applyTrackedDelete`) — removed if no caller
  remains. So is `applyRichDiffAsSuggestion`'s own `addTrackedMark` and
  `inlinePieces`.
