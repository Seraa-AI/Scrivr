---
"@scrivr/core": patch
"@scrivr/plugins": patch
---

New functions for a host to enforce a seal from its own collaboration server. Scrivr does not ship a server extension.

- `stampSeal` and `stampEditable` write a revision stamp into the room, so every client sees the seal on its next sync. `readRevisionStamp` and `isSealed` read it.
- `snapshotFromYDoc` seals the document a room holds.
- `matchesSnapshot` and `resetToSnapshot` catch a room whose cached state drifted from its seal, and put it back.
- `docFromYDoc` reads a room's document together with its attributes.
- Core's new `contentHashOf(doc)` gives the hash a snapshot would carry.
