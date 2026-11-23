---
"@scrivr/plugins": patch
"@scrivr/react": patch
---

`@scrivr/plugins` and `@scrivr/react` import without the collaboration packages. Before, both loaded `yjs`, `y-prosemirror` and `@hocuspocus/provider`, although they are optional peers, so an app without collaboration crashed on import unless it installed all three.

- **Each plugin has its own entry:** `@scrivr/plugins/collaboration`, `/track-changes`, `/header-footer`, `/citation-highlight` and `/sealed-viewer`. Within each of ESM and CommonJS, entries share one copy of each module, so a plugin key from the root and from its own entry are the same key.
- **Breaking:** collaboration is no longer exported from the root. Import `Collaboration`, `CollaborationCursor`, the revision and sealing helpers (`stampSeal`, `snapshotFromYDoc`, `watchRevision` and the rest) and their types from `@scrivr/plugins/collaboration`. The root still exports every other plugin.
- **Breaking:** `@scrivr/react` no longer re-exports `Collaboration` and `CollaborationCursor`. Import them from `@scrivr/plugins/collaboration`.
- `@scrivr/react` declares `@scrivr/plugins` and `@scrivr/ai` as required peers. It always imported both, so the old optional declaration let an install miss them: install them with it.
- `Collaboration`'s and `CollaborationCursor`'s option types are exported, as `CollaborationOptions` and `CollaborationCursorOptions`.
