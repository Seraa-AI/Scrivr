---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
"@scrivr/export-semantic": patch
"@scrivr/docx": patch
---

`@scrivr/export-semantic` — new `semantic` export lane that emits AI-ready
`SemanticUnit[]` for RAG pipelines. `toSemanticUnits(editor)` walks the document
tree headless (ServerEditor, from `contentJSON`) and produces ordered units
carrying structure, stable identity (`nodeId`, with a deterministic positional
fallback), and heading breadcrumb. Ships a `SemanticExport` extension — add it to
the editor and call `editor.commands.exportSemantic()` (downloads a `.json`, or
pass `{ onExport: units => … }` to receive the data headlessly), mirroring
`DocxExport` / `PdfExport`.

`@scrivr/core` — `IBaseEditor` now declares `getMarkdownSerializer()` (both
`Editor` and `ServerEditor` already implement it) so headless export lanes can
serialize arbitrary node groups.

`@scrivr/core` — adds the canonical `semantic` handler types (`SemanticUnit`,
`TableCells`, `SemanticNodeHandler`, `SemanticMarkHandler`, `UnitCtx`) and, via
the per-extension `addExports().semantic` seam, node handlers for paragraph,
heading, list, table (structured cells with gridSpan/vMerge), codeBlock,
horizontalRule, pageBreak, and image. Unregistered nodes degrade to a visible
`type:"unknown"` unit rather than being dropped.

`@scrivr/plugins` — TrackChanges contributes a `semantic` mark handler so
suggested-deletion text is excluded from unit text (not embedded) while inserted
text is kept.

Deterministic block identity (fixes non-deterministic chunk ids):

- `UniqueId` now ships in `@scrivr/core` and is bundled in **StarterKit** (opt
  out with `StarterKit.configure({ uniqueId: false })`), so stable, persisted
  block `nodeId`s are the default with or without the AI toolkit. It also now
  preserves pending `storedMarks` when it stamps, so mark inheritance across an
  Enter split is unaffected. `@scrivr/plugins` re-exports `UniqueId` /
  `findNodeById` from core for back-compat.
- `ServerEditor` no longer fabricates block ids on load. A headless read/emit
  surface must be deterministic: it preserves persisted `nodeId`s and never
  stamps random ones, so loading the same `contentJSON` twice yields the same
  ids (previously every load churned ids, breaking chunk identity and causing
  duplicate chunk sets). The interactive `Editor` still assigns ids on load, and
  `normalizeDocument({ assignIds })` remains available for explicit assign passes.
