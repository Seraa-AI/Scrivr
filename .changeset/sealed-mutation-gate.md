---
"@scrivr/core": patch
"@scrivr/plugins": patch
---

A read-only editor now refuses every edit made on this client, not just commands and typing: `applyTransaction` and header/footer surfaces are gated too. A collaborator's edits still reach a read-only viewer, including header and footer changes. New `editor.seal()` makes the document refuse every change from anyone; selection still moves. `applyTransaction` and `EditorSurface.dispatch` return `false` on a refusal, and the editor emits `"mutationDenied"` with the reason and origin.
