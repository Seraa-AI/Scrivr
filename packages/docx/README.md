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
const { doc, diagnostics, report } = await importDocx(editor, bytes);
editor.setContent(doc.toJSON());

// Export
const { bytes: out, diagnostics: warnings } = await exportDocx(editor);
```

Both functions return a `diagnostics` array — DOCX conversion is inherently lossy, and warnings (dropped nodes, approximated mappings, missing media parts) surface here instead of throwing. Fatal failures throw `DocxImportError` / `DocxExportError` with the same diagnostics attached.

### What a conversion kept and dropped

Both functions also return a `report`, the inventory of the conversion:

```ts
report.counts.paragraph; // { kept: 214, dropped: 0, changed: 0 }
report.entries;          // [{ outcome: "dropped", kind: "sdt", reason: "no handler", owner: null, count: 2 }, …]
```

- **`counts`** has a total for each kind of content.
- **`entries`** lists each distinct drop and change, in the order the conversion first met it, with:
  - the reason;
  - how many times it happened (`count`);
  - its `owner`: the extension that recorded it, `"overrides"` for a handler passed in the call's `overrides`, or `null` when nothing handled the content.

So an app can say "imported 214 paragraphs and 37 line breaks; omitted 2 content controls".

The words the converter writes in `reason` and `owner` are exported, so an app that groups or translates entries matches on them rather than on copied strings: `NO_HANDLER`, `NO_PARSER`, `HANDLER_RETURNED_NOTHING`, `WRAPPER_DECLINED`, `OVERRIDES_OWNER`, and `insideDropped(kind)` / `noSchemaNode(name)` for the reasons that name a kind.

An export names content in Scrivr's terms (`paragraph`, `bold`). An import names it in Word's terms, as the parser reads them: block and inline types (`paragraph`, `hardBreak`), run properties without their prefix (`b`, `lang`), and, for a top-level element the parser cannot read, the element's full name (`w:customXml`).

**What it covers.** The report covers every item a handler or a built-in fallback was given, and every top-level body element the parser could not read. When an item is lost, the content inside it is counted as dropped with it. A diagnostic is a warning, so the report also lists drops too common to warn about, such as a `lang` run property. Not yet covered: elements the parser skips inside a paragraph or run, such as an equation or a text box. Those are not in the report.

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

A handler does not have to report anything. The converter records each item it hands a handler as kept when the handler returns content and as dropped when it returns nothing, under the extension's name. A handler adds what only it can see, through `ctx.report`:

```ts
callout: (node, children, ctx) => {
  ctx.report.changed('callout', 'exported as a plain paragraph');
  return xml('w:p', undefined, children);
},
```

When a handler calls `ctx.report.kept(kind, count)` or `ctx.report.dropped(kind, reason)` with the kind it was handed, its account replaces the converter's for that item. Calls for any other kind are counted as well and replace nothing. `changed` is a note on content that was kept, and one item can carry several.

Two cases where a handler returns nothing and should say `kept`:

- **A value that means "no formatting".** Word's `w:color="auto"` builds no mark, but nothing was lost: the editor's default is what the file asked for. The built-in Color, Highlight and FontFamily handlers report these kept.
- **Content written somewhere other than the result**, such as a footnote written to its own part. The handler reports its item kept, and the content inside it stays kept too.

## License

Apache-2.0
