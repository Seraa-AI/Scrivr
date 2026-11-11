---
"@scrivr/plugins": patch
---

`Collaboration` follows the room's revision stamp. When the room is sealed, the editor seals at once. `onSealed` reports that the client holds exactly what was sealed. `onStaleEdits` hands over work the server never received, as a document the host can keep. `onRevision` reports that the room was unsealed into a new revision. `watchRevision` exposes the same behaviour for a custom provider. A new guide, "Sealing a revision", shows how to wire the server functions into HocusPocus hooks.
