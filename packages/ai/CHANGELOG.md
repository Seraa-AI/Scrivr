# @scrivr/ai

## 1.0.19

### Patch Changes

- 15dbf0c: **`@scrivr/core/pm` — one ProseMirror instance for the whole stack**

  `@scrivr/core` now publishes a `./pm` subpath that re-exports the ProseMirror surface Scrivr is
  built on: `prosemirror-model`, `-state`, `-transform`, `-commands`, `-keymap`, `-history`,
  `-inputrules`, `-schema-list`, `-markdown`.

  Extensions and downstream packages import from `@scrivr/core/pm` instead of the `prosemirror-*`
  packages directly, so they run against the same instance as the engine — the `instanceof` checks
  on `Node`, `Slice`, `Selection` and `Plugin` that the engine relies on can no longer be broken by
  a duplicate copy of `prosemirror-model` in the dependency tree. `prosemirror-view` is
  deliberately absent: there is no `EditorView` in Scrivr, so view-only hooks never run.

  - **`@scrivr/core`** — new `./pm` entry point (ESM + CJS + types). No change to the main barrel.
  - **`@scrivr/ai`, `@scrivr/docx`, `@scrivr/export-pdf`, `@scrivr/export-semantic`,
    `@scrivr/plugins`** — source imports moved to `@scrivr/core/pm`; direct `prosemirror-*`
    dependencies and peer ranges dropped. `@scrivr/ai` no longer declares any peer dependencies;
    `@scrivr/plugins` keeps `prosemirror-model`/`-state` peers only because `y-prosemirror` requires
    them, not for its own code.
  - **`@scrivr/export-markdown`** — dropped an unused `prosemirror-markdown` dependency.
  - **`@scrivr/export`, `@scrivr/react`** — version alignment only.

- fc33e99: **Hyperlinks survive DOCX export**

  A document exported to Word lost every hyperlink. The text came through, the
  link did not, and the export logged an `unsupported-mark` warning that no UI
  surfaces — so the first sign of it was a Word file where nothing was clickable.

  - **`@scrivr/core`** — new `DocxRunWrapper` contribution kind, and
    `DocxHandlers.markWrappers`. `DocxMarkHandler` contributes run _properties_,
    which is all bold or colour need; OOXML expresses a hyperlink as a
    `<w:hyperlink>` element wrapping the runs and carrying a relationship id, so
    no run property can produce one. That is why `Link` had no export handler at
    all rather than a broken one.
  - **`@scrivr/core`** — `Link` now contributes both halves: the wrapper that
    registers the relationship through the existing `ctx.rels.addHyperlink()`,
    and Word's built-in Hyperlink character style so the link looks like one. A
    link with no usable href stays styled text rather than emitting a `r:id` for
    a relationship that was never registered, which produces a file Word refuses
    to open.
  - **`@scrivr/docx`** — the walker applies wrapping marks around the run it just
    built, in the order the marks appear on the text, so two wrapping marks nest
    predictably.

- 87198ec: **Sourced Blocks**

  A new end-to-end system for embedding, tracking, and updating content blocks (such as clauses or definitions) that originate from an external library or provider.

  - **`SourcedBlock` Extension (`@scrivr/core`)** — A generic node wrapper that retains source metadata (`instanceId`, `kind`, `resourceId`, `versionId`, and `baseHash`). It leverages a new `insertSourcedBlock` command to seamlessly request and insert content from registered `SourceProvider` implementations.
  - **Divergence Detection (`@scrivr/core`)** — A built-in plugin hashes block content and compares it against the `baseHash` to detect if the local content has drifted from the source. Diverged blocks are visually indicated using a new `divergedGutter` theme property.
  - **Node Actions (`@scrivr/core`)** — Includes built-in Node Actions for Sourced Blocks, providing "Update to Latest", "Discard Local Edits" and "Detach from Library" capabilities based on user permissions.
  - **`layout` node spec declaration (`@scrivr/core`)** — Nodes now declare how they participate in layout, independent of what they mean in the document tree: `{ kind: "block" }` (the default — the node occupies its own box) or `{ kind: "transparent" }` (the node stays in the tree but contributes no box; its children lay out into the enclosing flow). Previously layout participation was inferred from the node's name — lists and tables expanded, everything else was assumed to be a text block — so a structural node like `sourcedBlock` laid out as a single empty line and never painted its content. The painter for a `block` node still comes from `addLayoutHandlers()`; folding the strategy into this declaration, and turning the text-block fallback into an error for undeclared nodes, is the next step.
  - **`addPasteTransforms()` (`@scrivr/core`)** — New extension seam for rewriting pasted content before it enters the document, applied by `PasteTransformer` to every clipboard flavour. This is the engine's equivalent of ProseMirror's `transformPasted` view prop, which never fires because Scrivr has no `EditorView`. Sourced blocks use it to re-mint `instanceId` so a pasted block is a second instance rather than a duplicate identity.
  - **DOCX Interoperability (`@scrivr/docx`)** — Sourced Blocks seamlessly round-trip through MS Word using `<w:sdt>` (Structured Document Tag) content controls. Source metadata is encoded in the `w:tag` attribute, meaning blocks retain their provenance even after being edited in Word. Provenance that would exceed the 255-character OOXML limit for `w:tag` is dropped with an export diagnostic rather than producing a file Word rejects.
  - **Semantic Mapping (`@scrivr/core`)** — Ensures Sourced Blocks preserve their boundaries and metadata when processed for semantic analysis.

- 1b42472: **Paste improvements**

  `@scrivr/core`

  - **Slice-accurate paste.** Copying now records the slice's open depths on the clipboard HTML (`data-pm-slice`, ProseMirror's own convention), and pasting rebuilds that slice exactly. Copy/paste inside the editor round-trips, including whitespace, which is document content in an internal slice but collapsible markup in foreign HTML.
  - **Inline HTML no longer splits the paragraph.** `fromHtml` previously forced `openStart: 0`, so pasting an inline fragment mid-sentence broke the paragraph into three. Openness is now derived from the pasted content: a default-attr paragraph merges into the cursor's block (matching Word/Docs), while anything carrying its own identity — a heading, a list, an aligned paragraph — stays a separate block and keeps its attrs.
  - **Paste without formatting (`Mod-Shift-v`).** Inserts the clipboard's text form only, skipping both HTML and markdown inference.
  - **Multi-line plain text becomes paragraphs** instead of one paragraph holding newline characters the canvas cannot render.
  - **Image paste.** A screenshot or image file on the clipboard is inserted as an image node, sized to its natural dimensions and scaled to fit the page. The default embeds an inline `data:` URL; the new `uploadPastedImage` editor option takes the bytes and returns a URL instead. Ignored when the clipboard also carries HTML, so a web-page image copy is not inserted twice.
  - **Word/Outlook lists.** Word emits lists as `mso-list`-tagged paragraphs whose bullet is literal text; these are now rebuilt into real `bulletList`/`orderedList` nodes, nesting included, with the marker glyphs dropped.
  - **Image placement survives an HTML round-trip.** `wrapMode`, `xAlign`, `x`, `yOffset`, `zIndex`, `margin`, and `verticalAlign` now serialize to and parse from `data-*` attributes; copying a floating image previously pasted it back as inline. One declaration drives both directions.
  - **`safeImageUrl`** — image `src` now accepts inline base64 `data:` URLs for raster types (png, jpeg, gif, webp, bmp, avif). `image/svg+xml` stays rejected, since SVG can carry script. Link `href` keeps the stricter `safeUrl` gate. This is what lets a pasted screenshot, and an image imported from a `.docx`, survive ingestion.
  - New public exports: `serializeSelectionToHtml`, `serializeSelectionToText`, `SLICE_DATA_ATTR`, `safeImageUrl`, `PasteOptions`, `PasteTransformerOptions`.

  `@scrivr/docx`

  - Adds a chain round-trip test covering images in all five wrap modes across export → import → clipboard copy → paste.

  Other packages are version-only (lockstep).

- e2431a2: **Section substrate**

  `@scrivr/core` gains the boundary-derived section model that per-section
  columns, page chrome, and page geometry will build on
  (`docs/sections-roadmap.md` step 1).

  - **`sectionBreak`** — a block atom carrying the settings of the section it
    terminates, mirroring DOCX's paragraph-level `sectPr` ownership. The body
    tree stays flat.
  - **`doc.attrs.finalSection`** — settings for the trailing section, which has
    no terminating break.
  - **`deriveSections(doc)`** — projects the boundaries into `{ id, from, to,
breakPos, settings }` ranges. Pure, mints no ids, and never persists
    positions, so it is safe on the read path.
  - **Commands** — `insertSectionBreak`, `setSectionSettings`,
    `removeSectionBreak`. Inserting copies the current section's settings to both
    halves; removing merges forward, which is Word's behavior and also what a raw
    deletion of the node produces.
  - **Layout** — a `continuous` break has no flow effect, `nextPage` starts the
    next page, and `evenPage`/`oddPage` skip a page when the next one has the
    wrong parity. Documents with no section break are unchanged.

  Also in `@scrivr/core`: pasted content now goes through `recloneDocumentIds`,
  so a clipboard paste no longer duplicates the source nodes' persistent
  structural ids into the destination document.

  All other `@scrivr/*` packages bump for lockstep version alignment only — no
  code changes in them.

- 4c0b3f4: **Sourced blocks: the host's half**

  Sourced blocks shipped with the document half reachable and the host half not.
  A host could register providers and insert blocks, but the reconciler the
  design hands it — read the provenance out of a document, compare a hash, see
  which instances have drifted — was never exported, and the provider callback
  for drift never fired.

  - **`@scrivr/core`** — `collectSourcedBlocks`, `computeBlockHash`,
    `sourcedBlockDivergenceKey` and `NORMALIZER_VERSION` are now exported, along
    with the provider contract a host implements against: `SourceProvider`,
    `SourceContent`, `SourceSearchResult`, `SourceCapability`,
    `SourcedBlockEvent`, `SourcedBlockChangedEvent`, `SourcedBlockOptions`,
    `SourcedBlockRecord`, `SourcedBlockDivergenceState`. Reconciliation stays the
    host's to trigger (there is no safe trigger under collaborative editing);
    core supplies the pure parts.
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

- Updated dependencies [15dbf0c]
- Updated dependencies [fc33e99]
- Updated dependencies [87198ec]
- Updated dependencies [81f1b00]
- Updated dependencies [1b42472]
- Updated dependencies [e2431a2]
- Updated dependencies [4c0b3f4]
- Updated dependencies [c8952d7]
  - @scrivr/core@1.0.19
  - @scrivr/export-semantic@1.0.19
  - @scrivr/plugins@1.0.19

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

- Updated dependencies [287c6c0]
- Updated dependencies [ff38bc1]
- Updated dependencies [da917c2]
- Updated dependencies [90e96e9]
- Updated dependencies [de5fff9]
- Updated dependencies [d677454]
  - @scrivr/core@1.0.18
  - @scrivr/plugins@1.0.18
  - @scrivr/export-semantic@1.0.18
