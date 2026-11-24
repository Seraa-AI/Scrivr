# @scrivr/html

## 1.0.27

### Patch Changes

- f3d4186: Dependency updates, including the ones that fix known security advisories. `@scrivr/docx` moves to `fast-xml-parser` 5 and `@scrivr/html` to `happy-dom` 21. `@scrivr/core` no longer depends on `@floating-ui/dom`, which it did not use.

  Importing a Word file keeps text that looks like a number as it was written: `007` came in as `7` and `1.50` as `1.5`. Numeric character references such as `&#8217;` are read as the character they stand for, and an error for a file that cannot be read no longer quotes the file's text. A file with elements after the end of its root element is refused instead of losing them. Exporting leaves out characters that XML does not allow, which made the file unreadable.

  `@scrivr/core` pins two ProseMirror packages whose newest releases change behavior. With `prosemirror-history` 1.5.2, redoing an alignment or heading moved the selection to the next paragraph. With `prosemirror-markdown` 1.14, bold text that also has a color, font, link or underline and ends in a space was written as literal asterisks. A new install of an earlier Scrivr release could already pick these up. Import ProseMirror from `@scrivr/core/pm`: a second copy of `prosemirror-history` in your app does not see the editor's history.

  Markdown export writes the space at the end of struck text outside the `~~`, so it is read back as struck text.

- Updated dependencies [f3d4186]
- Updated dependencies [867d7e2]
- Updated dependencies [54b21ca]
  - @scrivr/core@1.0.27

## 1.0.26

### Patch Changes

- de92dc4: New `@scrivr/html` package: `importHtml(editor, html)` loads a whole document from HTML, in the browser or on the server, and resolves to `{ doc, diagnostics }` (`const { doc, diagnostics } = await importHtml(editor, html)`). Its types are exported: `HtmlImportResult`, `HtmlImportDiagnostic`, `HtmlDiagnosticCode` and `ImportHtml`. Browser bundlers resolve an entry that uses the page's `DOMParser`; Node resolves one that uses happy-dom, so happy-dom never reaches a browser bundle. `HtmlImport` adds an `importHtmlFromFile` command and toolbar item, like `DocxImport`.

  - Blocks keep the `data-node-id` the HTML gives them; a repeated id goes to the first block that carries it.
  - `<style>` rules apply (type, `#id`, `.class`, compounds and comma lists) with the browser's precedence, `!important` included. Styles inherit as in CSS: the page's text styles reach the text without overriding what an element states or sets by default — its `align`, `<font>`'s attributes, a link's colour, a heading's size — and a block's alignment reaches the blocks and loose text inside it.
  - One bad piece never fails the import. `diagnostics` reports the style properties, elements and selectors the HTML used that the document could not carry, counted, judged by what the schema's own parse rules take — a shorthand longhand by longhand, a value by whether a rule accepts it.

  `@scrivr/core`:

  - `applyImportedDocument` moves here so both importers share it (`@scrivr/docx` still exports it), as does `pickFile(accept)`, the file picker both import extensions use.
  - Parse rules no longer use `instanceof Element` / `HTMLElement`, which threw on a server. `isHtmlElement`, a shape check for any DOM, `HTML_BLOCK_TAGS`, `HTML_IGNORED_TAGS`, `isHtmlBlock`, `htmlAlign`, `htmlShows` (whether HTML puts anything on the page), `isReadableTextAlign` and the `TextAlign` type are exported.
  - Paste and import read more of what HTML says: CSS lengths in any unit for font size (`1.5em` was 1.5px) and, on import, for indents; `text-align: start/end` (stored raw before); `<font color face size>`; a `<div>` of inline content (a field included) as a paragraph with its alignment, while a div that shows nothing adds nothing; `color`/`font-size`/`font-family: initial` reset an inherited colour, size or family, `font-weight`/`font-style: normal` undo bold or italic, on the tag itself or around it (Google Docs' `<b style="font-weight:normal">` wrapper adds no bold), weights up to 1000 count, `align` on a paragraph, heading or div applies with HTML's values (`middle` centres) while `text-align` takes CSS's (`-webkit-center` centres) and, as in a browser, beats `align` only with a value it can read (`inherit` included), a CSS-wide keyword is no longer stored as a colour, size or family, and a font size of zero or less is dropped. On import, a span's visible background is a highlight — paste still cleans a source page's backgrounds away.

- Updated dependencies [7c8da5f]
- Updated dependencies [ff75a67]
- Updated dependencies [7c8da5f]
- Updated dependencies [f7a8c9e]
- Updated dependencies [7c8da5f]
- Updated dependencies [de92dc4]
- Updated dependencies [92a41b7]
- Updated dependencies [03281da]
  - @scrivr/core@1.0.26
