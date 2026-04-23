---
"@scrivr/core": patch
"@scrivr/react": patch
"@scrivr/plugins": patch
"@scrivr/export-pdf": patch
"@scrivr/export-markdown": patch
---

**@scrivr/react** — Add `readOnly` option to `useScrivrEditor` hook. Reset `letterSpacing`, `wordSpacing`, `textTransform` on the `<Scrivr>` container to prevent host app CSS from causing cursor drift.

**@scrivr/core** — New `Indent` extension with block indent (`Mod-]`/`Mod-[`, 0-8 levels at 24px each) and first-line indent (`textIndent` attr in px). Both inherited on Enter split, parsed from paste, serialized to DOM. Expose `getMarkdownParserTokens()` and `parseMarkdown(text)` on `BaseEditor` for server-side markdown parsing.
