---
"@scrivr/plugins": patch
---

A tracked change whose record lacks its timestamps (`createdAt`, `updatedAt`) is pending from the moment it is loaded, and decided like any other. Before, such a record, from a document a host stored or converted, changed the proposed text, but:

- the change set did not count it until the next edit repaired it;
- the original view did not undo it, so the two views disagreed about the same change;
- `reviewChanges` could not decide it.

`ChangeSet.isValidDataTracked` now requires a record's identity (id, author, operation, status). The new `ChangeSet.isCompleteDataTracked` also requires the timestamps. The next edit still fills them in, keeping the record's id.

Repairing such records on the next edit now touches only the record it repairs:

- A block record that says no operation is dropped alone. Before, it cleared every other change recorded on the block.
- Two formatting records on one mark are each stamped under their own id, and only on the text each covers. Before, there were two problems:
  - one record overwrote the other, because both matched on the shared missing `createdAt`;
  - the mark from the change's first character was written over its whole range, which erased another author's record on part of it.
- A conflict the change set works out between a pending insertion and deletion is no longer stored with a repaired record. Before, it stayed flagged after it was resolved.
- A paragraph split's reference record gets its timestamps. Before, it stayed unstamped, and the repair ran again on every edit.
