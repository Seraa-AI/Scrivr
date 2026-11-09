---
"@scrivr/core": patch
"@scrivr/export-pdf": patch
---

A node declares that it breaks the page or the line, and an extension declares
which of its blocks are bookmarked in a PDF. Page breaks, line breaks and PDF
bookmarks work exactly as before, now from `PageBreak`, `HardBreak` and
`Heading` instead of by name in the engine.

- **`NodeLayout` gains `{ kind: "break", breaks: "page" | "line" }`** (`BreakKind`).
  A block that breaks the page starts the next block on a new page; an inline
  node that breaks the line ends its line. A break its context cannot honour
  lays out as a plain leaf. A page break's flow `blockType` is its node's name.
- **`addExports().pdf.outline`** maps a node name to a `PdfOutlineLevel`,
  `(node) => number | null`: the block's bookmark level, 1 at the top. `Heading`
  declares its level, clamped to its configured `levels` as its DOCX export is.
- **Pasted markdown goes through the tokens extensions declare.**
  `Strikethrough` declares `~~text~~`, so it pastes struck through. Markdown
  holding a construct no extension declares (a pipe table without `Table`)
  pastes as plain text, one paragraph per line.

**Breaking:**

- Removed the `addMarkdownRules()` extension hook, `MarkdownBlockRule` and
  `ExtensionManager.buildMarkdownRules()`. Declare markdown tokens with
  `addMarkdownParserTokens()` instead.
- `PasteTransformer`'s constructor drops its `extraMarkdownRules` argument:
  `new PasteTransformer(schema, markdownParserTokens, options)`.
