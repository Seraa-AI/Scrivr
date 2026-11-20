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
`DOMParser` reads it; on a server, happy-dom does.

Blocks keep the `data-node-id` the HTML gives them. When two blocks share an id,
the first keeps it and the others get new ones.
