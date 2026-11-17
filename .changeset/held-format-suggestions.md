---
"@scrivr/core": patch
"@scrivr/plugins": patch
---

A colour, size, font or link set over another author's pending suggestion no longer drops it. The new change holds it: rejecting the new change gives theirs back, still theirs, and accepting it discards theirs. Removing another author's suggestion adds a removal beside it instead. Either can be decided alone, and rejecting everything returns the agreed value in one review.

What a host sees:

- `findChanges().pending` lists a held suggestion as its own mark change, with `within` naming the changes that hold it. Show it under its holder, as the popover's new `heldChanges` does, rather than as a card of its own on the text.
- `planReview` and `reviewChanges` may list in `rejected` changes the caller did not name: suggestions a decision leaves no place for, such as those held by a change being accepted. The plan names them before the review runs.
- `getRichBlocks` lists a held suggestion with `newAttrs`, the value it proposes, since the text shows its holder's. `SemanticChange` gains that field.
- Merging neighbouring tracked formatting no longer fuses another author's records, which renamed their ids.
