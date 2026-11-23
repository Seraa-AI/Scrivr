---
"@scrivr/core": patch
"@scrivr/react": patch
---

Headings take their level as an argument: `editor.commands.setHeading({ level: 2 })`. The new `toggleHeading({ level })` sets that heading, or turns it back into a paragraph when the block already is one. Both return `false` for a level the editor was not configured with.

**Breaking:** `setHeading1()` … `setHeading6()` are removed. Replace each with `setHeading({ level: N })`, and a call that still uses the old name fails to compile. The toolbar and slash-menu entries now run `setHeading` with `args: [{ level }]`, so a host that told the heading entries apart by `command` should use the slash entry's `id` (`heading.1` …) or the toolbar item's `args`.

`useSlashMenu` picks its glyphs by entry `id`, so H1, H2 and H3 keep their own.
