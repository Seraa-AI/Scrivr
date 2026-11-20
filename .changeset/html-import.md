---
"@scrivr/html": patch
"@scrivr/core": patch
"@scrivr/docx": patch
---

New `@scrivr/html` package: `importHtml(editor, html)` loads a whole document from HTML, in the browser or on the server (happy-dom, loaded only there). Blocks keep the `data-node-id` the HTML gives them; a repeated id goes to the first block that carries it.

`applyImportedDocument` now lives in `@scrivr/core`, so both importers share it; `@scrivr/docx` still exports it.

Parse rules no longer use `instanceof Element` / `HTMLElement`, which threw on a server: links, images, tables, fields, section breaks and sourced blocks now parse from any DOM. The check is exported as `isHtmlElement`.

`importHtml` also returns `diagnostics`: every style property and element the HTML used that the schema's rules did not read, counted, so an agent can see what did not land.

`HtmlImport` adds an `importHtmlFromFile` command and toolbar item for the browser, like `DocxImport`. The file picker both use is now `pickFile(accept)` in `@scrivr/core`. Browser bundlers get an `@scrivr/html` entry without happy-dom (the `browser` export condition); Node gets the happy-dom one.

HTML read by paste and import understands more of what it says: CSS lengths in any unit for indents and font size (`1.5em` was 1.5px), `text-align: start/end` (stored raw before), a span's background as a highlight, `<font color face size>`, and a text-only `<div>` as a paragraph with its alignment.
