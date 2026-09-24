---
"@scrivr/core": patch
---

A document waits for the faces it is written in before it is shown.

Installing owned bytes is asynchronous and nothing held the first layout for
it, so a document was measured against whatever the host substitutes for a
family it does not have, then re-measured against the real faces when they
landed. On a dense document that re-breaks every line — the flash of jumbled
text on load.

Worse than a swap, the intermediate state was not even internally consistent.
Faces install one at a time and the resolver read the set as it filled, so a
line holding regular and bold text could be measured with the real face for one
run and a fallback for the other, and its runs placed from two typefaces at
once. That is what put them on top of each other rather than merely in the
wrong font.

Two changes. A set of faces is now published in one go rather than as it fills,
so the resolver never answers from half of one. And font installation is part
of becoming ready: `loadingState` reports `"syncing"` until the faces a
document asks for are in, on construction and again when a collaborative
document syncs — the requests come from the document itself, so they are known
before anything is measured.

Only the first attempt waits. A face that cannot be installed at all resolves
as generic and is reported, exactly as before, rather than holding the document.
