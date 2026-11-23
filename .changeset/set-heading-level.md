---
"@scrivr/core": patch
"@scrivr/react": patch
---

Headings take their level as an argument: `editor.commands.setHeading({ level: 2 })`. The new `toggleHeading({ level })` sets the selected blocks to that heading, or turns them back into paragraphs when every one already is a heading of that level. Both return `false` for a level the editor was not configured with, when no level is passed, or when nothing would change. Changing a block between paragraph and heading, or a heading's level, now keeps its alignment, indent and id, through the commands and the `Mod-Alt-0…6` shortcuts alike. With Select All, the empty paragraph a document ends in is left as it is, so pressing a heading button repeatedly no longer adds an empty heading each time. `HeadingLevel` is exported from `@scrivr/core` for a host that holds a level in a variable.

**Breaking:** `setHeading1()` … `setHeading6()` are removed. Replace each with `setHeading({ level: N })`.
- TypeScript reports every old call. In plain JavaScript, `editor.commands.setHeading1` is now undefined, and `runCommand("setHeading1")` or a saved spec naming it returns `false`.
- The toolbar and slash-menu heading entries now run `setHeading` with `args: [{ level }]`. A host that told them apart by `command` should use the slash entry's `id` (`heading.1` …) or the toolbar item's `args`.

`useSlashMenu` picks its glyphs by entry `id`, so H1, H2 and H3 keep their own. A host's own entry gets a glyph only under one of the built-in ids, even when it runs a built-in command.
