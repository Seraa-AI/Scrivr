# @scrivr/html

Load a whole Scrivr document from HTML, in the browser or on the server.

```ts
import { ServerEditor, StarterKit } from "@scrivr/core";
import { importHtml, applyImportedDocument } from "@scrivr/html";

const editor = new ServerEditor({ extensions: [StarterKit.configure({ table: true })] });
const { doc } = await importHtml(editor, html);
applyImportedDocument(editor, doc);
```

The HTML is read by the schema's own parse rules (the same ones paste uses), so
anything an extension can paste, it can import. In a browser the page's
`DOMParser` reads it; on a server, happy-dom does. The package's `browser`
export condition keeps happy-dom out of browser bundles.

`<style>` rules apply too, for type, `#id` and `.class` selectors (and
compounds and comma lists of them), with the browser's precedence:
`!important`, then inline style, then specificity, then source order. Text
styles on `<body>` reach the text without overriding an element's own
default, and a container's alignment reaches its blocks.

One bad piece never fails the import: it is reported, and the rest is read.

`importHtml` also returns `diagnostics`: every style and element in the HTML
that no rule read, counted, so an agent can see what did not land.

In the browser, add `HtmlImport` for an `importHtmlFromFile` command and
toolbar item that loads an `.html` file.

Blocks keep the `data-node-id` the HTML gives them. When two blocks share an id,
the first keeps it and the others get new ones.
