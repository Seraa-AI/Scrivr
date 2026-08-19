# RFC: Node Actions

Status: draft (2026-08-19)

## Problem

Scrivr has no answer to the question *"what can I do with this thing?"*

It has a good answer to *"what do I want to add here?"* — slash commands and the
toolbar. But every time a node needs its own operations, we write a bespoke UI
factory by hand:

- `menus/createImageMenu.ts` — keys off `descriptor.kind === "image"`, resolves
  the node against the active surface, positions itself, subscribes to view
  updates, hides on blur.
- `menus/createBubbleMenu.ts` — same lifecycle, different trigger.
- `menus/createLinkPopover.ts` — same again.
- `menus/createFloatingMenu.ts`, `menus/createSlashMenu.ts` — same again.

Five factories, each re-solving visibility (`anchorVisibility.ts`), positioning,
subscription (`subscribeViewUpdates.ts`), and focus-out
(`subscribeEditorFocusOutside.ts`). Every one of them hardcodes *which* node it
serves and *what* that node can do, in core, in a file the owning extension
does not touch.

That's backwards. The Image extension owns image selection behavior
(`addSelectionBehavior`), image hit-testing (`addHitTester`), image layout
(`addLayoutHandlers`) and image export — but it does **not** own the list of
things a user can do to an image. That list lives in a core menu file.

The cost compounds. A table wants add-row/delete-column. An anchored object
wants wrap-mode and reset-position. A tracked change wants accept/reject. A
sourced block (see `docs/sourced-blocks-rfc.md`) wants view-source / compare /
update / detach. Under the current design each is a sixth, seventh, eighth
hand-written factory plus a host-app UI that hardcodes the same list again.

### What exists and why it isn't this

`ToolbarItemSpec` (`extensions/types.ts:354`) is the closest thing, and it is
the *other half* of the problem:

```ts
interface ToolbarItemSpec {
  command: keyof SafeFlatCommands;
  args?: unknown[];
  label: string; title: string; group?: string;
  isActive: (activeMarks, blockType, ...) => boolean;
}
```

It is **document-global**: it describes an operation always available, whose
appearance varies with the selection. It has no `when(node, context)`, no node
identity, and its `run` is constrained to a named command with static args —
which cannot express "fetch clause v4 and diff it against this instance."

Node actions are the contextual sibling: operations that *do not exist* unless a
particular thing is under the cursor.

## The core idea

> **The object under the cursor knows what operations are meaningful for it —
> and the extension that owns the object declares them, not the UI that renders
> them.**

Two consequences, both load-bearing:

**Actions are semantic, not visual.** An extension contributes *actions*, never
*menus*. Core decides where they surface. The same registry feeds a gutter
control, a right-click menu, the command palette, a keyboard shortcut, and a
React sidebar — without the extension knowing any of those exist.

**Actions key off the selection descriptor, not the node type.** This is the
non-obvious part. `SelectionDescriptor.kind` is already the stable semantic
identity in this codebase (`selection/types.ts:73`), already carries
`surfaceId`, and already has `capabilities`. `createImageMenu` figured this out
empirically — it branches on `descriptor.kind`, *then* resolves the node against
`editor.surfaces.activeSurface?.state`, precisely because a header image would
otherwise resolve against the wrong document. Any action system that keys off
raw node type re-introduces that bug for every consumer.

## 1. The contract

```ts
/** Where an action runs. Everything an action needs, already surface-resolved. */
export interface NodeActionContext {
  editor: IEditor;
  /** The active selection's public descriptor — carries kind, surfaceId, capabilities. */
  descriptor: SelectionDescriptor;
  /** State of the surface that owns the selection. NEVER editor.getState(). */
  state: EditorState;
  /** The node the action targets, resolved against `state`. Null for text ranges. */
  node: Node | null;
  /** Document position of `node` within `state`. -1 when node is null. */
  pos: number;
  readOnly: boolean;
}

export interface NodeAction {
  /** Namespaced, stable, unique: "clause.compare", "image.replace". */
  id: string;
  label: string;
  /** Longer text for tooltips / palette. Defaults to `label`. */
  title?: string;
  /** Logical grouping; renderers draw dividers between groups. */
  group?: string;
  /** Lower sorts first within a group. Default 100. */
  order?: number;
  /** Destructive/irreversible — renderers may style or confirm. */
  danger?: boolean;

  /**
   * Does this action apply right now? Must be PURE and SYNCHRONOUS — it is
   * called for every registered action on every selection change, during
   * render. No I/O, no dispatch, no allocation-heavy work.
   *
   * Omit to mean "always, when the kind matches".
   */
  when?(ctx: NodeActionContext): boolean;

  /**
   * Is this action currently unavailable, with a reason to show the user?
   * Distinct from `when` returning false (which hides it entirely). Use for
   * "you lack permission" / "library is offline" — visible but inert.
   */
  disabled?(ctx: NodeActionContext): string | false;

  /** Perform it. May be async (network, dialogs, host round-trips). */
  run(ctx: NodeActionContext): void | Promise<void>;
}
```

Registration mirrors every other contribution hook:

```ts
addNodeActions?(this: Phase1Context<Options>): NodeActionContribution[];

interface NodeActionContribution {
  /** SelectionDescriptor.kind this action set attaches to. */
  kind: string;
  actions: NodeAction[];
}
```

Keyed by `kind`, so the registry pre-buckets by kind and only evaluates `when`
for the handful of actions that could possibly apply — not all of them.

## 2. Resolution

```
selection changes
      ↓
getSelectionDescriptor()          → { kind, surfaceId, capabilities, from, to }
      ↓
registry.bucket(kind)             → candidate actions (O(1))
      ↓
resolve node against surface state → NodeActionContext
      ↓
filter by when(ctx)               → applicable actions
      ↓
sort by (group, order, id)        → stable, deterministic ordering
      ↓
UI surface renders                → gutter / context menu / palette / sidebar
```

Public API on `IEditor`:

```ts
/** Applicable actions for the current selection, resolved and sorted. */
getNodeActions(): ResolvedNodeAction[];
/** Run one by id. Throws if not applicable — callers must not guess. */
runNodeAction(id: string): Promise<void>;
```

`ResolvedNodeAction` is the action plus its resolved `disabled` reason, so a
renderer never re-invokes predicates.

The registry lives at `selection/NodeActionRegistry.ts`, beside
`SelectionRegistry.ts` — same shape, same ownership, same surface-awareness.
It is *not* in `menus/`; menus are one consumer.

### Ordering across extensions

Actions from different extensions can target the same kind (Image contributes
`image.replace`; a host app contributes `image.sendToReview`). Sort key is
`(group, order, id)` with `id` as the deterministic tiebreak, and registration
order broken deliberately — two extensions must not produce different menus
depending on array position in `new Editor({ extensions })`.

Duplicate `id` is a hard error at registry build, matching the fail-fast
precedent set for surface owners (`ExtensionManager.ts:424`) and for duplicate
cell-selection registration (#137). Silent override is how contributions
disappear.

## 3. Surfacing

Core ships **one** new UI surface and refits the rest:

- **Node gutter** (new) — a `⋮` affordance rendered near the selected object's
  geometry, opening the action list. Uses the existing overlay/positioning
  machinery, not a new one.
- **`createImageMenu` → registry consumer.** This is the migration proof. If
  image actions (replace, caption, alt-text, download, delete, wrap-mode) cannot
  be expressed as `NodeAction`s, the abstraction is wrong and we learn it for
  the price of one file. Behavior must be unchanged; its tests are the contract.
- **Command palette / slash menu** may list node actions with an applicable
  prefix, so keyboard-first users never need the gutter.
- **React** gets `useNodeActions()` in `@scrivr/react`, returning the resolved
  list and a `run` callback — the whole point being that host apps stop
  hardcoding per-node menus.

Renderers must treat the action list as opaque and ordered. No renderer may
filter by `id`; that would re-hardcode node knowledge into the UI layer, which
is the bug we are fixing.

## 4. Permissions

Actions frequently need host authority the editor does not have — "may this
user promote a clause to a canonical version?" The editor must not grow a
permission model, and extensions must not call the host's authz directly.

`disabled(ctx)` is the seam: an extension configured with a host-supplied
capability probe returns a reason string. The clause extension's
`clause.promote` action is registered unconditionally and disables itself with
`"Requires library administrator"` when the probe says no. Editor stays
authz-free; host stays authoritative; the action stays discoverable, which is
better UX than a silently missing menu item.

## Decisions (locked)

1. **Actions key off `SelectionDescriptor.kind`**, never raw node type — kind is
   the existing semantic identity and carries `surfaceId`.
2. **`when` is pure and synchronous.** Async availability is `disabled()`
   returning a reason after the host resolves, never a promise in `when`.
3. **Extensions contribute actions, never menus.** No `contextMenu: [...]` in
   any extension config, now or later.
4. **Duplicate action `id` throws** at registry build.
5. **`ToolbarItemSpec` is not merged in v1.** The convergence (toolbar = actions
   whose context is the whole document) is real and deferred; merging it now
   couples this RFC to a toolbar rewrite for no gain.
6. **`createImageMenu` migrates as part of this RFC**, not after. An abstraction
   with zero consumers is a guess.

## Build order

1. **Prereq — `addExtensions()` on the Extension contract.** StarterKit
   currently hand-merges 24 of the 27 contribution hooks over ~28 built-ins,
   reimplementing `ExtensionManager`'s per-slot merge. A new hook means a 25th
   hand-written merge, and any sub-extension contributing one before that edit
   is silently dropped (`addCloneHandlers`, `addDocAttrs`, `addPageChrome`,
   `addSurfaceOwner` are already unforwarded today). Manager flattens nested
   extensions into its normal pipeline; StarterKit keeps option→extension
   selection only. Separate PR, no feature risk.
2. `NodeAction` types + `NodeActionRegistry` + `addNodeActions` hook + manager
   collection.
3. `editor.getNodeActions()` / `runNodeAction()` + descriptor plumbing.
4. Migrate `createImageMenu` onto the registry; its existing tests must pass
   untouched.
5. Node gutter surface.
6. `useNodeActions()` in `@scrivr/react`.

Steps 2–4 are the RFC's real content; 5–6 can trail.

## Open questions

- **Keyboard shortcuts.** Should `NodeAction` carry an optional key binding that
  the manager folds into the keymap? Attractive, but keymap collisions across
  extensions are already unwarned (`todo_extension_collision_warnings`) and this
  would multiply them. Leaning: no in v1, revisit with the collision-warning
  work.
- **Text selections.** `node` is null for a text range. Do text-kind actions
  (e.g. "save as clause" on a selection) belong here, or stay in the bubble
  menu? Leaning: they belong here — "save as clause" is exactly a contextual
  action — but it makes the name `NodeAction` slightly wrong. `ContextAction`?
- **Multi-node selections.** A cell range or `AllSelection` targets many nodes.
  v1 resolves `node` to the *common ancestor* or null; a batched
  `nodes: Node[]` context is deferred until tables need it.
- **Invalidation cost.** `getNodeActions()` runs on every selection change. Kind
  bucketing should make this trivial, but it needs a benchmark on a large doc
  before the gutter subscribes to it per-frame.
