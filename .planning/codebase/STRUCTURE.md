# Codebase Structure

**Analysis Date:** 2025-03-04

## Directory Layout

```
inscribe/
├── apps/
│   ├── demo/               # React demo application
│   ├── docs/               # Documentation (Fumadocs)
│   └── server/             # Collaboration server (Hocuspocus/Y.js)
├── packages/
│   ├── core/               # Main editor engine (Framework-agnostic)
│   ├── react/              # React adapter & UI components
│   ├── plugins/            # Advanced features (AI, Track Changes, Collab)
│   └── export/             # PDF, DOCX, Markdown exporters
├── package.json            # Monorepo root configuration
└── turbo.json              # Turborepo build configuration
```

## Directory Purposes

**`apps/demo`:**
- Purpose: Showcase the editor in a real application.
- Contains: Vite + React application, router, UI shell.
- Key files: `apps/demo/src/App.tsx`, `apps/demo/src/main.tsx`.

**`packages/core`:**
- Purpose: The core document engine. Framework-agnostic.
- Contains: Layout engine, ProseMirror state, Canvas renderer, Extension system.
- Key files: `packages/core/src/Editor.ts`, `packages/core/src/layout/PageLayout.ts`, `packages/core/src/renderer/ViewManager.ts`.

**`packages/react`:**
- Purpose: React bindings for Inscribe.
- Contains: `Canvas` component, hooks for editor instantiation.
- Key files: `packages/react/src/Canvas.tsx`, `packages/react/src/useCanvasEditor.ts`.

**`packages/plugins`:**
- Purpose: Extension-based features that aren't part of the "starter kit".
- Contains: Collaboration (Y.js), AI Toolkit, Track Changes.
- Key files: `packages/plugins/src/collaboration/index.ts`.

**`packages/export`:**
- Purpose: Document serialization to external formats.
- Contains: DOCX generation (OpenXML), PDF generation, Markdown serialization.
- Key files: `packages/export/src/docx/index.ts`.

## Key File Locations

**Entry Points:**
- `packages/core/src/index.ts`: Core engine exports.
- `packages/react/src/index.ts`: React adapter exports.
- `apps/demo/src/main.tsx`: Demo application entry.

**Configuration:**
- `turbo.json`: Monorepo task pipeline.
- `pnpm-workspace.yaml`: Package definitions.
- `tsconfig.base.json`: Shared TypeScript configuration.

**Core Logic:**
- `packages/core/src/Editor.ts`: Central editor orchestrator.
- `packages/core/src/model/schema.ts`: Canonical document schema.
- `packages/core/src/layout/PageLayout.ts`: Pagination logic.

**Testing:**
- `packages/core/src/*.test.ts`: Unit tests for core logic.
- `packages/core/src/test-utils.ts`: Shared testing helpers.

## Naming Conventions

**Files:**
- PascalCase for classes and React components: `Editor.ts`, `Canvas.tsx`, `ViewManager.ts`.
- camelCase for utility files and function-only files: `schema.ts`, `commands.ts`, `canvas.ts`.

**Directories:**
- kebab-case for directories: `ai-toolkit`, `form-fields`, `track-changes`.

## Where to Add New Code

**New Editor Feature (e.g., Table support):**
- Primary code (Extension): `packages/core/src/extensions/built-in/Table.ts`.
- Schema updates: `packages/core/src/model/schema.ts`.
- Strategy/Layout: `packages/core/src/layout/TableStrategy.ts`.

**New React Component (e.g., Toolbar button):**
- Implementation: `packages/react/src/components/ToolbarButton.tsx`.

**New Plugin (e.g., Comments):**
- Implementation: `packages/plugins/src/comments/`.

**Utilities:**
- Shared engine helpers: `packages/core/src/utils.ts`.
- Shared React hooks: `packages/react/src/hooks/`.

## Special Directories

**`.planning/`:**
- Purpose: Technical documentation and planning files (mapped by GSD).
- Generated: No.
- Committed: Yes.

**`packages/*/dist/`:**
- Purpose: Compiled output.
- Generated: Yes (via `turbo build`).
- Committed: No.

---

*Structure analysis: 2025-03-04*
