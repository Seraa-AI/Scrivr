---
"@scrivr/core": patch
"@scrivr/plugins": patch
---

A read-only editor now refuses every edit made on this client, not just commands and typing: `applyTransaction` and header/footer surfaces are gated too. A collaborator's edits still reach a read-only viewer, including header and footer changes. New `editor.seal()` makes the document refuse every change from anyone; selection still moves. `applyTransaction`, `EditorSurface.dispatch`, `moveNode` and `ServerEditor.setContent` return `false` on a refusal (and `applyTransaction` also when a plugin's `filterTransaction` turns the transaction away), and the editor emits `"mutationDenied"` with the reason and origin. A caret move or a selection is never refused: when a plugin answers one with an edit the lock refuses (TrailingNode adding a paragraph), the move lands without it. `IBaseEditor` gains `sealed` and `seal()`, which a custom implementation must provide.
