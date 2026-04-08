# @scrivr/core

The headless engine powering Scrivr — canvas layout, rendering, ProseMirror model, and all built-in extensions.

## Installation

```bash
pnpm add @scrivr/core
```

## What's inside

### Editor

`Editor` is the main orchestrator. It owns the ProseMirror state, layout engine, canvas renderer, and input bridge.

```ts
import { Editor, StarterKit } from '@scrivr/core';

const editor = new Editor({
  extensions: [StarterKit],
  element: document.getElementById('editor')!,
});
```

For server-side or test use cases where no DOM is needed, use `ServerEditor` or `BaseEditor`.

### Layout engine

The layout pipeline converts a ProseMirror document into paginated canvas coordinates:

```
buildBlockFlow → applyFloatLayout → paginateFlow → buildFragments
```

Key classes: `LayoutCoordinator`, `PageLayout`, `BlockLayout`, `LineBreaker`, `TextMeasurer`, `CharacterMap`.

### Renderer

`TileManager` is the active renderer. It manages page `<div>`s, two `<canvas>` layers per page (content + overlay), and virtual scrolling via `IntersectionObserver` for both paged and pageless modes. `PageRenderer` paints each `LayoutPage`. `OverlayRenderer` draws cursors and selections.

### Extensions

Extensions add nodes, marks, commands, keymaps, and layout strategies. `StarterKit` bundles all 17 built-in extensions.

```ts
import { StarterKit, Extension } from '@scrivr/core';

class MyExtension extends Extension {
  static create() { return new MyExtension(); }
  // addNodes, addMarks, addCommands, addKeymaps, ...
}
```

### Schema

Built-in nodes: `doc`, `paragraph`, `heading`, `bullet_list`, `ordered_list`, `list_item`, `table`, `table_row`, `table_cell`, `blockquote`, `code_block`, `image`, `hard_break`.

Built-in marks: `bold`, `italic`, `underline`, `strikethrough`, `highlight`, `color`, `font_size`, `font_family`, `link`.

## Key exports

```ts
// Editor classes
export { Editor, BaseEditor, ServerEditor } from '@scrivr/core';

// Extensions & configuration
export { StarterKit, Pagination, defaultPageConfig, DEFAULT_FONT_FAMILY } from '@scrivr/core';
export { FontFamily, Link } from '@scrivr/core';

// Renderer
export { TileManager } from '@scrivr/core';

// Types
export type { EditorOptions, PageConfig, DocumentLayout, Extension } from '@scrivr/core';
```

## Commands

```ts
editor.commands.toggleBold();
editor.commands.setFontFamily('Georgia');
editor.commands.insertTable({ rows: 3, cols: 3 });
```

## Development

```bash
cd packages/core

# Run all tests
npx vitest run

# Run a single test file
npx vitest run src/layout/PageLayout.test.ts

# Watch mode
npx vitest

# Build
pnpm build

# Type-check
pnpm typecheck
```

> Never run bare `npx vitest run` from the repo root — it misses `vitest.config.ts` and `setupFiles`.

## License

Apache-2.0
