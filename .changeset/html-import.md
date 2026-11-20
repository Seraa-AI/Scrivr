---
"@scrivr/html": patch
"@scrivr/core": patch
"@scrivr/docx": patch
---

New `@scrivr/html` package: `importHtml(editor, html)` loads a whole document from HTML, in the browser or on the server, and returns `{ doc, diagnostics }`. Browser bundlers resolve an entry that uses the page's `DOMParser`; Node resolves one that uses happy-dom, so happy-dom never reaches a browser bundle. `HtmlImport` adds an `importHtmlFromFile` command and toolbar item, like `DocxImport`.

- Blocks keep the `data-node-id` the HTML gives them; a repeated id goes to the first block that carries it.
- `<style>` rules apply (type, `#id`, `.class`, compounds and comma lists) with the browser's precedence, `!important` included. Text styles on `<body>` reach the text without overriding an element's own default — links keep their colour, headings their size — and a container's alignment reaches its blocks.
- One bad piece never fails the import. `diagnostics` reports every style property, element and selector the HTML used that the document could not carry, counted, judged by what the schema's own parse rules read.

`@scrivr/core`:
- `applyImportedDocument` moves here so both importers share it (`@scrivr/docx` still exports it), as does `pickFile(accept)`, the file picker both import extensions use.
- Parse rules no longer use `instanceof Element` / `HTMLElement`, which threw on a server; `isHtmlElement` is the shape check they use, exported.
- Paste and import read more of what HTML says: CSS lengths in any unit for font size (`1.5em` was 1.5px) and, on import, for indents; `text-align: start/end` (stored raw before); `<font color face size>`; a `<div>` of inline content as a paragraph with its alignment, while an empty spacer div adds nothing. On import, a span's visible background is a highlight — paste still cleans a source page's backgrounds away.
