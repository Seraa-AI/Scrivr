---
"@scrivr/ai": patch
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
"@scrivr/export-semantic": patch
"@scrivr/docx": patch
---

**BREAKING (`@scrivr/plugins`):** the AI toolkit and AI-suggestion overlay have
moved out of `@scrivr/plugins` into a new package, **`@scrivr/ai`**. There are no
compatibility re-exports (pre-1.x hard move).

`@scrivr/ai` (new)

- Home of the AI layer: `AiToolkit` / `AiToolkitAPI` / `getAiToolkit`,
  `GhostText`, `AiCaret`, and the AI-suggestion overlay (`AiSuggestion`,
  `computeAiSuggestion`, `showAiSuggestion` / `applyAiSuggestion` /
  `rejectAiSuggestion`, `subscribeToAiSuggestions`, `createSuggestionPopover`,
  the op render helpers, and their types).
- Depends on `@scrivr/core` and `@scrivr/plugins`; it consumes the tracked-merge
  engine from `@scrivr/plugins`' public API.

Migration: `import { AiToolkit, getAiToolkit, AiSuggestion, … } from "@scrivr/ai"`
instead of `"@scrivr/plugins"`.

`@scrivr/plugins`

- No longer re-exports `ai-toolkit` / `ai-suggestion`.
- The tracked-merge engine stays here and is the seam `@scrivr/ai` builds on.
  Widened the public surface with the primitives that layer needs:
  `pairReplacements` / `PairedDiffOp` and the tracked-attrs builders
  (`addTrackIdIfDoesntExist`, `createNewPendingAttrs`, `createNewInsertAttrs`,
  `createNewDeleteAttrs`).
- Cycle fix: `applyDiffAsSuggestion` and `CitationHighlight` now import
  `findNodeById` from `@scrivr/core` (its canonical home) instead of through the
  moved `ai-toolkit`.

`@scrivr/react`

- The AI hooks/components (`useAiSuggestionPopover`, `useAiSuggestionCards`,
  `AiSuggestionCards`) import from `@scrivr/ai`. `@scrivr/ai` is a new optional
  peer dependency, mirroring `@scrivr/plugins`.

Behaviour is unchanged — this is a mechanical package extraction.
