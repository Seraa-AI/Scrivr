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

**`@scrivr/core`:** document clone mode.

Create an editor with `clone` to deep-copy its initial document into a fresh id
space: every node AND mark that carries a `nodeId` is re-minted, and the old→new
mapping is exposed via `editor.cloneIdMap` so references held outside the doc
(comment stores, citation indexes, semantic chunk tables) can be remapped onto
the clone. The source content is never mutated.

```ts
const editor = new ServerEditor({ content, clone: true });
editor.cloneIdMap; // ReadonlyMap<oldId, newId> | null
```

Available on both `ServerEditor` (headless) and the browser `Editor` — the logic
lives in the shared `BaseEditor`. The underlying primitive,
`recloneDocumentIds(doc, opts?) → { doc, idMap }`, is exported for callers that
want to re-key a document without an editor.

- **Schema-driven, custom nodes/marks included.** Any node (block or inline) or
  mark whose spec declares a `nodeId` attr is re-keyed — no per-type wiring.
- **Caller control.** `RecloneOptions` lets you restrict which types re-key
  (`shouldReclone`, so the map holds exactly what you chose) and set the new id
  values (`generate`). Pass them via `clone: { … }`.
- **Extension hook.** Extensions can implement `addCloneHandlers()` to re-key
  their own id spaces or rewrite `nodeId` references during a clone, using the
  accumulated old→new map. Runs after the core re-key.

Clone is a pure re-key: only non-null ids change; nulls are left as-is. Other id
spaces (tracked-change `id`, `referenceId`, `moveNodeId`) are self-contained in
the doc and pass through untouched. Clone is an explicit write, so it mints ids —
distinct from the load-time read path, which never fabricates them.

The other packages carry a version-only bump (lockstep group).
