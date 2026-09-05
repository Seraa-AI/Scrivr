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

`NodeAction.isAvailable` is documented as *"PURE and SYNCHRONOUS — it is called
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
