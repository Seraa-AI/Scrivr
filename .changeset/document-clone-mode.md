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

Create an editor with `clone: true` to deep-copy its initial document into a
fresh `nodeId` space: every id-bearing block is re-minted, and the old→new
mapping is exposed via `editor.cloneIdMap` so references held outside the doc
(comment stores, citation indexes, semantic chunk tables) can be remapped onto
the clone. The source content is never mutated.

```ts
const editor = new ServerEditor({ content, clone: true });
editor.cloneIdMap; // ReadonlyMap<oldNodeId, newNodeId> | null
```

Available on both `ServerEditor` (headless) and the browser `Editor` — the
logic lives in the shared `BaseEditor`. The underlying primitive,
`recloneDocumentIds(doc) → { doc, idMap }`, is exported from `@scrivr/core` for
callers that want to re-key a document without constructing an editor.

Only `nodeId` is re-keyed; tracked-change ids (`dataTracked.id`, `referenceId`,
`moveNodeId`) are self-contained within the doc and pass through untouched.
Clone is an explicit write, so it mints ids — distinct from the load-time read
path, which never fabricates them.

The other packages carry a version-only bump (lockstep group).
