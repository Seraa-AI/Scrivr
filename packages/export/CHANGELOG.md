# @scrivr/export

## 1.0.10

### Patch Changes

- 6d6f642: `@scrivr/core` — new `addPageConfig?(): PageConfig | undefined` extension
  lane. Extensions can now contribute page dimensions, margins, and the
  pageless toggle through the same first-class hook pattern used for nodes,
  marks, page chrome, etc. `ExtensionManager.buildPageConfig()` resolves the
  config by iterating the lane rather than looking extensions up by name —
  the manager no longer hardcodes `"pagination"` or `"starterKit"`.

  Behavior changes:

  - `Pagination` extension now implements `addPageConfig()` returning its
    configured `PageConfig` options.
  - `StarterKit` implements `addPageConfig()` reading its nested
    `pagination` option. Returns `undefined` when unset (so a downstream
    `Pagination.configure(...)` wins cleanly), the partial-merged config
    when set to an object, and `undefined` again when set to `false`.
  - Multi-provider warning fires when two extensions contribute non-undefined
    page configs — same pattern as the initial-doc lane.
  - The two `Extension.options` runtime predicates (`isPageConfig`,
    `readStarterKitPagination`) that existed to dodge `as` casts on
    `unknown` option lookups are gone — the typed lane removes the need.

  The `[StarterKit, Pagination.configure(usLetter)]` user pattern continues
  to resolve to `usLetter`. Bare `[StarterKit]` continues to render at
  `defaultPageConfig` via Editor's existing fallback chain.

  Future: when page config moves to `doc.attrs.pageSettings` (see
  `project_page_config_to_docattrs` memory — collaborative page settings,
  ruler-driven margin drags), the same `addPageConfig` lane stays in place
  and the extension just sources from `state.doc.attrs.pageSettings`
  instead of `this.options`. No manager-side rewiring needed.

  Other packages: lockstep version bump, no behavior change.

- 1db8abc: `@scrivr/core` — extension authors now get a `console.warn` whenever one
  extension silently overrides another's node, mark, keymap binding, command,
  input handler, markdown parser token, or markdown serializer rule (per kind
  or lane). Each warning names the previous and new contributor so accidental
  typos that shadow built-ins surface immediately. Doc attrs and surface owners
  remain `throw` on collision; the new warn lane covers everything else where
  override is sometimes intentional but always worth knowing about.

  Additionally:

  - New baseline warning when an extension overrides ProseMirror's required
    `doc` or `text` node — points at `addDocAttrs()` as the supported path for
    doc-level data.
  - New warning when more than one extension provides an initial document
    (e.g. `Collaboration` + `DefaultContent` stacking).
  - `buildSchemaFromPhase1` no longer mutates its input contributions object.
  - `Phase1SchemaContributions` now types `nodes` / `marks` as `NodeSpec` /
    `MarkSpec` instead of `object`, removing two `as` casts from the schema
    merge step.
  - `buildPageConfig` reads `Extension.options` via runtime predicates
    (`isPageConfig`, `readStarterKitPagination`) instead of unchecked `as`
    casts.

  Internal refactor: nodes, marks, keymap, commands, input handlers, markdown
  parser tokens, markdown serializer rules, and doc-attrs all share one
  `mergeContributions<T>()` helper with a `"warn"` / `"throw"` policy.

  Other packages: lockstep version bump, no behavior change.

- 2f74d3e: `@scrivr/core` — new first-class `HardBreak` extension, individually
  importable as `import { HardBreak } from "@scrivr/core"` and matching
  the shape of the other built-ins (Bold, Heading, HorizontalRule, etc.).

  Previously the `hardBreak` node lived bundled inside the `Document`
  extension and the `Shift-Enter` keymap was hardcoded in `BaseEditing`.
  That made it impossible to opt out cleanly, to swap in a different
  implementation, or to disable just the shortcut while keeping the node.

  The new extension owns:

  - The `hardBreak` inline-leaf node spec
  - The `Shift-Enter` keymap (gated by `shortcut: boolean` option)
  - The `insertHardBreak()` command (`editor.commands.insertHardBreak()`)
  - The markdown serializer rule (with trailing-break suppression — a
    trailing hardBreak no longer leaks a stray `\\\n` into the output)
  - The markdown PARSER token mapping (new — closes a long-standing
    asymmetry where the old `Document` extension serialized hard breaks
    but couldn't parse them back in, throwing `Token type "hardbreak"
not supported` on any markdown input containing one)

  `Document` shrinks to contributing only the baseline `text` markdown
  serializer rule (kept here because every doc has text nodes and
  prosemirror-markdown needs an explicit serializer for them).
  `BaseEditing` drops its Shift-Enter binding entirely — Backspace,
  Delete, Mod-a, and arrow navigation are still owned there.

  `StarterKit` gains a new option:

  ```ts
  StarterKit.configure({
    hardBreak: false, // drop entirely
  });

  StarterKit.configure({
    hardBreak: { shortcut: false }, // keep node + command, drop Shift-Enter
  });
  ```

  Default behavior is unchanged: `StarterKit` includes `HardBreak` with
  the Shift-Enter shortcut bound, so existing apps see no observable
  difference except that `ServerEditor({ content: "alpha\\\nbeta" })`
  now parses correctly instead of throwing.

  19 tests cover the extension surface (node shape, keymap presence /
  opt-out, command behaviour against a real `ServerEditor`, markdown
  parse + serialize + full roundtrip including the trailing-break edge
  case), regression guards proving `Document` and `BaseEditing` no
  longer own this responsibility, and `StarterKit` integration through
  all three option shapes (`undefined`, `false`, `{ shortcut: false }`).

  Other packages: lockstep version bump, no behavior change.

- 6c1945a: Collaborative headers & footers (Phase 5 of the header-footer plan).

  **`@scrivr/core`** — `ExtensionManager` exposes `getDocAttrNames()` and
  `getDocAttrOwners()`, sourced from the doc-attr ownership map already built
  during schema construction. `IBaseEditor` grows `getDocAttrNames(): string[]`
  so headless consumers (collab bindings, future audit tooling) can read the
  declared-attr whitelist without touching schema internals. `BaseEditor`
  implements the delegation, inherited by `Editor` and `ServerEditor`. Pure
  additive surface.

  **`@scrivr/plugins`** — `YBinding` now syncs `doc.attrs` across peers via a
  sibling `Y.Map("prose_doc_attrs")` keyed by attr name with `DocAttrEnvelope`
  values (`{ localSeq, value }`). Header/footer policy edits propagate between
  peers, late joiners adopt the room's current policy on `markSynced`, and
  the `Y.UndoManager` scope grows to cover the attrs map so Cmd-Z reverses a
  policy change like any other document edit. The whitelist comes from
  `editor.getDocAttrNames()` so only declared attrs cross the wire; undeclared
  keys and malformed envelopes are silently dropped. Yjs remains authoritative
  for conflict resolution — `localSeq` is a local dedup hint, not a tiebreaker.

  `HeaderFooterRibbon` placement fix (it now sits above the header band rather
  than overlapping the painted header content).

  **`@scrivr/react`** — `HeaderFooterRibbon` + `useHeaderFooterRibbon` updated
  to match the new ribbon-placement contract.

  **`@scrivr/export`, `@scrivr/export-pdf`, `@scrivr/export-docx`,
  `@scrivr/export-markdown`** — lockstep version bump only; no behavior change.

- 4c2dd5e: `@scrivr/core` — regression coverage for `PasteTransformer` and the
  markdown ingestion path against real-world hostile inputs. No
  functional changes; documents what the existing pipeline already does.

  `PasteTransformer.test.ts` gains five new describe-blocks asserting
  the cleaning contract on every output doc:

  - **drops script and style elements** — `<script>`, `<style>`, nested
    scripts inside divs
  - **strips event-handler attributes** — `onerror`, `onclick`,
    `onmouseover`, body-level `onload`
  - **rejects forbidden URL schemes** — `javascript:`, `data:text/html`,
    `vbscript:`, `file:`, plus obfuscation variants (mixed case,
    whitespace prefix, HTML-entity-encoded scheme)
  - **ignores embedded objects** — `iframe`, `object`, `embed`, `form`
  - **SVG content model** — `<svg><script>`, `<svg onload>`

  Plus a deeply-nested-wrappers case proving the cleaning walks through
  any depth.

  `parseMarkdown.test.ts` (new file) covers the markdown ingestion path
  the constructor uses when given `content: "..."`. With
  `MarkdownIt({ html: false })` raw HTML in markdown source survives as
  literal text — safe in every render target the framework supports
  (canvas paints glyphs, exports use textContent / structured writers,
  DOM renderers are required to use textContent per the security model).
  The structural and URL invariants are asserted; the literal-text
  behavior is documented as intentional.

  Each describe-block reads as a normal regression test for how the
  component behaves under hostile input — not as a labelled "security
  suite" that would advertise the threat surface or frame defenses as
  separable from the features they protect.

  Comment cleanup along the way: removed temporal references from
  `Document.ts` ("hardBreak lives in its own HardBreak extension as of
  the extraction PR") and `HardBreak.ts` ("Previously bundled inside
  the Document extension. Extracted so it...") that coupled the code
  to specific PR work.

  Other packages: lockstep version bump, no behavior change.

- fcd166b: **Popover UX — close on editor focus loss.** Floating menus (bubble menu,
  slash menu, link popover, image menu, floating block menu, AI suggestion
  popover, track-changes popover) now hide when the editor loses DOM focus
  to something that isn't the popover itself. Previously they stayed
  anchored to invisible selection state when the user clicked into a sidebar,
  the browser address bar, or another window — the classic "feels weird"
  artifact of subscribing only to PM state changes (DOM blur leaves the
  selection untouched).

  New `subscribeEditorFocusOutside(editor, onHide, { getPopoverElement? })`
  helper in `@scrivr/core/menus` is the shared signal source. Defers the
  hide one microtask so a click _into_ a popover (which blurs the editor
  then focuses an input inside) settles before the check runs.

  Popover detection, in priority:

  1. `getPopoverElement()` — accessor returning the popover's root DOM node.
     Each `createXMenu` controller now accepts this, and each React hook
     threads its `rootRef.current` through. Bulletproof for internal
     popovers — no marker attribute required.
  2. `[data-scrivr-popover="<menu-name>"]` ancestor — fallback for vanilla
     / third-party popovers that don't have a ref accessor. The seven React
     components ship with a named marker (`bubble-menu`, `link-popover`,
     etc.) as defense in depth and to keep DOM inspection self-documenting.

  Header/footer surfaces are intentionally excluded — they're a persistent
  editing mode, not a popover.

  **`cx` utility upgrade.** The class-name combiner in `@scrivr/react/utils`
  now accepts strings, numbers, falsy values, nested arrays, and conditional
  dictionaries in addition to the previous string-only positional form. The
  eight existing callers continue to work unchanged (they pass positional
  strings, which the new shape handles identically). New shapes available:

  ```ts
  cx("btn", isActive && "btn-active"); // already worked
  cx("btn", { "btn-active": isActive }); // NEW — conditional dict
  cx(["base", flagged && "flag"]); // NEW — nested arrays
  cx("col-", count); // NEW — numbers
  ```

  Return contract preserved: `string | undefined`. Tailwind utility-class
  conflicts are NOT auto-merged (pull in `tailwind-merge` for that).

  **React test runner bootstrap.** `@scrivr/react`'s `"test": "true"`
  placeholder is replaced with real vitest + a node-environment config.
  First occupant: 15 tests for the upgraded `cx` covering positional
  strings, conditional dicts, nested arrays, numbers, dedup order, and the
  documented Tailwind non-merge limitation. Removes one item from the
  stable-1.x roadmap's "React adapter has no regression tests" gap.

  Other packages: lockstep version bump, no behavior change.

- b61e408: `@scrivr/core` — central URL allow-list at the document boundary. PR 2
  of the pre-1.x security baseline (`SECURITY.md` shipped in PR 1).

  Adds `safeUrl(value)` in `@scrivr/core/model`. Returns the trimmed input
  when the value is safe to store, `null` when it isn't. Allow-list:
  `http`, `https`, `mailto`, `tel`, fragment-only (`#anchor`), and
  relative URLs. Everything else — `javascript:`, `data:`, `vbscript:`,
  `file:`, unknown custom schemes — returns `null`. Strips ASCII control
  characters before validating so the classic `"java\x00script:"`
  obfuscation can't slip past a naive prefix check. Trims whitespace.
  Case-insensitive scheme match per RFC 3986. Defensive against non-string
  input so callers reading from `unknown`-typed sources (collab apply,
  parseDOM attribute getters) can pass values through without their own
  type guard.

  Wired at every URL ingestion point in `Link` and `Image`:

  - `Link` parseDOM — `<a href="javascript:...">click</a>` → mark dropped,
    text preserved (returning `false` from `getAttrs` is the canonical
    "drop this match" signal)
  - `Link.setLink` command — prompt validated; unsafe input is a no-op
  - `Link.setLinkHref` command — returns `false` on unsafe href; safe
    href stored normalised
  - `Image` parseDOM — `<img src="javascript:...">` → node dropped entirely
  - `Image.insertImage` command — prompt validated; unsafe input is a no-op

  **JSON-load gate** — addresses the codex-flagged gap that parseDOM-only
  validation leaves: `schema.nodeFromJSON` bypasses parseDOM entirely, so
  a saved doc on disk with `link.attrs.href = "javascript:..."` would
  round-trip unchanged.

  New `sanitizeDocUrls(doc, schema)` walks a constructed PM doc and
  applies the same allow-list to URL-bearing attrs. Image with unsafe
  `src` → node dropped. Link mark with unsafe `href` → mark stripped,
  text and co-occurring marks preserved. Cheap idempotent fast-path: a
  clean doc returns the same `Node` reference, no allocation.

  Wired at both raw-JSON ingestion sites:

  - `BaseEditor` constructor — covers `content: json`, `content: "markdown"`,
    and extension-supplied `addInitialDoc()` (like `DefaultContent`) in
    one place
  - `ServerEditor.setContent(json)` — runtime doc replacement

  **Out of scope** (deliberate, separate PRs):

  - **Collab Y→PM apply** — `yXmlFragmentToProseMirrorRootNode` bypasses
    both parseDOM and constructor init. Adversarial-peer trust is already
    documented in `SECURITY.md` as an app-layer concern (auth, validation,
    potentially E2EE). A post-apply walker is a separate design.
  - **Hand-rolled raw-node transactions** (`editor.applyTransaction(tr.replaceWith(0, 5, rawNode))`)
    — covered if the node came through commands, not if hand-rolled. A
    doc-wide transaction filter would catch it but trades for per-keystroke
    overhead. Defer.

  **Bonus cleanup** (the user's no-`as` rule extends here):

  - New `getNodeAttrs<K>` / `getMarkAttrs<K>` typed accessors in
    `@scrivr/core/model`. Look up `NodeAttributes[K]` / `MarkAttributes[K]`
    augmentations to give extension authors typed `attrs.src` /
    `attrs.href` access. Single `as` lives inside the helper behind a
    runtime kind check — no scattered casts at usage sites.
  - Augmented `NodeAttributes.image` (existing `MarkAttributes.link` was
    already in place from a prior PR).
  - Removed 4 scattered `as` casts from `Link.ts` and `Image.ts`. Zero
    type assertions remain in either file.

  **Tests** (43 new):

  - 25 fuzz tests on `safeUrl` covering all the agreed obfuscation
    scenarios from the security baseline plan
  - 11 tests on `sanitizeDocUrls` covering helper behaviour + ServerEditor
    constructor + setContent integration
  - 7 integration tests on `Link` covering parseDOM rejection and command
    rejection

  All 12 monorepo typecheck tasks pass. All 11 test tasks pass.

  Other packages: lockstep version bump, no behavior change.

- 6d49fe0: **Repo:** add `SECURITY.md` — first PR of the pre-1.x security baseline.

  Establishes the disclosure surface and the trust model so external
  researchers know how to report vulnerabilities responsibly and app
  authors know where the framework's defended surface ends.

  Disclosure channel is GitHub Security Advisories (private, encrypted,
  CVE-integrated). Coordinated-disclosure window is 90 days. Acknowledge
  within 3 business days, substantive response within 10.

  Explicitly out-of-scope (so reporters don't burn time and app authors
  know to handle these at their layer):

  - **Extensions are trusted code** — same model as TipTap / ProseMirror /
    CodeMirror / Slate. No sandbox. Audit extensions like dependencies.
  - **Collaborative peers can mutate the document** — Scrivr enforces
    schema invariants but not authorisation. Adversarial-peer scenarios
    need app-level permissioning, validation, and potentially E2EE.
  - **AI prompt injection** — defended at the prompt layer + accept-time
    UX, not the suggestion overlay primitive.
  - **DoS via pathological input** — documented as recommended app-level
    limits today; hard guards in core planned for 1.1+.

  States the load-bearing invariant: **storage-safe forever**. Anything
  that enters the ProseMirror JSON document must be safe to render
  through any future surface (DOM a11y mirror, PDF, DOCX, exports).
  Validation happens at ingestion time, not render time.

  No code changes — lockstep patch bump only so the policy is visible
  in every published package's release notes.

  **Action required by the repo owner before this policy is real:** enable
  "Private vulnerability reporting" in repo Settings → Security → Code
  security and analysis. Without it the disclosure URL 404s for non-
  maintainers.

- Updated dependencies [6d6f642]
- Updated dependencies [1db8abc]
- Updated dependencies [2f74d3e]
- Updated dependencies [6c1945a]
- Updated dependencies [4c2dd5e]
- Updated dependencies [fcd166b]
- Updated dependencies [b61e408]
- Updated dependencies [6d49fe0]
  - @scrivr/core@1.0.10
  - @scrivr/export-pdf@1.0.10
  - @scrivr/export-markdown@1.0.10

## 1.0.9

### Patch Changes

- dd3f3d6: `@scrivr/plugins`: drop the hand-rolled `TestAiEditor` `IEditor` stub. The
  ai-suggestion test suites now drive a real headless `ServerEditor` (wrapped
  in a thin `AiTestEditor` subclass that adds test sugar — `showSuggestion`,
  `apply`, `reject`, `text`, `suggestionState`). The 110-LOC blob of
  `as never` view stubs (canvas, layout, surfaces, full SelectionController)
  is gone — the test driver is now a real editor with the actual minimal
  schema + `aiSuggestionPlugin` + `trackChangesPlugin` + `history()` wired
  through `ServerEditor`'s extension lifecycle.

  To make this possible, three public function signatures widen from
  `IEditor` to `IBaseEditor`:

  - `showAiSuggestion(editor: IBaseEditor, …)`
  - `applyAiSuggestion(editor: IBaseEditor, …)`
  - `rejectAiSuggestion(editor: IBaseEditor, …)`

  These functions only use `getState` + `applyTransaction` — both on
  `IBaseEditor`. Backwards-compatible: any existing caller passing a
  browser `Editor` still satisfies the broader requirement.

  `subscribeToAiSuggestions` also widens to `IBaseEditor`. Its internal
  `activate(blockId)` callback used to call `editor.selection.moveCursorTo`
  unconditionally; it now uses a type-predicate guard (`hasSelectionApi`)
  so view-bound editors keep moving the cursor while headless editors
  skip the no-op-on-headless cursor move. No `as` cast — the guard returns
  a TypeScript type predicate (`editor is IBaseEditor & Pick<IEditor,
"selection">`).

  Other packages: no runtime / API change — bumps included for lockstep
  versioning.

- 0a17632: `@scrivr/core`: drop the static `model/schema.ts` `export const schema`
  and the `model/state.ts` (`createEditorState`, `createEditorStateFromJSON`)
  factories. Both were drifting out of sync with what the production editor
  actually builds — `Editor` and `ServerEditor` construct their schema
  dynamically from extensions (`StarterKit` adds `paragraph.dataTracked`,
  `paragraph.nodeId`, etc.; `TrackChanges` from `@scrivr/plugins` adds
  `trackedInsert` / `trackedDelete` marks) and the static schema couldn't
  keep up.

  **Stability note (beta `0.x`):** the removed surfaces below were technically
  reachable through `@scrivr/core` but were never part of the documented public
  API — `Editor` / `ServerEditor` / `StarterKit` (the documented entry points)
  do not consume them, and they had drifted out of sync with the runtime
  schema. They are removed as internal cleanup. Per the project's beta
  versioning rule (`feedback_changeset_patch_only`) the lockstep bump stays
  `patch`; any external consumer reaching past the documented surface should
  migrate as described below.

  Migration story:

  - The `schema` runtime value, `NodeTypeName` type, `MarkTypeName` type,
    `createEditorState`, `createEditorStateFromJSON`, and the
    `model/schema.ts` + `model/state.ts` modules themselves are removed from
    the package. The `EditorState` type re-export now comes from
    `prosemirror-state` directly. Build a live schema with
    `getSchema([StarterKit, …])` (or `buildStarterKitContext()` in tests) —
    that's what the production editor uses.
  - `model/commands.ts` had ~110 LOC of schema-using helpers (`toggleBold`,
    `toggleItalic`, `toggleUnderline`, `toggleStrikethrough`, `setFontSize`,
    `setFontFamily`, `setColor`, `applyUndo`, `applyRedo`, `splitBlock`,
    `applyToggleMark`) that were never imported in production — each
    extension already exposes its equivalent via `addCommands()` (Bold,
    Italic, FontSize, History, …). All removed. The surviving exports
    (`insertText`, `deleteSelection`, `deleteBackward`, `deleteForward`)
    power `InputBridge` / `PasteTransformer` / `BaseEditing` and don't
    reference any schema.
  - Test consumers of the static schema now build it locally per file via
    `buildStarterKitContext()` (existing helper) or `getSchema([StarterKit])`
    — same StarterKit-built source the runtime editor uses. The describes
    that need `schema` directly (e.g. for `align`-specific attrs) declare
    their own `const { schema } = buildStarterKitContext()` at the describe
    top.

  `@scrivr/plugins`:

  - ai-suggestion test fixture: the `AiTestEditor` (introduced in PR #81)
    now extends `ServerEditor` and wires the production `StarterKit` +
    `TrackChanges` extensions through it. The custom `nodeSpecs` /
    `markSpecs` / `TestSchemaExtension` blob is gone — the test driver runs
    on the same schema and plugins that production runs on.
  - `TrackChanges.onEditorReady` widens `editor: IEditor` to
    `editor: IBaseEditor` and uses a `hasOverlayApi(editor)` type-predicate
    guard to no-op overlay registration on headless editors. Browser-path
    behaviour is unchanged. Mirrors the existing guards in
    `HeaderFooterController` / `HeaderFooter` and the
    `subscribeToAiSuggestions` guard from PR #81. One of the seven
    extensions documented in `todo_extension_oneditorready_guard.md`.

  No runtime behaviour change in the browser path. Test surfaces reduced
  by 25 tests (8 from `state.test.ts`, 5 from dropped commands describes,
  12 from `schema.test.ts`) — coverage of the removed code is replaced by
  the production extensions' own tests.

  Other packages: no runtime / API change — bumps included for lockstep
  versioning.

- ebd52d1: `@scrivr/core` + `@scrivr/plugins`: drop the `_`-prefix on the remaining
  underscore-tagged members — interface methods, cross-class internal API,
  and layout shape fields. Completes the underscore sweep started in the
  previous release.

  **Breaking** (BUT pre-1.0 / beta, no external consumers known beyond the
  in-repo plugins which migrate in this same PR):

  - `IBaseEditor._applyTransaction(tr)` → `IBaseEditor.applyTransaction(tr)`.
    The previous public `applyTransaction(tr)` wrapper that just delegated to
    `_applyTransaction` is removed — there's now a single canonical method.
    Plugins (`YBinding`, `AiToolkit`, `ai-suggestion`, `header-footer`) and
    app code that called `editor._applyTransaction(tr)` should call
    `editor.applyTransaction(tr)` — same behaviour, no underscore.
  - `SurfaceRegistry._setOwnerMediator()` → `setOwnerMediator()`. Still
    `@internal` — only called by `Editor` during construction.
  - `EditorSurface._committing` → `committing`. Still `@internal` — set by
    `SurfaceRegistry` during commit lifecycle, checked by
    `EditorSurface.dispatch()` to refuse re-entrant dispatch.
  - `DocumentLayout._chromePayloads` → `chromePayloads`. Layout shape field
    read by `TileManager` + written by `PageLayout` + `runMiniPipeline`.
  - Module-scope helpers in `PageLayout` (`_runPipelineDepth`,
    `_runPipelineBody`) and `OverlayRenderer` (`_activeDpr`,
    `_setActiveDpr`) lose their underscores.
  - `Paragraph` extension's module-local `_split` const renamed to
    `splitParagraph`.

  Unused-parameter underscores (`_pageNumber`, `_charMap`, `_event`, …) stay
  — that's TS/ESLint convention, not the same pattern.

  No runtime behaviour change. 1,260 / 1,260 tests pass.

- d85d4af: `@scrivr/core`: drop the `_`-prefix convention on internal class members and
  rely on TypeScript visibility modifiers (`private` / `protected`) instead.
  Touches `BaseEditor`, `Editor`, `ServerEditor`, `EditorSurface`,
  `SurfaceRegistry`, `SelectionController`, `LayoutCoordinator`, `TileManager`,
  `PointerController`, `InputBridge`, `CursorManager`.

  Notable renames:

  - `BaseEditor._state` → `BaseEditor.editorState` (root editor state, distinct
    from `EditorSurface`'s `editorState` and any layout `Flow*` concept).
  - `BaseEditor._readOnly` → `readOnlyValue` (backing field for `get readOnly()`).
  - `BaseEditor._applyState` / `_notifyListeners` / `_fireEditorReady` /
    `_dispatchToActive` / `_getActiveState` / `_buildCommands` → underscore
    dropped.
  - `Editor._onChange` → `onChangeHandler`, `_onFocusChange` →
    `onFocusChangeHandler` (avoid shadowing the constructor option names).
  - `Editor._viewDispatch` → `viewDispatch`, plus theme / debug / raf private
    fields stripped of their underscore.
  - `LayoutCoordinator._cursorPage` → `cursorPageValue` (backing for the
    public `get cursorPage()`); everything else dropped the underscore.
  - `EditorSurface._state` / `_isDirty` / `_listeners` → `editorState` / `dirty` /
    `listeners`.
  - `SurfaceRegistry._activeId` / `_activeSurface` → `activeIdValue` /
    `activeSurfaceValue` (backing fields for the public getters); other
    private fields dropped the underscore.

  Comment updates: "flow document" / "flow state" wording that was contrasting
  the root editor against active surfaces is rewritten to "root editor
  document" / "root editor state" so the same vocabulary doesn't blur with
  layout's `Flow*` types (`FlowBlock`, `FlowConfig`).

  **Public API is unchanged.** Interface members (`IBaseEditor._applyTransaction`,
  `IBaseEditor._setOwnerMediator`-style cross-class API), layout shape fields
  (`_chromePayloads`), and `EditorSurface._committing` remain `_`-prefixed —
  those are intentional "internal-ish public" signals and migrate separately.

  Other packages: no runtime / API change — bumps included for lockstep
  versioning.

- d508775: **⚠️ Visual behaviour change for `@scrivr/react` menu components — see migration note below.**

  Make the React menu and popover components headless-friendly by removing baked-in visual inline styles, adding stable `data-*` state and part selectors, exposing per-part class name props for consumer styling, shipping an optional `@scrivr/react/styles.css` reference stylesheet that can be overridden by app CSS or Tailwind utilities, and exporting hooks for consumers who want to render fully custom UI.

  **Migration:** the previous inline styles are gone. Consumers who relied on the default look must either (a) import `@scrivr/react/styles.css`, or (b) provide their own styles via the new per-part class name props / `data-*` selectors. This bump is **patch** in keeping with Scrivr's beta-only patch policy (`feedback_changeset_patch_only`); semver discipline begins at the future deliberate 1.0 → 2.0 graduation, not here.

- 0a17632: `@scrivr/core`: split the extension lifecycle into engine + view phases.

  **Before:** every extension declared `onEditorReady(editor: IBaseEditor)`
  and either cast to `IEditor` (the documented workaround) or accepted
  `IEditor` directly (silently overriding the parameter type). The result
  was that view-only extensions (Image / TrackChanges / CollaborationCursor
  / AiCaret / GhostText / AiSuggestion / HeaderFooter / PdfExport / etc.)
  would crash at runtime when loaded into `ServerEditor` because the hook
  fired headlessly and reached for `addOverlayRenderHandler` / `redraw` /
  `selection` / `surfaces`.

  **Now:** two hooks, two phases:

  ```ts
  Extension.create({
    onEditorReady?(editor: IBaseEditor) {
      /* engine setup */
    },
    onViewReady?(editor: IEditor) {
      /* view setup  */
    },
  });
  ```

  - `onEditorReady` fires in **both** `Editor` and `ServerEditor` after the
    document engine is ready. Parameter is `IBaseEditor`; only engine APIs
    are reachable. Use for: collaboration document binding, plugin-state
    bootstrap, subscribers, export/markdown setup.
  - `onViewReady` fires **only in browser `Editor`**, after layout / input
    bridge / surfaces / overlay layer are initialised. Parameter is
    `IEditor`; full view surface is reachable. Use for: overlay handlers,
    redraw triggers, selection wiring, layout reads, `setReady`.

  Cleanup fns from both hooks collect in one `runtimeCleanup` array on
  `BaseEditor` and fire on `destroy()` in registration order.

  **Extensions migrated to `onViewReady`** (paint/view-only work that was
  crashing on `ServerEditor` and now simply doesn't run there):

  - `@scrivr/core`: `Image` (redraw on image load), `StarterKit`
    (aggregates Image's view-only setup).
  - `@scrivr/plugins`: `TrackChanges`, `CollaborationCursor`,
    `Collaboration`, `AiCaret`, `GhostText`, `AiSuggestion`, `AiToolkit`,
    `HeaderFooter`.
  - `@scrivr/export-pdf`: `PdfExport`.

  `HeaderFooter`'s and `TrackChanges`'s ad-hoc `isViewEditor` runtime
  guards are removed — the engine guarantees the hook only fires when the
  view is real.

  **Closes** `todo_extension_oneditorready_guard.md` (was tracking the 7
  extensions that crashed on `ServerEditor`; all migrated).

  **New tests:** `packages/core/src/extensions/lifecycle.test.ts` — 6 tests
  prove the contract:

  1. `ServerEditor` calls `onEditorReady` but not `onViewReady`.
  2. `Editor` calls both, in order (`editor` then `view`).
  3. Cleanup from both hooks runs on `destroy()`.
  4. `ServerEditor` only runs `onEditorReady` cleanup on `destroy()`.
  5. A view-only extension that uses `addOverlayRenderHandler` inside
     `onViewReady` loads in `ServerEditor` without crash (no guard, no
     cast — the hook never fires there).
  6. A mixed extension runs engine setup on server and view setup only in
     browser.

  **Plugin authors going forward:** if your extension touches `editor.layout`,
  `editor.addOverlayRenderHandler`, `editor.redraw`, `editor.selection`,
  `editor.surfaces`, or `editor.setReady`, put that work in `onViewReady`.
  If it only touches `editor.getState`, `editor.applyTransaction`,
  `editor.subscribe`, etc., keep it in `onEditorReady`.

  `onEditorReady` and `onViewReady` are both optional — declare neither,
  either, or both per your extension's needs.

  No runtime behaviour change in the browser path. Headless `ServerEditor`
  now loads every built-in / plugin extension without runtime errors;
  view-only setup is silently skipped.

  1,241 / 1,241 tests pass (1,235 baseline + 6 new lifecycle tests).

- 020e362: `@scrivr/core`:

  - New public type `TextMeasurerLike` — the four-method contract
    (`measureWidth`, `getFontMetrics`, `measureRun`, `invalidate`) that the
    layout pipeline consumes. Re-exported from the package entry. Layout +
    rendering signatures (`BlockLayoutOptions.measurer`,
    `BlockRenderContext.measurer`, `LayoutCoordinatorOptions.measurer`,
    `PageChromeMeasureInput.measurer`, `RenderPageOptions.measurer`,
    `MiniPipelineOptions.measurer`, `InlineStrategy.measure`, etc.) widen
    from concrete `TextMeasurer` to `TextMeasurerLike`. Backwards
    compatible — real `TextMeasurer` still satisfies the interface.
  - New `EditorOptions.textMeasurer?: TextMeasurerLike` injection point.
    Production code leaves it undefined and gets the existing DOM-canvas
    default; tests and custom runtimes pass a real `@napi-rs/canvas` or
    other backend.
  - New `TextMeasurerOptions.context?: TextMeasureContext` injection point
    on the `TextMeasurer` constructor. Same purpose: tests inject a real
    Skia ctx so widths and metrics come from a real backend.

  `@scrivr/plugins`:

  - `YBinding`'s constructor `editor` parameter widens from `IEditor` to
    `IBaseEditor`. The binding only uses base-editor APIs (`getState`,
    `subscribe`, `_applyTransaction`), so the narrower interface covers
    both browser `Editor` and headless `ServerEditor`. Backwards
    compatible — existing `IEditor` callers still satisfy `IBaseEditor`.
  - `tokenStrategies` (header-footer) re-types its measurer parameters as
    `TextMeasurerLike` instead of concrete `TextMeasurer`. No runtime
    change.

  Other packages: no runtime / API change — bumps included for lockstep
  versioning.

- Updated dependencies [dd3f3d6]
- Updated dependencies [0a17632]
- Updated dependencies [ebd52d1]
- Updated dependencies [d85d4af]
- Updated dependencies [d508775]
- Updated dependencies [972dab2]
- Updated dependencies [0a17632]
- Updated dependencies [020e362]
- Updated dependencies [0dec8aa]
  - @scrivr/core@1.0.9
  - @scrivr/export-pdf@1.0.9
  - @scrivr/export-markdown@1.0.9

## 1.0.8

### Patch Changes

- Updated dependencies [bc1652d]
- Updated dependencies [40be274]
- Updated dependencies [dad19d0]
- Updated dependencies [bf33e14]
  - @scrivr/core@1.0.8
  - @scrivr/export-pdf@1.0.8
  - @scrivr/export-markdown@1.0.8

## 1.0.7

### Patch Changes

- Updated dependencies [b9d64c1]
- Updated dependencies [dc23d63]
- Updated dependencies [a958911]
- Updated dependencies [4d76706]
- Updated dependencies [85a8aea]
- Updated dependencies [10ea56e]
- Updated dependencies [12e8476]
- Updated dependencies [3e5ec8f]
- Updated dependencies [9be941a]
- Updated dependencies [331160e]
- Updated dependencies [0d419b7]
- Updated dependencies [0d419b7]
- Updated dependencies [349da18]
- Updated dependencies [aef1835]
- Updated dependencies [2189983]
  - @scrivr/core@1.0.7
  - @scrivr/export-pdf@1.0.7
  - @scrivr/export-markdown@1.0.7

## 1.0.6

### Patch Changes

- Updated dependencies [39e008c]
- Updated dependencies [36a7776]
- Updated dependencies [88016a6]
- Updated dependencies [ddd1448]
  - @scrivr/core@1.0.6
  - @scrivr/export-pdf@1.0.6
  - @scrivr/export-markdown@1.0.6

## 1.0.5

### Patch Changes

- f6950b5: Add token authentication and connection lifecycle callbacks to the Collaboration plugin and collab server.

  **@scrivr/plugins** — `Collaboration.configure()` now accepts `token` (string or async function) forwarded to HocuspocusProvider for WebSocket auth, plus optional `onConnect`/`onDisconnect` callbacks for connection lifecycle visibility.

- 0f6d00a: Fix cross-page selection highlight and cursor fallback for float-only pages
- ff7390f: Split `@scrivr/export` into `@scrivr/export-pdf` (pdf-lib) and `@scrivr/export-markdown` (prosemirror-markdown) so each format carries only its own deps. The original `@scrivr/export` becomes a compat shim that re-exports from both — existing consumers keep working.

  Add `addExports()` extension lane to `@scrivr/core` with the `FormatHandlers` augmentation pattern. Format packages declare their handler shape via module augmentation; extensions contribute format-tagged handlers via `addExports()`. Handler interfaces are placeholders until the M2 export dispatch refactor fills them.

  Dependent packages bumped to pick up the new export extensibility types.

- 8ccf3ea: Add `EditorSurface` + `SurfaceRegistry` + `addSurfaceOwner()` extension lane for multi-surface document editing. Plugins can now register plugin-owned edit regions (headers, footnote bodies, comment threads) that own their own `EditorState` and participate in a full activate/commit/deactivate lifecycle. Body (flow doc) remains the default active surface — `activeId === null` — and `editor.state` always returns flow state regardless of activation. Zero user-visible change. Enables the upcoming HeaderFooter plugin to ship fully editable in-place rather than paint-only.

  Dependent packages bumped to pick up the new `@scrivr/core` surface API exports.

- Updated dependencies [bf50408]
- Updated dependencies [f6950b5]
- Updated dependencies [0f6d00a]
- Updated dependencies [81970d5]
- Updated dependencies [ff7390f]
- Updated dependencies [a198d0f]
- Updated dependencies [8ccf3ea]
  - @scrivr/core@1.0.5
  - @scrivr/export-pdf@1.0.5
  - @scrivr/export-markdown@1.0.5

## 1.0.4

### Patch Changes

- 5752be2: Picks up image interaction and popover UX fixes from `@scrivr/core` — no export-level changes. See the `@scrivr/core` changelog for details.

- Updated dependencies [c963158]
- Updated dependencies [5752be2]
  - @scrivr/core@1.0.4

## 1.0.3

### Patch Changes

- 914daad: ### Editing UX improvements

  - Double-click to select word, triple-click to select paragraph, with word-granularity drag extension
  - Platform-specific keyboard shortcuts: Option/Ctrl+Arrow word navigation, Cmd/Home/End line start/end, Cmd+Up/Down doc start/end, Option/Ctrl+Backspace/Delete word delete — all with Shift variants for extending selection

  ### Crisp rendering

  - Pixel-snap all overlay rectangles (selection, tracked changes) to the device pixel grid — eliminates antialiasing seams between adjacent rects
  - DPR change detection via matchMedia + Visual Viewport API — canvases repaint at correct resolution on browser zoom, display switch, and pinch-to-zoom

  ### Architecture

  - **New:** `SelectionController` — extracted from Editor, owns all cursor movement, word/line navigation, and selection logic. Accessed via `editor.selection`
  - **New:** `PointerController` — extracted from TileManager, owns all mouse interaction (hit testing, click counting, drag tracking)
  - **Breaking:** `editor.moveCursorTo()` and other navigation methods removed from Editor — use `editor.selection.moveCursorTo()` instead
  - **Breaking:** `ViewManager` deleted (was deprecated, replaced by TileManager). Remove any `ViewManager` imports

- Updated dependencies [914daad]
  - @scrivr/core@1.0.3

## 1.0.2

### Patch Changes

- 1d7dde7: Add CommonJS output to all packages so CJS consumers can `require()` the library
- Updated dependencies [1d7dde7]
  - @scrivr/core@1.0.2

## 1.0.1

### Patch Changes

- 4b0e9c0: Add README.md to all packages with installation instructions, API overview, and usage examples. Fix root README to reference the correct hook name (`useScrivrEditor`) and renderer (`TileManager`).
- f4442e8: feat(core): addDocAttrs() extension lane for doc-level attributes

  Extensions can now contribute attributes to the `doc` node via a new `addDocAttrs()` Phase 1 hook:

  ```ts
  const HeaderFooter = Extension.create({
    name: "headerFooter",
    addDocAttrs() {
      return { headerFooter: { default: null } };
    },
  });
  ```

  `ExtensionManager.buildSchema` merges contributions from every extension into the doc node spec. Two extensions contributing the same attr name is a collision and throws at schema-build time with an error naming both owners — extensions are expected to namespace their attr names to avoid collisions in practice.

  Once declared, attrs are writable via ProseMirror's built-in `tr.setDocAttribute(name, value)`, which routes through `DocAttrStep` (jsonID `"docAttr"`, shipped in `prosemirror-transform` since 1.8.0). `@scrivr/core` now re-exports `DocAttrStep` as a convenience — extensions don't need to import from `prosemirror-transform` directly.

  This is the foundation for PR 4's HeaderFooter extension and future footnotes / comments / page-settings extensions that need document-level metadata participating in undo/redo, history snapshots, and collaboration round-trips.

- 3dcb134: refactor(layout): per-page PageMetrics, runMiniPipeline, recursion guard

  Internal refactor to `@scrivr/core`'s layout engine. Zero behavior change — all 566 tests pass unchanged.

  ### New primitives

  - `PageMetrics` — per-page geometry bundle (contentTop, contentBottom, contentHeight, contentWidth, header/footer heights). Replaces raw `margins.top` / `pageHeight - margins.bottom` arithmetic throughout the pipeline.
  - `computePageMetrics` — pure function deriving PageMetrics from PageConfig + chrome reservations.
  - `ChromeContribution` / `ResolvedChrome` — types for future chrome contributors (headers, footers, footnotes).
  - `fitLinesInCapacity` — shared line-fitting primitive extracted from paginateFlow's split loop.
  - `runMiniPipeline` — measurement-only pipeline for mini-documents (headers, footers, footnote bodies). Safe to call from chrome contributor hooks without triggering recursive pagination.
  - Recursion guard on `runPipeline` that throws with a readable error pointing at `runMiniPipeline`.

  ### Refactored hot paths

  - `paginateFlow` reads all vertical positions through `metricsFor(pageNumber)` instead of raw margin arithmetic (10 call sites).
  - `applyFloatLayout` uses `metricsForPage` helper across 9 call sites (float placement, exclusion re-layout, overflow cascade).
  - `DocumentLayout` gains optional `metrics[]`, `runId`, `convergence`, `iterationCount` fields.
  - `MeasureCacheEntry` gains `placedRunId` / `placedContentTop` for the early-termination guard to detect chrome configuration changes between runs.
  - `EMPTY_RESOLVED_CHROME` is `Object.freeze`d to prevent accidental mutation.

  ### Test coverage

  566 tests passing (555 pre-existing + 11 new covering PageMetrics, fitLinesInCapacity, runMiniPipeline, and the recursion guard).

- Updated dependencies [4b0e9c0]
- Updated dependencies [f4442e8]
- Updated dependencies [3dcb134]
  - @scrivr/core@1.0.1

## 1.0.0

### Patch Changes

- Updated dependencies [7ba7cb5]
  - @scrivr/core@1.0.0
