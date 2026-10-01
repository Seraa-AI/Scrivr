---
"@scrivr/core": patch
"@scrivr/react": patch
---

An extension declares the slash entries that insert what it owns.

The slash menu hard-coded its formatting entries in the React hook and asked the
source providers directly, so an extension could not contribute to the menu that
inserts its own node — the one contribution of its kind that `addToolbarItems`
and `addNodeActions` already had.

`addSlashCommands()` returns `SlashCommandContribution[]`, each with optional
`items` (known up front, paints on the first frame) and `resolve` (query-driven
I/O, the only half that needs a spinner). A list rather than one contribution, so
an extension fronting several sources gives each its own resolver.
`getSlashCommands()` and `resolveSlashCommands(query, signal)` read them back,
merged by `group` then `order` — groups in the order first contributed, so
renaming one does not reorder the menu.

`SlashCommandSpec` is data only, like `ToolbarItemSpec`: `id`, `label`,
`description?`, `group?`, `order?`, `command`, `args?`. A command name and
arguments, never a closure. The eight built-in entries now come from `Heading`,
`List`, `CodeBlock` and `HorizontalRule`, and the heading entries follow the
configured `levels` — a kit built with fewer no longer offers entries it cannot
honour. The spec carries no icon, because Scrivr contributes no renderer; the
React menu keys a glyph off the command name, as the playground toolbar already
does.

A resolver that rejects is dropped from the round with a warning and the others
still answer: one source being down must not empty a menu whose formatting
entries are fine. `signal` is required, and is checked both before the resolvers
run and after they answer, so a resolver that ignores it still cannot replace the
entries for the query the author is now on.

`insertSourcedBlockFromSource({ kind, resourceId, versionId })` resolves through
`provider.fetch` and delegates to `insertSourcedBlock`, so a menu entry can be
identity rather than content — without it the contribution would have to be a
callback. `SourcedBlockExtension` contributes one resolver per provider, and
`SourceProvider.search` runs for the first time.

`editor.deferEdit({ at, work, edit, onAbandoned })` is the seam for async work
that ends in an edit. It captures a position, maps it through everything that
happens while the work runs, and abandons with a reason — `anchor-removed`,
`read-only`, `destroyed`, `failed`, `edit-failed` — rather than writing blind.
`insertSourcedBlockFromSource` is its first consumer: without it a clause chosen
from the menu replaced whatever the author had selected while it loaded.
`insertSourcedBlock` gains an optional `at`, resolved through `insertPoint`.

`ExtensionContext` carries an `editor()` thunk, so a contribution that must act
after an await can reach the editor it belongs to. Three extensions had each
invented a `WeakMap` keyed on their options object, which identifies the
configured extension rather than the editor — one instance shared by two editors
inserted into the wrong document. `addInitialDoc`'s context no longer inherits
it, because that phase genuinely runs before an editor exists.

`SlashMenuItem` carries the spec's `id` and `group` through to the renderer, and
the React menu debounces its searches, clears the previous query's entries up
front instead of leaving them selectable, and asks no resolver when a host
supplies its own `items`.

`editor.runCommand(name, args)` dispatches a declared spec by name. Doing that
through `commands` means spreading `unknown[]` into a union of fixed-arity
signatures, which only typechecks behind a cast; the playground had grown one and
it is deleted here.
