# @scrivr/export-markdown

Markdown export for Scrivr documents.

## Installation

```bash
pnpm add @scrivr/core @scrivr/export-markdown
```

## Usage

```ts
import { exportToMarkdown } from '@scrivr/export-markdown';

const md = exportToMarkdown(editor);
navigator.clipboard.writeText(md);
```

Custom nodes and marks are automatically included if their `Extension` definition implements `addMarkdownSerializerRules()`.

## License

Apache-2.0
