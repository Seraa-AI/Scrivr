# Inscribe

> **Beta** — APIs may change between releases. Pin to an exact version and review the changelog before upgrading.

Inscribe is an open-source, canvas-rendered document editor framework. Unlike traditional DOM-based rich-text editors, Inscribe renders its content directly onto `<canvas>` elements — giving you pixel-perfect, paginated layouts without fighting the browser's layout engine.

## Architecture

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Model** | ProseMirror | Immutable document tree, schema validation, rich-text history |
| **Layout** | Custom engine | Pagination, line-breaking, and text measurement independent of the DOM |
| **Renderer** | HTML5 Canvas | Paints the document directly onto `<canvas>` for pixel-perfect visual fidelity |
| **Input** | Hidden `<textarea>` | Bridges browser keyboard and IME events to ProseMirror transactions |

## Packages

| Package | Description |
|---------|-------------|
| [`@inscribe/core`](./packages/core) | Headless engine — `Editor`, layout engine, canvas `ViewManager`, and all built-in extensions |
| [`@inscribe/react`](./packages/react) | React bindings — `useInscribeEditor`, `<Inscribe />`, and menu components |
| [`@inscribe/plugins`](./packages/plugins) | Optional extensions — real-time collaboration (Yjs), AI Toolkit, and Track Changes |
| [`@inscribe/export`](./packages/export) | Export utilities — paginated PDF and Markdown |

## Quick Start

```bash
pnpm add @inscribe/core @inscribe/react
```

```tsx
import { useInscribeEditor, Inscribe, StarterKit } from '@inscribe/react';

export function MyEditor() {
  const editor = useInscribeEditor({
    extensions: [StarterKit],
  });

  return <Inscribe editor={editor} style={{ height: '100vh' }} />;
}
```

## Monorepo Structure

```
apps/
  demo/     # Vite + React demo application
  docs/     # Fumadocs documentation site
  server/   # Hocuspocus collaboration server
packages/
  core/     # @inscribe/core
  react/    # @inscribe/react
  plugins/  # @inscribe/plugins
  export/   # @inscribe/export
```

## Development

**Prerequisites:** Node.js ≥ 18, pnpm

```bash
# Install dependencies
pnpm install

# Run the demo app
pnpm dev

# Run the docs site
pnpm dev:docs

# Run all tests
pnpm test

# Build all packages
pnpm build

# Type-check all packages
pnpm typecheck
```

## Documentation

Run the docs site locally:

```bash
pnpm dev:docs
```

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the contribution guide, branch naming conventions, and pull request process.

## License

MIT
