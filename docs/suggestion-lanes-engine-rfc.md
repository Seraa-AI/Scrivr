# Suggestion Lanes RFC — every suggestion is recorded by the engine

Status: Draft (2026-11-16, revised 2026-11-20 against 1.0.25). Answers part 1
of #252. Parts 2 (block-level previews) and 3 (structural previews on revision
projection) follow separately.

## Question

A *lane* here is an API that writes a suggestion on someone's behalf rather
than from their keystrokes. There are four:

| Lane | File |
|---|---|
| `applyDiffAsSuggestion` / `applyMultiBlockDiff` (plain) | `packages/plugins/src/track-changes/lib/applyDiffAsSuggestion.ts` |
| `applyRichDiffAsSuggestion` (rich) | `packages/plugins/src/track-changes/lib/applyRichDiffAsSuggestion.ts` |
| AI suggestion tracked apply, `_applyTracked` (AI) | `packages/ai/src/ai-suggestion/showHideApply.ts` |
| `insertAsSuggestion` command | `packages/plugins/src/track-changes/TrackChanges.ts` |

Each builds `trackedInsert` / `trackedDelete` marks and records by hand and
dispatches under `skipTracking`, so the engine never sees the edit. Structural
edits (`AiToolkit.ts`, `imageAttrs.ts`) and AI formatting
(`applyKeepFormatting`) already go the other way: a plain edit under
`trackAsSuggestion(tr, author)`, recorded by the step trackers.

Can the four lanes make plain edits and let the engine record them, and what
does that need so nothing a reviewer sees today is lost?

## Why it matters

The hand-written copy of the engine's rules only knows text:

- **A rich edit cannot propose deleting an existing line break.**
  `applyTrackedDelete` (`lib/splitRangeForNewMark.ts:61`, `if (!node.isText)`)
  marks text only, so a break inside a deleted range is silently kept.
  Accepting the suggestion leaves the break in the document.
- **The plain lanes cannot propose a break.** They read a block through
  `buildAcceptedTextMap`, which skips every non-text inline node, so every
  `"\n"` is written as a space (`applyDiffAsSuggestion.ts:247`,
  `TrackChanges.ts:363`, `showHideApply.ts:349`).
- **Every new rule lands again in the lanes.** Images, deletion ownership,
  conflicts and composition were each added to the engine and then re-derived,
  or missed, in the lanes. Formatting is the latest: #265 (1.0.25) taught the
  engine to remember a replaced value and to *hold* another author's suggestion
  (keep it, so rejecting the new change brings it back), and
  `applyRichDiffAsSuggestion` had to call the same rules itself (`restoreRuns`,
  `proposeRemoval` from `packages/plugins/src/track-changes/formatSuggestions.ts`)
  to keep up.
- **Typing.** `_applyTracked` attaches a `groupId` through
  `as Record<string, unknown>` casts (`showHideApply.ts:439,448`), and the plain
  lane widens its record to `Record<string, unknown>` for the same reason
  (`applyDiffAsSuggestion.ts:231`). Both go once the lanes stop building
  records.

The engine already handles breaks, images and deletions for a person typing in
suggesting mode (`semanticReview.test.ts` covers a deleted break). The lanes
should get the same behaviour by going through the same path.

## What the lanes do today, and what the engine does

| Today | Lanes | Engine, for the same plain edit |
|---|---|---|
| Deleted text gets `trackedDelete` | all four | Same (`deleteTextIfInserted`) |
| A deleted break or image | kept (rich), never deleted (plain, AI) | Recorded as deleted on the node |
| Inserted text gets `trackedInsert` | plain, rich via `suggestedContent`; AI and `insertAsSuggestion` by hand | Same (`setFragmentAsInserted`) |
| The author's own pending insertion, rewritten | taken back by `clearAuthorPendingMarks` (plain, rich); struck (`insertAsSuggestion`) | Taken back (`canCancelInsertion`) |
| Deletion and insertion share a `groupId` | plain, rich, AI, from `phraseReplacements`; `insertAsSuggestion` pairs nothing | Paired since the engine PR of this work (Decision 2) |
| The author's own pending deletion, restated | withdrawn by `clearAuthorPendingMarks` (plain, rich) | **Not an edit**: nothing to record |
| Formatting on kept text | rich, through `restoreRuns` / `proposeRemoval` | Same rules: `tr.addMark` / `tr.removeMark` → `trackAddMarkStep` / `trackRemoveMarkStep` |
| Block attrs and type | rich, a hand-built `set_node_attributes` record | Same: `tr.setNodeMarkup` → `trackSetNodeMarkupStep` |
| A `"\n"` in the proposal | written as a space (plain, AI, `insertAsSuggestion`) | A break where the block allows one (`spansToFragment`) |
| Pieces of one insertion (marked runs, a break) | one act through a shared `creationId` (`suggestedContent.ts:23-27`) | **One record each** (`trackReplaceStep.ts:101`); Decision 7 |
| Another author's struck text inside the range | struck again by the lane (`splitRangeForNewMark.ts:66-72`) | Left alone: struck text gets no second record (`deleteTextIfInserted.ts:33`) |
| A block attr change over another author's pending one | a second record, the lane's | Folded into the pending one, which keeps its author (`processReplaceStep.ts:147-167`) |
| Text deleted in one place and inserted elsewhere | a deletion and an insertion | **A move** (`groupMoveSteps`), as for a person, unless the deletion only takes back the author's own pending inline insertion: nothing was there before to move from |

The last three rows are the engine's rules for anyone suggesting, and the lanes
take them as a person's edits would. Decision 7 answers the first.

## Decision

1. **The four lanes make plain edits under `trackAsSuggestion(tr, authorID)`.**
   - Each phrase is one `tr.replaceWith` (or `tr.delete` / `tr.insert` when it
     only removes or only adds), with content built by `spansToFragment` for the
     destination block, so a `"\n"` becomes a break where the block allows one.
   - The rich lane sets formatting with `tr.addMark` / `tr.removeMark` and block
     attrs with `tr.setNodeMarkup`.
   - No lane builds a tracked mark or record. `skipTracking` and the hand-set
     `refreshChanges` are removed from these four call sites.
   - **Positions are mapped through `tr.mapping` from the document the diff was
     made against.** Today the lanes count only inserted characters because a
     tracked deletion marks text and shifts nothing; a plain deletion removes it
     inside the lane's transaction, so that counting would place later edits
     wrongly.
   - **The AI lane writes its keep-formatting and its text in one
     transaction**, so one apply is one undo step and is applied whole or not
     at all.
   - A replacement shows its new words before the words it strikes, as the
     engine places typing over a selection (`selectionContract.test.ts`). The
     lanes put the struck words first today; the changeset says so.
   - The plain, rich and AI lanes share one writer, `writeProposal`, which
     turns a block's phrase ops into these edits.

2. **The engine pairs a replacement.** A step that types over a selection inside
   one block, and records a deletion there, gives the deletion and the insertion
   one `groupId`.
   - Text typed right beside the replacement's typed words, or retyped inside
     them, joins it. This is decided when the edit is recorded.
   - Only records of the same replacement merge. Any other edit beside it,
     earlier or later, stays its own change, and so does another replacement,
     even side by side.
   - Typing over text already struck, or over the author's own insertion,
     starts no replacement: there is no new deletion to pair.
   - A selection across blocks, or a paste that brings blocks in, is not
     paired: it also joins or splits blocks. A move is not paired: its halves
     pair through the move id.
   - The lanes stop stamping `groupId`. Each phrase they write is one step, so
     each phrase that deletes agreed text is one replacement. A phrase that only
     rewrites the author's own earlier lane insertion continues that
     replacement.
   - **Word and Google Docs disagree here, and this follows Google Docs.** Word
     keeps a typed-over selection as two revisions, an adjacent `w:del` and
     `w:ins` of one author and date, each accepted or rejected on its own.
     Google Docs shows it as one suggestion. Scrivr already treats a
     replacement as one act: the lanes pair their diffs (D8 in
     `docs/tracked-changes-agents-docx-rfc.md`), and D11 there decides that
     DOCX import will read Word's adjacent pair as one replacement. D11 is
     decided but not built. Pairing typed replacements makes a person's swap
     match an agent's. Today a replacement typed in Scrivr is two cards; after
     this it is one.
   - Built and tested on branch `suggestion-lanes-252-engine`
     (`replacementPairing.test.ts`).

3. **Withdrawing one's own pending deletion stays outside the engine.** It is
   review bookkeeping, not an edit, so the engine has nothing to record; #252
   asks for withdrawal to "follow the engine", and this is the one place it
   cannot.
   - `clearAuthorPendingMarks` keeps its behaviour and its public signature, and
     runs first, in the lane's own transaction. Inside a tracked transaction its
     two halves need no change: removing a review mark is never tracked
     (`isValidTrackableMark`), and deleting the author's own insertion is taken
     back.
   - It also withdraws the author's pending deletion recorded on an inline node
     (a break or image), which Decision 1 now creates, through
     `setNodeAttribute` of `dataTracked`. The engine records nothing for that
     step: rewriting a review record is bookkeeping, not an edit.
   - As today, the plain and rich lanes withdraw; the AI lane and
     `insertAsSuggestion` do not.

4. **One reader of accepted text.** `buildAcceptedTextMap` and the rich lane's
   `collectAccepted` read a block through one function, which maps a line break
   to `"\n"` and leaves out a break pending deletion, as `collectAccepted`
   already does. The plain lanes can then propose and remove breaks.

5. **A lane never deletes an inline object it did not read.** Neither map gives
   an image a character, so a deleted range that spans one is split around it.
   The image is proposed for deletion only when the lane's own content leaves
   it out, as the rich lane's image runs do today.

6. **A lane writes nothing it cannot record.** One check owned by track changes,
   `suggestionBlocked(state, tr)`, answers whether a suggestion transaction would
   land: no TrackChanges plugin, the status is `viewSnapshots`, or tracking
   refuses it (`gestureRefusal`). Every lane asks it before dispatching. When it
   is blocked the lane dispatches nothing and reports it (`applied: false`, or
   `false` from the command). Today a "tracked" AI apply without the plugin
   writes nothing only by accident (`applyTrackedDelete` returns early without
   the mark type); `applyKeepFormatting` already guards this way.

7. **One step's insertion is one act.** Of the pieces one step inserts (each
   marked run, each break), the first one's id names the act and the rest carry
   it as their `creationId`, as `suggestedContent` does for the lanes today. Without it, a rich insertion of
   "**foo** bar" would become three cards. A paste typed in suggesting mode gets
   the same.

## Public surface

| Export | After this |
|---|---|
| The four lanes' signatures and result types | Unchanged |
| `clearAuthorPendingMarks` | Unchanged, plus withdrawing a node-level deletion (additive) |
| `buildAcceptedTextMap`, `acceptedTextMapFor` | **Output changes**: a break reads as `"\n"`, so `acceptedText`, `decoratedText` and the offsets in `map` shift for a block with a break. Callers: `computeAiSuggestion.ts`, `rebase.ts`, `drift.ts`, `AiSuggestion.ts`, `createSuggestionPopover.ts`, `groupRanges.ts`, `showHideApply.ts`, `AiToolkit.ts`, `buildParagraphContexts.ts` |
| `applyTrackedDelete`, `applyTrackedInsert`, `splitRangeForNewMark` | Kept, unchanged; no lane calls them |
| `createNewDeleteAttrs`, `createNewInsertAttrs`, `createNewPendingAttrs`, `addTrackIdIfDoesntExist` | Kept; the barrel comment naming `@scrivr/ai` as their consumer is corrected |
| `suggestionBlocked` | New |
| `writeProposal` | New: the lanes' shared writer, exported for `@scrivr/ai` |

A host that builds `proposedText` from a view without breaks would now propose
deleting every break, so the implementation changeset carries a **Breaking**
note for the accepted-text output, as `plugins/CHANGELOG.md` does for earlier
patch-level breaks.

## Non-goals

- Block-level previews (#252 part 2) and structural previews (part 3).
- Changing what `diffText` considers a change.
- Removing any export; that is its own decision.

## Alternatives considered

- **Teach `applyTrackedDelete` about breaks and images.** Closes the first gap
  only, and grows the second copy of the rules this RFC removes.
- **Keep `groupId` stamping in the lanes, after the engine records.** Each lane
  would have to find the records the engine just made and rewrite them: a third
  place that knows the record format.
- **Give `buildAcceptedTextMap` its own break reading.** A second copy of the
  rule, which must also skip a break pending deletion and stay in step with
  export-semantic's extraction.
- **Leave `insertAsSuggestion` hand-built because it is small.** It has the
  same `"\n"` gap and would be the one lane that disagrees with the engine.

## Questions a reviewer will ask

- *Does the engine track while the host's status is disabled?* Yes:
  `trackChangesPlugin.appendTransaction` tracks any transaction carrying
  `suggestionIntent`. While viewing snapshots it lets no authored edit through,
  which Decision 6 reports instead of losing.
- *Undo?* Each lane dispatches one transaction, the AI lane included after
  Decision 1, so each apply is one undo step.
- *Can tracking refuse a lane's edit?* It refuses a step it cannot record.
  A gesture that overlaps its own insertion is split and recorded, not
  refused, and the lanes write only replace and mark steps, so none was found
  that a lane produces. Decision 6 covers it anyway.
- *Conflicts with another author's pending text?* The engine's rules apply, the
  same as two people typing. Formatting set over another author's pending
  suggestion holds it (`within` on `findChanges().pending`, since #265),
  whichever lane set it.
- *A lane rewrite that moves a sentence to another block?* It reads as a move,
  as the same edit by a person does, instead of a deletion and an insertion.
- *A lane's attr change over another author's pending one?* It folds into that
  change, as a person's would; the lane no longer adds a second record beside it.
- *`insertAsSuggestion` across two blocks?* It becomes what typing over that
  selection is: a proposal to delete the range and join the blocks, unpaired.
  Today it strikes the range and inserts, leaving the blocks apart.

## Tests

Written first. Each one fails on `main` unless marked *guard*, which keeps
today's behaviour through the change.

- A rich edit that drops an existing break proposes deleting it; Accept removes
  it, Reject keeps it.
- A plain edit, and `insertAsSuggestion`, with `"\n"` propose a break, not a
  space; in a heading the break becomes a space, in a code block a newline.
- A deletion spanning an image the lane did not read keeps the image.
- A deletion spanning another author's pending deletion places the following
  edits correctly.
- `insertAsSuggestion` over a selection is one act.
- A rich recolour of another author's pending colour holds their suggestion;
  rejecting it brings theirs back. *Guard.*
- A word swap from the plain, rich and AI lanes is one act. *Guard.*
- Restating the original withdraws the author's earlier suggestion, own
  insertion and own text deletion. *Guard.* Restating after a dropped break
  withdraws the break's deletion.
- Each lane produces the same records, by operation, text, author and pairing,
  as the same edit typed in suggesting mode.
- With no TrackChanges plugin, and while viewing snapshots, every lane writes
  nothing and reports it.
- An AI apply with formatting and text is one undo step.
- `buildAcceptedTextMap` reads a break as `"\n"` and leaves out a break pending
  deletion.
- A rich insertion of "**foo** bar", and a paste of it typed in suggesting
  mode, is one act.
- A direct AI accept writes a break where its proposal has `"\n"`.

## Release

This PR is docs only: no changeset, and the PR carries the `no-release` label.
The implementation PRs list every `@scrivr/*` package as `patch`; the lanes PR's
changeset carries the **Breaking** note above.

Delivery, each PR stacked on the one before:

1. This RFC.
2. The engine pairs a replacement (Decision 2), branch
   `suggestion-lanes-252-engine`.
3. The lanes (Decisions 1, 3, 4, 5, 6, 7).

## Files to create / modify

- `packages/plugins/src/track-changes/engine/trackTransaction.ts`,
  `lib/deletionPolicy.ts`, `helpers.ts`, `lib/mergeTrackedMarks.ts`,
  `types.ts` — pair a replacement (PR 2).
- `packages/plugins/src/track-changes/lib/applyDiffAsSuggestion.ts`,
  `lib/applyRichDiffAsSuggestion.ts`, `TrackChanges.ts` (`insertAsSuggestion`),
  `packages/ai/src/ai-suggestion/showHideApply.ts` (`_applyTracked`,
  `applyKeepFormatting`, `_applyDirect`'s `"\n"`) — plain edits under
  `trackAsSuggestion`, positions through `tr.mapping`.
- `packages/plugins/src/track-changes/lib/acceptedTextMap.ts` and
  `lib/applyRichDiffAsSuggestion.ts` (`collectAccepted`) — one reader of
  accepted text, and the map's doc comment.
- `packages/plugins/src/track-changes/lib/applyDiffAsSuggestion.ts`
  (`clearAuthorPendingMarks`) — withdraw a node-level deletion.
- `packages/plugins/src/track-changes/step-trackers/trackReplaceStep.ts` — the
  pieces of one step's insertion linked by `creationId`.
- `packages/plugins/src/track-changes/` — `suggestionBlocked`, exported from
  `packages/plugins/src/track-changes/index.ts`, with the barrel comment on the
  record builders corrected.
