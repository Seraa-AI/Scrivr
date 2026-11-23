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
- **Kept apart:** changes from two suggestions never fuse into one change or one act, even when they are adjacent and by the same author.
- **While pending:** a change keeps its operation id until it is decided, including when other changes from the same suggestion are decided first.
