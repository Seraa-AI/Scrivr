---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export": patch
"@scrivr/export-pdf": patch
"@scrivr/export-docx": patch
"@scrivr/export-markdown": patch
---

`@scrivr/core` — new first-class `HardBreak` extension, individually
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
  hardBreak: false,                       // drop entirely
})

StarterKit.configure({
  hardBreak: { shortcut: false },         // keep node + command, drop Shift-Enter
})
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
