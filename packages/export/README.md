# @scrivr/export

Export utilities for Scrivr documents — paginated PDF and Markdown.

## Installation

```bash
pnpm add @scrivr/core @scrivr/export
```

## PDF export

`exportToPdf` uses the same layout engine as the canvas renderer — zero fidelity gap: same page breaks, same line positions, same text, same images.

```ts
import { exportToPdf } from '@scrivr/export';

const bytes = await exportToPdf(editor);
const blob = new Blob([bytes], { type: 'application/pdf' });
window.open(URL.createObjectURL(blob));
```

### Custom fonts

By default, standard PDF fonts are used (Helvetica / Times / Courier — no embedding required). Pass a `fontResolver` to embed custom fonts:

```ts
const bytes = await exportToPdf(editor, {
  fontResolver: async (family, weight, style) => {
    const res = await fetch(`/fonts/${family}-${weight}-${style}.ttf`);
    if (!res.ok) return null; // fall back to standard font
    return res.arrayBuffer();
  },
});
```

### Lower-level API

Use `buildPdf` to export from a pre-computed `DocumentLayout` directly (useful for server-side rendering or testing):

```ts
import { buildPdf } from '@scrivr/export';

const layout = editor.layout; // DocumentLayout
const bytes = await buildPdf(layout, options);
```

### What's rendered

- Text spans with bold, italic, underline, strikethrough, highlight, color, and link decorations
- Images (float and inline) — PNG and JPEG, fetched at export time
- List markers (bullet and ordered)
- Horizontal rules
- All page breaks match the canvas layout exactly

## Markdown export

`exportToMarkdown` serializes the editor's current document to a Markdown string using the extension-contributed serializer rules.

```ts
import { exportToMarkdown } from '@scrivr/export';

const md = exportToMarkdown(editor);
navigator.clipboard.writeText(md);
```

Custom nodes and marks are automatically included if their `Extension` definition implements `addMarkdownSerializerRules()`.

## Development

```bash
cd packages/export

# Run all tests
npx vitest run

# Build
pnpm build

# Type-check
pnpm typecheck
```

## License

Apache-2.0
