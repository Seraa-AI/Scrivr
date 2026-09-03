# @scrivr/docx

DOCX import + export for Scrivr documents — semantic round-trip to Office Open XML (WordprocessingML).

Both sides are extension-aware: nodes and marks contributed by your custom extensions can register their own DOCX serializers and parsers, so the round-trip stays lossless for the schema you actually use.

## Installation

```bash
pnpm add @scrivr/core @scrivr/docx
```

## Usage in the editor

Add the extensions to wire up toolbar buttons and editor commands:

```ts
import { Editor, StarterKit } from '@scrivr/core';
import { DocxExport, DocxImport } from '@scrivr/docx';

new Editor({
  extensions: [
    StarterKit,
    DocxImport,
    DocxExport.configure({ filename: 'my-doc' }),
  ],
});
```

This adds:

- A "⬆ DOCX" toolbar button + `editor.commands.importDocxFromFile()` — opens a file picker and replaces the document.
- A "⬇ DOCX" toolbar button + `editor.commands.exportDocx()` — triggers a browser download.

## Usage on the server

The bare functions don't need a view or a layout. Pair them with `ServerEditor` from `@scrivr/core`:

```ts
import { ServerEditor, StarterKit } from '@scrivr/core';
import { importDocx, exportDocx } from '@scrivr/docx';

const editor = new ServerEditor({ extensions: [StarterKit] });

// Import
const { doc, diagnostics } = await importDocx(editor, bytes);
editor.setContent(doc.toJSON());

// Export
const { bytes: out, diagnostics: warnings } = await exportDocx(editor);
```

Both functions return a `diagnostics` array — DOCX conversion is inherently lossy, and warnings (dropped nodes, approximated mappings, missing media parts) surface here instead of throwing. Fatal failures throw `DocxImportError` / `DocxExportError` with the same diagnostics attached.

## Options

```ts
await exportDocx(editor, {
  unsupported: 'drop',        // 'drop' | 'warn' | 'throw'  — default: 'drop'
  fidelity: 'compatible',     // 'compatible' | 'strict'    — default: 'compatible'
});

await importDocx(editor, bytes, {
  unsupported: 'drop',
  fidelity: 'compatible',
  media: 'data-url',          // 'data-url' | 'skip' | custom sink — default: 'data-url'
});
```

The same options can be set as defaults on the extension via `.configure({...})`; per-call options on `editor.commands.exportDocx({...})` override them.

## Extending

Custom nodes/marks can contribute their own DOCX handlers via the extension API:

```ts
import { Extension } from '@scrivr/core';

export const Callout = Extension.create({
  name: 'callout',
  addExports() {
    return {
      docx: {
        nodes: {
          callout: (node, ctx) => { /* return XML nodes */ },
        },
      },
    };
  },
  addImports() {
    return {
      docx: {
        paragraph: (intermediate, ctx) => { /* return PM node or null */ },
      },
    };
  },
});
```

The exported `xml` / `serializeXml` helpers and `DocxContext` / `DocxImportContext` types are available for advanced handlers.

## License

Apache-2.0
