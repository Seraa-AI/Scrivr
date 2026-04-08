# @scrivr/plugins

Optional extensions for Scrivr — real-time collaboration, AI Toolkit, AI Suggestions, and Track Changes.

## Installation

```bash
pnpm add @scrivr/core @scrivr/plugins
```

Peer dependencies are optional and only required for the features you use:

```bash
# Collaboration
pnpm add yjs y-prosemirror @hocuspocus/provider

# (AI Toolkit and Track Changes have no extra peer deps)
```

## Plugins

### Collaboration

Real-time collaborative editing via [Yjs](https://yjs.dev) and [HocusPocus](https://hocuspocus.dev).

```ts
import { Editor } from '@scrivr/core';
import { Collaboration, CollaborationCursor } from '@scrivr/plugins';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';

const ydoc = new Y.Doc();
const provider = new HocuspocusProvider({ url: 'ws://localhost:1234', name: 'my-doc', document: ydoc });

const editor = new Editor({
  extensions: [
    StarterKit,
    Collaboration.configure({ document: ydoc }),
    CollaborationCursor.configure({ provider, user: { name: 'Alice', color: '#f783ac' } }),
  ],
});
```

### AI Toolkit

Streaming ghost-text and AI caret overlay for in-editor AI writing assistance. The document stays unchanged until `acceptSuggestion` is called — streaming is cosmetic (canvas overlay only).

```ts
import { AiToolkit, GhostText, AiCaret, UniqueId } from '@scrivr/plugins';

const editor = new Editor({
  extensions: [StarterKit, UniqueId, GhostText, AiCaret, AiToolkit],
});

// Stream a suggestion
const api = editor.commands.getAiToolkit();
api.streamSuggestion({ text: 'Once upon a time...' });
api.acceptSuggestion();
```

### AI Suggestions (diff-based)

Display AI-generated document diffs as tracked suggestions with accept/reject controls. Supports character-level, multi-block, and semantic diffs.

```ts
import { AiSuggestion } from '@scrivr/plugins';
import { computeAiSuggestion, showAiSuggestion, applyAiSuggestion, rejectAiSuggestion } from '@scrivr/plugins';

const editor = new Editor({
  extensions: [StarterKit, AiSuggestion],
});

const suggestion = await computeAiSuggestion({
  editor,
  newText: 'The revised paragraph text.',
});

showAiSuggestion(editor, suggestion);
// User reviews overlay, then:
applyAiSuggestion(editor, suggestion);
// or
rejectAiSuggestion(editor, suggestion);
```

### Track Changes

Multi-author tracked changes with accept/reject and conflict detection. Integrates with the `TrackChangesPanel` and `TrackChangesPopover` React components from `@scrivr/react`.

```ts
import { TrackChanges } from '@scrivr/plugins';

const editor = new Editor({
  extensions: [
    StarterKit,
    TrackChanges.configure({ author: 'alice', enabled: true }),
  ],
});

// Accept / reject all changes
editor.commands.acceptAllChanges();
editor.commands.rejectAllChanges();
```

## Development

```bash
cd packages/plugins

# Run all tests
npx vitest run

# Watch mode
npx vitest

# Build
pnpm build

# Type-check
pnpm typecheck
```

## License

Apache-2.0
