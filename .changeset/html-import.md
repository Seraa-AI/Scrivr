---
"@scrivr/html": patch
"@scrivr/core": patch
"@scrivr/docx": patch
---

New `@scrivr/html` package: `importHtml(editor, html)` loads a whole document from HTML, in the browser or on the server, and returns `{ doc, diagnostics }`. Browser bundlers resolve an entry that uses the page's `DOMParser`; Node resolves one that uses happy-dom, so happy-dom never reaches a browser bundle. `HtmlImport` adds an `importHtmlFromFile` command and toolbar item, like `DocxImport`.

- Blocks keep the `data-node-id` the HTML gives them; a repeated id goes to the first block that carries it.
- `<style>` rules apply (type, `#id`, `.class`, compounds and comma lists) with the browser's precedence, `!important` included. Styles inherit as in CSS: the page's text styles reach the text without overriding what an element states or sets by default — its `align`, `<font>`'s attributes, a link's colour, a heading's size — and a block's alignment reaches the blocks and loose text inside it.
- One bad piece never fails the import. `diagnostics` reports the style properties, elements and selectors the HTML used that the document could not carry, counted, judged by what the schema's own parse rules take — a shorthand longhand by longhand, a value by whether a rule accepts it.

`@scrivr/core`:
- `applyImportedDocument` moves here so both importers share it (`@scrivr/docx` still exports it), as does `pickFile(accept)`, the file picker both import extensions use.
- Parse rules no longer use `instanceof Element` / `HTMLElement`, which threw on a server. `isHtmlElement`, a shape check for any DOM, `HTML_BLOCK_TAGS`, `HTML_IGNORED_TAGS`, `isHtmlBlock` and `htmlShows` (whether HTML puts anything on the page) are exported.
- Paste and import read more of what HTML says: CSS lengths in any unit for font size (`1.5em` was 1.5px) and, on import, for indents; `text-align: start/end` (stored raw before); `<font color face size>`; a `<div>` of inline content (a field included) as a paragraph with its alignment, while a div that shows nothing adds nothing; `color`/`font-size`/`font-family: initial` reset an inherited colour, size or family, `font-weight`/`font-style: normal` undo bold or italic, on the tag itself or around it (a Google Docs wrapper is plain text), weights up to 1000 count, `align` on a paragraph, heading or div applies, `align="middle"` and `-webkit-center` centre, a CSS-wide keyword is no longer stored as a colour, size or family, and a font size of zero or less is dropped. On import, a span's visible background is a highlight — paste still cleans a source page's backgrounds away.
