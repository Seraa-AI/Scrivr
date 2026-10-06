# RFC: Slash command contributions — extensions declare what `/` offers

Status: proposed. Raised by the first consumer of `sourced-blocks-rfc.md`,
which reached the gap that RFC predicted in §10: *"This RFC contributes no
bespoke UI; if it needs any, node actions are underspecified and that RFC
should absorb the gap."*

The gap is real, and it is not node actions. Node actions answer *what can I do
to the thing I have selected*. A slash menu answers *what can I bring into the
document*, with no selection at all.

## Problem

`createSlashMenu` is a controller and nothing more: it reports a query, a
position, and open/closed. Every item in the menu is supplied by the host.

That is correct for formatting — a host knows what a heading is. It fails the
moment an **extension** owns something insertable, because the extension cannot
say so. The host has to know the extension exists, know what it inserts, and
hand-wire a callback per feature.

The first consumer had to do exactly that. To offer library clauses in `/`, it
threaded an `onSearchClauses` callback from the application, through the canvas
component, through the menu component, into the menu hook — then queried its own
API, built the block content itself, and called `insertSourcedBlock` directly.

Two consequences, both visible in that code:

- **`SourceProvider.search` is dead.** Nothing in Scrivr calls it and nothing in
  the consumer calls it either, because the menu path went around the provider.
  It has never run since it shipped. The method exists for precisely this
  feature, and the feature could not reach it.
- **Two paths build one clause.** `provider.fetch` says *"Full content for
  insertion"* and the menu path built its own content instead. The consumer had
  to extract a shared helper to stop the two from drifting — a shared helper
  that only exists because the seam was missed.

A second provider — precedents, templates, snippets — repeats all of it.

## The invariant

> **An extension declares what it can insert. The host renders and dispatches.
> Neither learns the other's vocabulary.**

This is not a new principle here; it is the one `addToolbarItems` and
`addNodeActions` already follow. Slash commands are the third contribution of
the same kind, and the only one missing.

## 1. Follow the toolbar, not the callback

`ToolbarItemSpec` is the precedent that matters, because of what it refuses to
be:

```ts
interface ToolbarItemSpec {
  command: keyof SafeFlatCommands;
  args?: unknown[];
  ...
}
```

A command **name** and arguments, never a closure. That is what lets the UI
layer render toolbar items "however it wants" without holding editor internals.
Slash commands take the same shape for the same reason.

```ts
interface SlashCommandSpec {
  /** Namespaced, stable, unique — as NodeAction: "clause.insert". */
  id: string;
  label: string;
  /** Longer text under the label. */
  description?: string;
  /** Logical grouping; renderers draw dividers between groups. */
  group?: string;
  /** Lower sorts first within a group. Default 100. */
  order?: number;
  command: keyof SafeFlatCommands;
  args?: unknown[];
}
```

## 2. Static and resolved are different fields

```ts
interface SlashCommandContribution {
  /** Always offered, filtered by the host against the query. */
  items?: SlashCommandSpec[];
  /** Query-driven. Called as the author types; may be cancelled. */
  resolve?(query: string, signal: AbortSignal): Promise<SlashCommandSpec[]>;
}
```

Two fields rather than one async function, deliberately.

`NodeAction.when` is documented as *"PURE and SYNCHRONOUS — it is called
for every registered action on every selection change, during render. No I/O."*
That contract is right and worth keeping. A library search is I/O by nature, so
folding it into the same field would either weaken the sync guarantee for
everything or force formatting commands through a promise for no reason.

Separating them also gives the host what it needs to render well: static items
can paint on the first frame, and only the resolved half needs a spinner.

`signal` is not optional in the resolver's signature. An author typing `conf`
issues four searches; without cancellation the menu shows whichever response
happens to arrive last. Every existing consumer debounces and none aborts,
because there was nothing to abort with.

## 3. The hook and the accessors

Phase 1, beside its siblings:

```ts
/**
 * Slash-menu entries this extension contributes.
 * Data only — the UI layer renders them however it wants.
 */
addSlashCommands?(this: Phase1Context<Options>): SlashCommandContribution[];
```

Read back, mirroring `getNodeActions()`:

```ts
getSlashCommands(): SlashCommandSpec[];
resolveSlashCommands(query: string, signal: AbortSignal): Promise<SlashCommandSpec[]>;
```

`resolveSlashCommands` fans out over every contributed resolver and merges by
`group` then `order`. A resolver that rejects is dropped from that round with a
warning — one provider being down must not empty the menu.

## 4. What `SourcedBlockExtension` contributes

This is the change that makes the rest useful, and it exposes a real hole in the
sourced-blocks command surface.

Today there is one insertion command:

```ts
insertSourcedBlock: (options: { kind: string; content: SourceContent }) => ReturnType
```

It takes **full content**, so a menu entry cannot be data — somebody must fetch
before dispatching, which is exactly what pushed the first consumer around the
provider. It needs a sibling that takes identity:

```ts
insertSourcedBlockFromSource: (options: {
  kind: string;
  resourceId: string;
  versionId: string;
}) => ReturnType
```

which resolves through `provider.fetch(resourceId, versionId)` — the method
whose own comment already promises "full content for insertion" — and then does
what `insertSourcedBlock` does.

With that, the extension's contribution is four lines of intent:

```ts
addSlashCommands() {
  return this.options.providers.map(provider => ({
    async resolve(query, signal) {
      const hits = await provider.search(query, signal);
      return hits.map(hit => ({
        command: "insertSourcedBlockFromSource",
        args: [{ kind: provider.kind, resourceId: hit.resourceId, versionId: hit.versionId }],
        group: provider.kind.toUpperCase(),
        id: `${provider.kind}.insert.${hit.resourceId}`,
        label: hit.label,
      }));
    },
  }));
}
```

`SourceSearchResult` is already `{ resourceId, versionId, label, meta }` — an
identity and a label, no body. That shape only pays off once something fetches
on **select** rather than on search; today the consumer pulls full text for
twenty rows to render twenty labels.

## 5. What this does not do

- **No menu UI.** Scrivr contributes no renderer, exactly as `addToolbarItems`
  contributes none. Position, keyboard navigation and grouping stay with the
  host.
- **No change to `createSlashMenu`.** The controller's job — query, position,
  open/closed — is unchanged and correct.
- **No gating vocabulary.** `provider.can()` governs node actions on an existing
  block; whether a source is insertable at all is the resolver's answer, by
  returning nothing.

## Decisions (proposed)

1. **Command name plus args, never a callback.** Matches `ToolbarItemSpec`, and
   keeps contributions inert data the host can sort, filter and render.
2. **`items` and `resolve` are separate fields.** The sync purity of the static
   path is worth more than the symmetry of one signature.
3. **`signal` is required in `resolve`.** Cancellation is the difference between
   a menu that tracks the author and one that shows a stale answer.
4. **`insertSourcedBlockFromSource` is part of this RFC, not a follow-up.**
   Without it the contribution cannot be data, and the whole design collapses
   back into a callback.
5. **A failing resolver degrades to fewer items, never to an error state.** The
   formatting commands must still be there when the network is not.

## First consumer

The application that raised this currently carries: an `onSearchClauses`
callback threaded through four layers, a hook that duplicates
`provider.search`, and a content builder that duplicates `provider.fetch`. All
three delete against this RFC, and `SourceProvider.search` runs for the first
time.

## What shipped

All of it, as specified, with two details the RFC left open.

`SlashCommandSpec` (`id`, `label`, `description?`, `group?`, `order?`, `command`,
`args?`), `SlashCommandContribution` (`items?` / `resolve?`), and the Phase-1
`addSlashCommands()` hook returning a list of contributions — so one extension
fronting several sources gives each its own resolver. `getSlashCommands()` and
`resolveSlashCommands(query, signal)` read them back, both merged by `group` then
`order`.

A resolver that rejects is dropped from the round with a `console.warn` and the
rest still answer (Decision 5). `signal` is required, and the editor checks it
twice — before the resolvers run and again after they answer — so a resolver that
ignores its own signal still cannot deliver entries for a query the author has
typed past. Abandoning throws `signal.reason`, which is how a caller knows a
result it holds is current.

`insertSourcedBlockFromSource({ kind, resourceId, versionId })` ships with it
(Decision 4), resolving through `provider.fetch` and then delegating to
`insertSourcedBlock` so there is one insertion path. `SourcedBlockExtension`
contributes one resolver per provider, and `SourceProvider.search` runs for the
first time. Nothing fetches during a search.

**Four seams the RFC did not reach, found in review.**

*Deferred document work.* `insertSourcedBlockFromSource` finishes after an
await, and nothing in core held the three facts such a write needs: the
position the author asked at (which has moved), whether the editor still
accepts writes, and whether it still exists. The first cut had none of them —
it reached the live selection, so a clause chosen from `/` replaced whatever
the author had selected while it loaded. `editor.deferEdit({ at, work, edit,
onAbandoned })` is the primitive: it captures the position, maps it through
everything that happens meanwhile (the idiom `AiCaret` already used privately),
and abandons with a reason rather than writing into a read-only or destroyed
editor. `insertSourcedBlock` takes an optional `at`, resolved through
`insertPoint` so a block lands where a block can legally go.

*A command reaching its editor.* `addCommands`' context had no editor, so three
extensions had each invented a `WeakMap` keyed on their options object — which
identifies the configured extension, not the editor, so one instance shared by
two editors inserted into the wrong document. `ExtensionContext` now carries an
`editor()` thunk; each editor resolves its own extensions, so the identity is
right by construction.

The map outlived this PR, though — the claim above was true of the three
extensions reviewed here and three more held the same pattern. #219 converted
the last of them (`Collaboration`'s Y binding into its editor-keyed registry;
`PdfExport`, `DocxExport`, `DocxImport` and `SemanticExport` onto `this.editor()`
outright; `Image`'s copy had no reader and was deleted), with tests for the
consequences they carried: export in one pane saving the other pane's document,
and `importDocxFromFile` writing into it. No extension in the repo keys state on
its options object now.

*A resolver that misbehaves.* Decision 5 covers a resolver that rejects. One
that fulfils with a non-array threw inside `resolveSlashCommands`, losing every
other resolver's entries and rejecting a call that should have degraded; and an
abandoned query never settled while a resolver hung, because `allSettled` waits
for the slowest. Both are now failures like any other: warn, drop, carry on —
and the fan-out races the signal.

*An order that is not a number.* A `NaN` comparison reads as "equal to
everything", so one broken `order` reordered its whole group. Anything
non-finite now sorts as if it stated none.

**Two decisions the RFC did not make.**

*Group ordering.* "Merges by `group` then `order`" did not say how groups order
against each other. They keep the order they were first contributed in —
registration order — rather than sorting group names, so renaming a group does
not reorder the menu.

*Where the glyph comes from.* The spec has `label` and `description` and no icon,
which is right under §5 ("Scrivr contributes no renderer"). The React menu
therefore keys a glyph off `spec.command`, the same way the playground toolbar
keys its Lucide icons off `item.command`. An entry whose command is not in that
map renders without a glyph rather than a wrong one.

`SlashMenuItem` carries `id` and `group` through to the renderer. Dropping them
meant the one shipped menu keyed on a title — fine for eight fixed entries, but
two search hits can share a label — and could not draw the dividers `group`
exists for. The menu also debounces (150ms by default), clears the previous
query's entries up front rather than leaving them selectable, and asks no
resolver when a host supplies its own `items`, so "override" means override.

`editor.runCommand(name, args)` was added to dispatch a declared spec by name.
Both `ToolbarItemSpec` and `SlashCommandSpec` name a command rather than closing
over one, and dispatching by name through `commands` needs a cast — the playground
had grown one, commented "single cast point". It is deleted; the dispatch lives
once on `BaseEditor`.
