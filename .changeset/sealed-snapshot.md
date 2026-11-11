---
"@scrivr/core": patch
"@scrivr/plugins": patch
---

New `createSnapshot(doc, { assignedRoles })`, which freezes a document into canonical JSON plus a SHA-256 `contentHash` and lists its signer fields. It refuses while tracked changes are pending, while a required role is unassigned, or when an assigned role has no field. `verifySnapshot` checks stored content against its hash, and `hashArtifact` hashes exported bytes such as the executed PDF. It also refuses a signer field with no id or role, or another field's id. `FieldCompletion` takes the snapshot's fields and paints each value inside its field's box, wherever the field is laid out.
