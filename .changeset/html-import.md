---
"@scrivr/html": patch
"@scrivr/core": patch
"@scrivr/docx": patch
---

New `@scrivr/html` package: `importHtml(editor, html)` loads a whole document from HTML, in the browser or on the server (happy-dom, loaded only there). Blocks keep the `data-node-id` the HTML gives them; a repeated id goes to the first block that carries it.

`applyImportedDocument` now lives in `@scrivr/core`, so both importers share it; `@scrivr/docx` still exports it.

Parse rules no longer use `instanceof Element` / `HTMLElement`, which threw on a server: links, images, tables, fields, section breaks and sourced blocks now parse from any DOM. The check is exported as `isHtmlElement`.

`importHtml` also returns `diagnostics`: every style property and element the HTML used that the schema's rules did not read, counted, so an agent can see what did not land.
