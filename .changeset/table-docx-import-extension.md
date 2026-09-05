---
"@scrivr/core": patch
"@scrivr/docx": patch
---

**A table's DOCX import moves to the extension that owns tables**

Turning a parsed `<w:tbl>` into nodes was built into `@scrivr/docx`, while
writing one lived on the Table extension. Both directions describe the same
thing — what a table *is* — so splitting them meant no single place answered the
question, and an extension that could not read a file into the nodes it defines
looked like a feature that was never built.

`Table.addImports()` now contributes the block handler, next to the
`addExports()` it already had. Parsing the OOXML into an intermediate block
stays in `@scrivr/docx`, as it does for every other node.

- **`@scrivr/core`** — `DocxImportContext` gains `walkBlocks(blocks)`, which
  transforms nested blocks through the same handlers as the body. A contribution
  owning a container node needs it: a table's cells hold ordinary blocks, and
  each of those belongs to whichever extension owns it, not to the table. This
  is what kept tables in the package before — the recursion needed the handler
  set, and a block transform had no way to ask for it.
- **`@scrivr/docx`** — a table in a file opened by an editor without the Table
  extension is now reported as an unclaimed block (`unsupported-block`) and
  dropped, the same as any other block nothing has registered for. It previously
  reported `schema-missing-table` from the package's own table reader.

  This changes what `unsupported: "throw"` does with such a file. A table the
  document will not contain is content the file had and the import lost, so a
  caller who asked to be told now is: the import rejects instead of quietly
  dropping the table. Enabling the Table extension, or the default `"drop"`
  policy, imports exactly as before.
- **`@scrivr/docx`** — `buildListNode` reads its items through the same
  `walkBlocks`, so one rule states how a container's children are read.
