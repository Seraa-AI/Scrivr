---
"@scrivr/ai": patch
"@scrivr/core": patch
"@scrivr/docx": patch
"@scrivr/export-markdown": patch
"@scrivr/export-pdf": patch
"@scrivr/export-semantic": patch
"@scrivr/plugins": patch
"@scrivr/react": patch
---

Every suggestion lane is now recorded by the track-changes engine. `applyDiffAsSuggestion`, `applyMultiBlockDiff`, `applyRichDiffAsSuggestion`, the AI suggestion's tracked apply and `insertAsSuggestion` write plain edits under `trackAsSuggestion`, as a person typing in suggesting mode would, so a suggestion from any of them is recorded and reviewed the same way.

**Breaking:** `buildAcceptedTextMap` and `acceptedTextMapFor` now read a line break as `"\n"`, as the semantic export shows it. For a block with a break, `acceptedText`, `decoratedText` and the offsets in `map` change. A host that builds `proposedText` from a view without breaks would now propose deleting every break, so it should build it from `acceptedText`.

- A lane can now propose a line break, or its removal, from a `"\n"` in the proposed text.
- A replacement shows its new words before the words it strikes, as typing over a selection does. The lanes used to show the struck words first.
- A deletion takes only the text the lane read. An image, or another author's struck text, inside a deleted range is left as it is.
- An insertion is one change, whatever formatting or breaks it holds, so reviewing any part of it decides all of it. This holds for anyone: a formatted paste typed in suggesting mode is one change too.
- An AI apply writes its formatting and its words in one transaction, so it is one undo step.
- A lane writes nothing that would not be recorded: without the TrackChanges extension, while snapshots are viewed, or when tracking refuses the edit. It reports `applied: false`, or `false` from `applyAiSuggestion` and `insertAsSuggestion`, and an AI suggestion it did not apply stays pending.
- New: `suggestionBlocked(state, tr)` says why a suggestion would not be recorded, and `writeProposal` writes a block's diff as plain edits.
- Moving words you inserted yourself, still pending, along their paragraph in one edit (a drag) is now your insertion in its new place, not a move: nothing was there before to move from. The same keeps a lane that restates its proposal from recording its line breaks as moved.
- `clearAuthorPendingMarks` also withdraws the author's pending deletion of a break or image. The engine records no change for rewriting a node's review records, as it records none for taking off a review mark.

The other packages change only by version, released together with these.
