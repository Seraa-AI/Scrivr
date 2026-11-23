---
"@scrivr/ai": patch
"@scrivr/plugins": patch
---

Every suggestion lane is now recorded by the track-changes engine. `applyDiffAsSuggestion`, `applyMultiBlockDiff`, `applyRichDiffAsSuggestion`, the AI suggestion's tracked apply and `insertAsSuggestion` write plain edits under `trackAsSuggestion`, as a person typing in suggesting mode would, so a suggestion from any of them is recorded and reviewed the same way.

**`@scrivr/plugins`**

**Breaking:** `buildAcceptedTextMap` and `acceptedTextMapFor` now read a line break as `"\n"`, as the semantic export shows it. For a block with a break, `acceptedText`, `decoratedText` and the offsets in `map` change. A host that builds `proposedText` from a view without breaks would now propose deleting every break, so it should build it from `acceptedText`.

- A lane can now propose a line break, or its removal, from a `"\n"` in the proposed text.
- A replacement shows its new words before the words it strikes, as typing over a selection does. The lanes used to show the struck words first.
- A deletion takes only the text the lane read. An image, or another author's struck text, inside a deleted range is left as it is, and the words around it stay one replacement.
- An insertion is one change, whatever formatting or breaks it holds, so reviewing any part of it decides all of it. This holds for anyone: a formatted paste typed in suggesting mode is one change too.
- A lane writes nothing that would not be recorded: without the TrackChanges extension, while snapshots are viewed, when tracking refuses the edit, or when the transaction carries a meta tracking skips. It reports `applied: false`, or `false` from `insertAsSuggestion`.
- `applyRichDiffAsSuggestion` no longer lists `rejected` bottom to top. It lists blocks the call named more than once first, then blocks it could not edit (held only by text proposed for deletion, or not a text block), then edits it could not apply, each in the order given. An id no block has is in `notFound`.
- `insertAsSuggestion` over a range spanning two blocks proposes joining them, as typing over that selection does; it used to strike and insert.
- New: `suggestionBlocked(state, tr)` says why a suggestion would not be recorded, as a `SuggestionBlock` (`no-tracking`, `viewing-snapshots`, `untracked`, or a tracking refusal); `writeProposal` writes a block's diff as plain edits. The plugin state carries the host's `skipTrsWithMetas`.
- Moving words you inserted yourself, still pending, along their paragraph in one edit (a drag) is now your insertion in its new place, not a move: nothing was there before to move from. The same keeps a lane that restates its proposal from recording its line breaks as moved.
- `clearAuthorPendingMarks` also withdraws the writer's own pending deletion of a break or image. Withdrawing one's own review records on a node records no change, as taking off one's review mark records none; rewriting another writer's records is undone. The writer is the author, and the suggestion when an `operationId` names one.

**`@scrivr/ai`**

- `applyAiSuggestion` writes its formatting and its words in one transaction, so an apply is one undo step, recorded by the engine in tracked mode.
- A phrase whose new words carry different formatting is one change, its new words before the struck ones.
- An apply that would not be recorded writes nothing, returns `false`, and leaves the suggestion pending.

