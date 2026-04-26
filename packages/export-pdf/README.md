# @scrivr/export-pdf

PDF export for Scrivr documents. Uses the same layout pipeline as the canvas renderer — zero fidelity gap: same page breaks, same line positions, same text, same images.

## Installation

```bash
pnpm add @scrivr/core @scrivr/export-pdf
```

## Usage

```ts
import { exportToPdf } from '@scrivr/export-pdf';

const bytes = await exportToPdf(editor);
const blob = new Blob([bytes], { type: 'application/pdf' });
window.open(URL.createObjectURL(blob));
```

### Custom fonts

By default, standard PDF fonts are used (Helvetica / Times / Courier). Pass a `fontResolver` to embed custom fonts:

```ts
const bytes = await exportToPdf(editor, {
  fontResolver: async (family, weight, style) => {
    const res = await fetch(`/fonts/${family}-${weight}-${style}.ttf`);
    if (!res.ok) return null;
    return res.arrayBuffer();
  },
});
```

### What's rendered

- Text spans with bold, italic, underline, strikethrough, highlight, color, and link decorations
- Images (float and inline) — PNG and JPEG
- List markers (bullet and ordered)
- Horizontal rules
- Headers and footers with token substitution
- All page breaks match the canvas layout exactly

## License

Apache-2.0
