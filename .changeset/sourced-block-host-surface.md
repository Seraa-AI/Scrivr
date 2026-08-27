---
"@scrivr/core": patch
"@scrivr/ai": patch
"@scrivr/docx": patch
"@scrivr/export": patch
"@scrivr/export-markdown": patch
"@scrivr/export-pdf": patch
"@scrivr/export-semantic": patch
"@scrivr/plugins": patch
"@scrivr/react": patch
---

**Sourced blocks: the host's half**

Sourced blocks shipped with the document half reachable and the host half not.
A host could register providers and insert blocks, but the reconciler the
design hands it — read the provenance out of a document, compare a hash, see
which instances have drifted — was never exported, and the provider callback
for drift never fired.

- **`@scrivr/core`** — `collectSourcedBlocks`, `computeBlockHash`,
  `sourcedBlockDivergenceKey`, `NORMALIZER_VERSION` and their types are now
  exported. Reconciliation stays the host's to trigger (there is no safe
  trigger under collaborative editing); core supplies the pure parts.
- **`@scrivr/core`** — `SourceProvider.onInstanceChanged` now fires. It reports
  both facts and says which is which: `modified` is the document's, computed by
  hashing content against the base it was inserted with; `outdated` is the
  library's, and the editor only relays what the host told it. Nothing fires
  for the state a document already had when it opened.
- **`@scrivr/core`** — new `setSourcedBlocksOutdated({ instanceIds, outdated })`
  command and an `outdated` attr on the node. A library check answers for many
  instances at once, so the command takes a list and writes one transaction:
  one undo step, one repaint. Storing it as an attr rather than plugin state
  means one peer can run the check and every collaborator sees the result, and
  it survives a reload.
