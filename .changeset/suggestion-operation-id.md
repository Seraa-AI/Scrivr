---
"@scrivr/core": patch
"@scrivr/plugins": patch
"@scrivr/ai": patch
---

A host can name the suggestion a tracked change came from. Pass an `operationId`, such as a review row's id, when writing a suggestion. It is stored on every change that suggestion writes (`dataTracked.operationId`) and shown on each change in the semantic export (`SemanticChange.operationId`). So the document itself can say which suggestion a change belongs to, even when a host's own record of it is lost.

- **Where it's accepted:**
  - `trackAsSuggestion(tr, authorID, { operationId })`;
  - `applyAiSuggestion`;
  - `applyDiffAsSuggestion`, `applyMultiBlockDiff` and `applyRichDiffAsSuggestion`;
  - `AiToolkit.applyRichEdit` and `applySemanticEdits` (new `AgentEditOptions` type), covering text, structural and image-layout changes.
- **Own work is the same author and the same suggestion.** One agent's two suggestions never touch each other's changes. A later suggestion:
  - never fuses with an earlier one's change, and never joins its replacement or act;
  - never folds into a block the earlier one created;
  - never takes back its insertion or split;
  - never replaces its formatting;
  - never withdraws its changes when a lane rewrites the block.

  So deciding one suggestion never decides another, and each keeps exactly the changes it wrote. Re-applying the same suggestion still replaces its own changes. Changes written with no operation id keep the author-only rule.
- **While pending:** a change keeps its operation id until it is decided, including when other changes from the same suggestion are decided first.
- **Not yet taken:** `insertAsSuggestion` does not accept an operation id.
