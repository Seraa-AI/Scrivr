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
- Two formatting records on one mark are each stamped under their own id. Before, one overwrote the other, because both matched on the shared missing `createdAt`, and the second repair rebuilt the mark as it was before the first.
- A paragraph split's reference record gets its timestamps. Before, it stayed unstamped, and the repair ran again on every edit.
