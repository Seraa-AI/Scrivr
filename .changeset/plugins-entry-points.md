---
"@scrivr/plugins": patch
"@scrivr/react": patch
---

`@scrivr/plugins` and `@scrivr/react` import without the packages they list as optional. Before, both loaded `yjs`, `y-prosemirror` and `@hocuspocus/provider`, and `@scrivr/react` also loaded `@scrivr/plugins` and `@scrivr/ai`. So an app without collaboration, track changes or AI crashed on import unless it installed them all.

- **Each plugin has its own entry:** `@scrivr/plugins/collaboration`, `/track-changes`, `/header-footer`, `/citation-highlight` and `/sealed-viewer`. Within each of ESM and CommonJS, entries share one copy of each module, so a plugin key from the root and from its own entry are the same key.
- **Breaking:** collaboration is no longer exported from the root. Import `Collaboration`, `CollaborationCursor`, the revision and sealing helpers (`stampSeal`, `snapshotFromYDoc`, `watchRevision` and the rest) and their types from `@scrivr/plugins/collaboration`. The root still exports every other plugin.
- **Breaking:** `@scrivr/react` no longer re-exports `Collaboration` and `CollaborationCursor`. Import them from `@scrivr/plugins/collaboration`.
- **Breaking:** `@scrivr/react`'s root needs only `@scrivr/core`. Its components built on the optional packages have their own entries:
  - `@scrivr/react/track-changes`, which needs `@scrivr/plugins`: `TrackChangesPopover`, `TrackChangesPanel`, `useTrackChangesPopover`, `useTrackChangesPanel`, `useReviewAction`, `ReviewRefusalNotice`, `describeSuggestionRefusal` and their types;
  - `@scrivr/react/header-footer`, which needs `@scrivr/plugins`: `HeaderFooterRibbon`, `useHeaderFooterRibbon` and their types;
  - `@scrivr/react/ai`, which needs `@scrivr/ai`: `AiSuggestionCardsPanel`, `useAiSuggestionCards`, `AiSuggestionPopover`, `useAiSuggestionPopover`, `useBlockMarkerOverlay` and their types.

  Import them from there instead of `@scrivr/react`.
- `Collaboration`'s and `CollaborationCursor`'s option types are exported, as `CollaborationOptions` and `CollaborationCursorOptions`.
