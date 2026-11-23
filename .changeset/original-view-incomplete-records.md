---
"@scrivr/plugins": patch
---

The original view undoes a tracked change whose record lacks its bookkeeping fields (`createdAt`, `updatedAt`, `reviewedByID`, `statusUpdateAt`), as the proposed view applies it. Before, such a record changed the proposed text but not the original, so the two views disagreed about the same change. A document a host stored or converted can carry such records; the editor repairs them on the next edit, and the views now repair them the same way on their own copy before deciding. The proposed view's `markdown` reads them as applied too.
