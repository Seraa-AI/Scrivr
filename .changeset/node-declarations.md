---
"@scrivr/core": patch
"@scrivr/export-pdf": patch
"@scrivr/export-semantic": patch
"@scrivr/plugins": patch
---

A node declares that it breaks the page or the line. Page breaks and line
breaks work exactly as before, now from `PageBreak` and `HardBreak` instead of
by name in the engine. (Which blocks are bookmarked in a PDF is declared by
`outlineLevel` on the node spec; see the outline-level note.)

- **`NodeLayout` gains `{ kind: "break", breaks: "page" | "line" }`** (`BreakKind`).
  A block that breaks the page starts the next block on a new page; an inline
  node that breaks the line ends its line. A break its context cannot honour
  lays out as a plain leaf; a node that holds content ignores it. A page
  break's flow `blockType` is its node's name. `breakOf(type)` reads it, and
  the semantic exporter, the agent's rich diff and the header/footer surfaces
  honour declared breaks as they do the built-in ones.
- **Pasted markdown goes through the tokens extensions declare.**
  `Strikethrough` declares `~~text~~`, so it pastes struck through. Markdown
  holding a construct no extension declares (a pipe table without `Table`)
  pastes as plain text, one paragraph per line. Inline code, links,
  blockquotes and images that no extension declares paste as their markdown
  text; inline code was dropped before.

**Breaking:**

- Removed the `addMarkdownRules()` extension hook, `MarkdownBlockRule`,
  `ExtensionManager.buildMarkdownRules()` and `ResolvedExtension.markdownRules`.
  Declare markdown tokens with `addMarkdownParserTokens()` instead.
- `PasteTransformer`'s constructor drops its `extraMarkdownRules` argument:
  `new PasteTransformer(schema, markdownParserTokens, options)`.
