# @scrivr/react

React bindings for the Scrivr canvas document editor.

## Installation

```bash
pnpm add @scrivr/core @scrivr/react
```

## Quick Start

```tsx
import { useScrivrEditor, Scrivr, StarterKit } from '@scrivr/react';

export function MyEditor() {
  const editor = useScrivrEditor({
    extensions: [StarterKit],
    onUpdate: ({ editor }) => {
      console.log('doc changed', editor.getJSON());
    },
  });

  return <Scrivr editor={editor} style={{ height: '100vh' }} />;
}
```

## API

### `useScrivrEditor(options, deps?)`

Creates and manages an `Editor` instance. Returns `Editor | null` (null on first render / during SSR).

```ts
const editor = useScrivrEditor({
  extensions: [StarterKit],         // default: [StarterKit]
  pageConfig: { pageWidth: 816 },   // page dimensions and margins
  onUpdate: ({ editor }) => {},     // called on every doc/selection change
  onSelectionUpdate: ({ editor }) => {},
  onFocus: ({ editor }) => {},
  onBlur: ({ editor }) => {},
  onCreate: ({ editor }) => {},
  onDestroy: () => {},
});
```

Pass an optional `deps` array as the second argument to re-create the editor when values change.

### `<Scrivr />`

Mounts the Scrivr rendering engine onto a container `<div>`. Supports both paged and pageless modes — the engine checks `editor.isPageless` automatically.

```tsx
<Scrivr
  editor={editor}
  gap={24}                  // px between pages (default: 24)
  overscan={1}              // extra tiles to keep above/below viewport
  showMarginGuides={false}  // draw margin guide lines (dev aid)
  pageStyle={{ boxShadow: 'none' }}
  className="my-editor"
  style={{ height: '100vh' }}
/>
```

### `useEditorState(options)`

Subscribe to editor state without importing ProseMirror directly. Re-renders only when the selector result changes.

```ts
const { bold, italic } = useEditorState({
  editor,
  selector: ({ editor }) => ({
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
  }),
});
```

## Menu components

The package ships unstyled, headless menu components you can wire up to your own UI:

| Component | Description |
|-----------|-------------|
| `BubbleMenu` | Floating toolbar shown on text selection |
| `FloatingMenu` | Floating toolbar shown on empty lines |
| `SlashMenu` | `/` command palette |
| `LinkPopover` | Popover for inserting/editing links |
| `ImageMenu` | Popover for image float and resize settings |
| `AiSuggestionPopover` | Popover for accepting/rejecting AI suggestions |
| `AiSuggestionCardsPanel` | Card list for reviewing AI diff suggestions |
| `TrackChangesPopover` | Popover for accepting/rejecting tracked changes |
| `TrackChangesPanel` | Sidebar panel listing all tracked changes |

## Re-exports from `@scrivr/core`

For convenience the following are re-exported so you don't need to import `@scrivr/core` directly in most cases:

```ts
import {
  StarterKit, Pagination, defaultPageConfig,
  DEFAULT_FONT_FAMILY, FontFamily, Link,
  Collaboration, CollaborationCursor,
} from '@scrivr/react';
```

## License

Apache-2.0
