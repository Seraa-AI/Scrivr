---
"@scrivr/core": patch
"@scrivr/plugins": patch
---

Collaboration state belongs to an editor, not to a configured extension.

`Collaboration` kept its Y binding in a map keyed by its own options object.
Options identify a *configured extension*, and one of those can serve more than
one editor — the natural split-view shape is to configure once and mount twice.
So the second editor's setup overwrote the first's entry, and undo and redo in
one pane drove the other pane's history.

It was worse before that: the entry was seeded per editor, so merely
constructing the second editor reset it to empty and left the first with no
binding at all — undo went dead in a pane nobody had touched. Tearing the second
one down nulled the shared entry too, so closing a pane disarmed its sibling.

The binding moves into `collaborationRegistry`, which is already keyed by the
editor and already documented as such — the cursor extension reads awareness
from the same entry. One registry with the right identity, rather than two with
different ones. `CollabState` gains `binding`.

`Image` carried the same options-keyed map with nothing reading it: its
`onViewReady` already returns the cleanup it needs, so the map only retained a
state object per configured instance. Removed.

This is the identity bug that put an inserted clause in the wrong document,
found in review and fixed at the seam last; these were the two remaining
holders of the pattern.
