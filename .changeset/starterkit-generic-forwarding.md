---
"@scrivr/ai": patch
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
"@scrivr/export-semantic": patch
"@scrivr/docx": patch
---

Extension bundles now compose instead of forwarding by hand, and keybinding
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

Behaviour change worth noting: an extension that previously *replaced* a
built-in keybinding by being registered later now chains behind it, and will not
run if the built-in handles the key. Raise its `keymapPriority` to restore
first refusal.

The other packages carry a version-only bump (lockstep group).
