---
"@scrivr/core": patch
"@scrivr/react": patch
---

An extension declares the slash entries that insert its own node.

The slash menu hard-coded its formatting entries in the React hook and asked the
source providers directly, so an extension could not contribute to the menu that
inserts the thing it owns — a host wanting clause entries had to enumerate the
commands itself and fetch content by reaching past the extension that owns it.

`addSlashCommands()` declares listable entries where the node is defined, and
`editor.getSlashCommands()` collects them in registration order. `SlashCommandSpec`
is data only, like `ToolbarItemSpec`: an id, a command name, args, and the three
strings a menu renders. The eight built-in entries now come from `Heading`,
`List`, `CodeBlock` and `HorizontalRule`, and the heading entries follow the
configured `levels` — a kit built with fewer no longer offers entries it cannot
honour.

`addSlashCommandResolver()` answers the entries that have to be searched rather
than listed. `editor.resolveSlashCommands(query, signal)` runs every resolver and
checks the signal twice: before they start, so an abandoned query costs nothing,
and again once they answer, so a resolver that ignores its own signal still
cannot replace the entries for the query the reader has typed past. It throws
`signal.reason` instead of resolving, which is what lets a caller trust a result
it is holding. The signal is required, because a caller allowed to omit it is a
caller allowed to build the bug.

`editor.runCommand(name, args)` dispatches a declared spec's command. These specs
name a command rather than closing over one, so a surface rendering them has to
dispatch by name — which through `commands` means spreading `unknown[]` into a
union of fixed-arity signatures, and only typechecks behind a cast. Every such
surface grew its own; the playground's is deleted here.

The React `useSlashMenu` reads the editor's entries instead of building its own
list, and appends resolved ones as the reader types.
