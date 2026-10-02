---
"@scrivr/plugins": patch
"@scrivr/ai": patch
---

`acceptedTextMapFor` — the accepted-text map, memoised on the block node.

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
