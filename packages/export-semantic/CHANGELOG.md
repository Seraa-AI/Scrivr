# @scrivr/export-semantic

## 1.0.19

### Patch Changes

- c8952d7: Extension bundles now compose instead of forwarding by hand, and keybinding
  precedence is explicit.

  `@scrivr/core`

  - **`addExtensions()`** — an extension may declare the sub-extensions it is
    composed of. `ExtensionManager` flattens them into its own list before any
    resolution phase, so every hook a member declares is collected exactly as if
    the consumer had listed it directly. `StarterKit` uses this and drops from 944
    lines to ~180: it previously re-implemented the manager's merge for **24 of
    27** contribution hooks, which meant each new seam had to be re-plumbed
    through the kit or it silently vanished for everyone using the default. Four
    hooks were already being dropped that way (`addCloneHandlers`, `addDocAttrs`,
    `addPageChrome`, `addSurfaceOwner`).
  - **`keymapPriority` + the `KeymapPriority` ladder** (`table` 400 → `codeBlock`
    300 → `list` 200 → `default` 100). Colliding keybindings now **chain** instead
    of last-wins: a command returning `false` means "not applicable here" and
    delegates to the next binding for that key. Priority decides who gets first
    refusal, which is how `Tab` can be cell navigation, code indentation, or list
    indentation depending on context. Previously bundles hand-chained this
    themselves and two independent extensions binding one key silently lost one of
    them.
  - Keymap precedence is deliberately **not** the extension list's order. That
    order already decides the schema's default block type — ProseMirror fills
    `block+` with the first registered block node — and one list cannot encode two
    orderings. `StarterKit`'s list now carries a single constraint (Paragraph
    first) and is otherwise free to reorder.
  - `findExtension()` returns the **last** match rather than the first, so
    `[StarterKit, Heading.configure({ levels: [1] })]` resolves to the caller's
    Heading rather than the kit's copy — consistent with how every other
    contribution resolves.
  - `Extension.configure()` accepts an optional argument, and `Extension.children()`
    / `flattenExtensions()` are exported for bundle authors.

  Behaviour change worth noting: an extension that previously _replaced_ a
  built-in keybinding by being registered later now chains behind it, and will not
  run if the built-in handles the key. Raise its `keymapPriority` to restore
  first refusal.

  The other packages carry a version-only bump (lockstep group).

- Updated dependencies [c8952d7]
  - @scrivr/core@1.0.19

## 1.0.18

### Patch Changes

- 287c6c0: **BREAKING (`@scrivr/plugins`):** the AI toolkit and AI-suggestion overlay have
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

- ff38bc1: **`@scrivr/core`:** namespace the `CellSelection` JSON id to `"scrivr:cell"`.

  Consumers of the same prosemirror-state instance share its selection JSON id
  registry, and `CellSelection` claimed the bare `"cell"` — the same id
  prosemirror-tables (which Tiptap ships) uses. An app running Tiptap alongside
  Scrivr threw `Duplicate use of selection JSON ID cell` at import time, whichever
  loaded second.

  `CellSelection` now registers under `"scrivr:cell"`, which cannot collide with
  theirs, and its `toJSON` emits the same namespaced id from a shared constant so
  the two can't drift. Duplicate Scrivr registrations still fail fast because two
  different `CellSelection` classes sharing one JSON id are not runtime-compatible.

  **Behavior change:** a persisted selection serialized before this release
  carries `"type": "cell"` and is no longer supported. Passing it to
  `Selection.fromJSON` throws because Scrivr no longer registers that id. The
  document itself is unaffected, and applications normally persist document JSON
  rather than transient editor selections.

  The other packages carry a version-only bump (lockstep group).

- da917c2: **`@scrivr/core`:** document clone mode.

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
  - **Typed lookup.** `cloneIdMap.getByType(oldId, typeName, kind?)` resolves the
    exact node, mark, or extension-owned id space when different types reuse the
    same source string; ordinary `get(oldId)` remains available for globally
    unique ids.
  - **Caller control.** `RecloneOptions` lets you restrict which types re-key
    (`shouldReclone`, so the map holds exactly what you chose) and set the new id
    values (`generate`). Pass them via `clone: { … }`.
  - **Tracked changes.** Change ids and their `referenceId`, `moveNodeId`, and
    `groupId` links are re-keyed together when the TrackChanges extension is in
    use, so a source and its clone can safely coexist.
  - **Extension hook.** Extensions can implement `addCloneHandlers()` to re-key
    their own id spaces or rewrite `nodeId` references during a clone, using the
    accumulated old→new map. Runs after the core re-key.

  Clone is a pure re-key: only non-null ids change; nulls are left as-is. Other
  custom id spaces pass through unless their owning extension contributes a clone
  handler. Clone is an explicit write, so it mints ids —
  distinct from the load-time read path, which never fabricates them.

  The other packages carry a version-only bump (lockstep group).

- 90e96e9: Substrate for node-level incremental re-embedding (freshness engine).

  `@scrivr/export-semantic` — new change-detection helpers so a consumer can
  re-embed only what changed between document versions instead of the whole doc:

  - `unitEmbeddingInput(unit)` — the canonical string to embed (`breadcrumb + text`),
    one source of truth for both embedding and hashing.
  - `unitContentHash(unit)` — deterministic hash of that input. Identical hash ⇒
    the vector is unchanged ⇒ skip re-embed. Formatting-only edits (bold, color,
    alignment) don't change it; a text or breadcrumb change does.
  - `diffSemanticUnits(prev, next)` — matches units by stable anchor id and returns
    `{ added, removed, changed, unchanged }`. Editing one paragraph marks exactly
    one unit changed.
  - `unitRichHash(unit)` — a formatting-aware companion hash (`type` + `breadcrumb` +
    `text` + `spans` + `attrs`). Unlike `unitContentHash` it DOES change on a
    formatting-only edit (bold, color, alignment), so it's the detector for the
    upcoming rich AI-edit loop, not embedding freshness.

  `@scrivr/core` — collab-safe stable ids. `UniqueId` now stamps a `nodeId` only on
  LOCAL edits; a remote Yjs apply (tagged `COLLAB_SYNC_META` by the collaboration
  binding) is skipped, so a block's id is assigned once by its author and synced
  rather than re-stamped with a divergent uuid on every receiving client. Also
  exports `fnv1aHex` + `stableStringify`, the shared hash + canonical serializer used
  by the document fingerprint and the per-unit hashes (no parallel copies).

  `@scrivr/plugins` — the Yjs binding marks remote applies with `COLLAB_SYNC_META`.

- de5fff9: Leaf-based rich semantic editing — an AI agent can now read a document with its
  formatting and write inline edits back that land as tracked-change suggestions,
  without churning the parts it didn't touch. The editable surface is the **leaf
  textblock addressed by its stable `nodeId`**; structure (lists, tables) stays
  read-only context. Replaces the earlier flattened-string merge that turned a
  verbatim echo of a list into hundreds of spurious changes.

  `@scrivr/ai`

  - `getRichBlocks(editor)` — the read half: semantic units where container units
    (lists, tables) expose their editable leaves as nested `parts`, each a
    paragraph/heading/codeBlock addressed by `nodeId`. The agent sees the grouping;
    every leaf is individually editable.
  - `applyRichEdit(editor, edit, { asSuggestion })` — the write half: resolves the
    target leaf by `nodeId`, auto-diffs against a per-leaf rich hash as a stale
    guard, and applies via the track-changes engine. When a whole **container**
    unit (list/table) is passed, its editable `parts` are diffed leaf-by-leaf and
    only the changed leaves are applied — the container is never sent to the
    leaf-only merge. Targets that no longer exist are reported via `notFound`; a
    rich edit resolving to a non-textblock is rejected, never flat-edited.
  - **zod schemas are first-class public API.** `RichSemanticEditSchema` plus the
    reused primitives (`InlineSpanSchema`, `InlineMarkSchema`) let any consumer
    `safeParse` untrusted agent output into validated, typed edits before it can
    touch the document. The structural-edit union is specced for later phases.

  `@scrivr/export-semantic`

  - Container units now carry `parts: SemanticPart[]` — the editable leaves inside
    a list or table, each with `nodeId` / `type` / `breadcrumb` / `text` / `spans`
    / `attrs`. A unit has EITHER `spans` (it is a leaf) OR `parts` (it is a
    container). The flat `text` projection for embedding is unchanged; `parts` is
    the universal edit surface. Table `cells` geometry stays read-only.
  - New `semanticPartRichHash(part)` — the formatting-aware hash for a single
    editable leaf, the freshness base for per-leaf auto-diff. `unitRichHash` now
    folds in a container's `parts`, so a formatting-only edit to a nested leaf is
    observable at the container level (previously invisible).

  `@scrivr/plugins`

  - Track-changes: `applyRichDiffAsSuggestion` now operates on a **single leaf
    textblock** — one text derivation over the leaf's real doc positions (no
    recursion into containers, no synthetic newline separators, no cross-package
    lockstep). Guards against non-textblock targets. Exported from the package's
    public API for `@scrivr/ai` to build on. `applyDiffAsSuggestion` imports
    `findNodeById` from `@scrivr/core` (canonical home).
  - An **attrs-only** rich edit no longer clears the author's pending inline text
    suggestion — only an edit carrying `spans` supersedes prior inline intent — so
    changing a block attr (e.g. alignment) preserves an in-flight text suggestion.

  `@scrivr/core`

  - `spansToFragment(spans, schema, opts)` reconstructs a ProseMirror inline
    fragment from agent-emitted `InlineSpan[]`, with `sameMark` / `resolveInlineMark`
    — the primitive that turns validated agent spans into real inline content.
  - `exports/semantic` gains the `SemanticPart` type and the `parts?` field on
    `SemanticUnit`.

  The other packages carry a version-only bump (lockstep group).

- d677454: `@scrivr/plugins`

  - Track-changes engine: `mergeTrackedMarks` now fuses adjacent **formatting**
    marks (bold/highlight/color/…), not only tracked insert/delete text. A run of
    the same mark with the same author, operation and status collapses to one
    tracking id — the grouping typed text already got, now for formatting. Marks
    with different own attrs (e.g. two colors) never merge. `trackTransaction`
    invokes the merge after `AddMarkStep`/`RemoveMarkStep` at both boundaries.

    Fixes a live-editing bug: bolding two adjacent words (or applying a mark in
    several steps over a run) previously produced one tracked change per segment
    instead of a single reviewable change.

- Updated dependencies [287c6c0]
- Updated dependencies [ff38bc1]
- Updated dependencies [da917c2]
- Updated dependencies [90e96e9]
- Updated dependencies [de5fff9]
- Updated dependencies [d677454]
  - @scrivr/core@1.0.18

## 1.0.17

### Patch Changes

- aea772a: `@scrivr/export-semantic` — new `semantic` export lane that emits AI-ready
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

  Lossless formatting on `SemanticUnit` (markdown can't express alignment/color/font):

  - `attrs` — the block's non-default styling (`align`, `indent`, `fontFamily`, list
    start, …), with identity/level bookkeeping stripped.
  - `spans` — inline formatting runs (`InlineSpan`), each carrying its marks + attrs
    (bold, italic, color, highlight, fontSize, link, …). Reconstructs `text` exactly.
  - Both also on `TableCell`; both emitted only when non-empty. Tracked-change marks
    are review metadata (surfaced in `changes`) and are excluded from `spans`; the
    TrackChanges extension registers a `trackedInsert` seam handler so it is kept in
    text but not treated as formatting.
  - `view: "proposed"` states the text contract explicitly (pending inserts included,
    pending deletes excluded into `changes`). `markdown` is a lossy convenience
    projection and is omitted when a unit has `changes`, so its redline rendering
    never contradicts the proposed `text`. Grouping's "short lede" test uses
    mark-aware length; `spans` are emitted only when they reconstruct the final text.

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

- Updated dependencies [aea772a]
  - @scrivr/core@1.0.17
