# Architecture

**Analysis Date:** 2025-03-04

## Pattern Overview

**Overall:** ProseMirror State + Custom Canvas Layout/Rendering

**Key Characteristics:**
- **Stateless Document Model:** Uses ProseMirror's `EditorState` and `Schema` for a robust, immutable document model with full history support.
- **Custom Pagination & Layout:** Implements a custom layout engine that computes page boundaries, line breaks, and block positioning independently of the DOM.
- **Canvas-based Rendering:** Renders document pages directly to `<canvas>` elements for high-performance, pixel-perfect document display (similar to Google Docs).
- **Extension-driven:** All editor capabilities (nodes, marks, commands, keymaps) are modularized into extensions coordinated by an `ExtensionManager`.

## Layers

**Model Layer:**
- Purpose: Manages the document structure, selection, and history.
- Location: `packages/core/src/model`
- Contains: `schema.ts`, `state.ts`, `commands.ts`
- Depends on: `prosemirror-model`, `prosemirror-state`
- Used by: `Editor.ts`, `ExtensionManager.ts`

**Layout Layer:**
- Purpose: Computes the visual representation of the document (pagination, line breaking).
- Location: `packages/core/src/layout`
- Contains: `PageLayout.ts` (Pagination), `BlockLayout.ts` (Line breaking), `TextMeasurer.ts` (Canvas-based measurement)
- Depends on: Model Layer
- Used by: `Editor.ts`, `ViewManager.ts`

**Renderer Layer:**
- Purpose: Paints the layout onto HTML5 Canvases.
- Location: `packages/core/src/renderer`
- Contains: `PageRenderer.ts` (Text/Blocks), `OverlayRenderer.ts` (Cursor/Selection), `ViewManager.ts` (DOM/Canvas orchestration)
- Depends on: Layout Layer, Model Layer
- Used by: `packages/react/src/Canvas.tsx`

**Input Layer:**
- Purpose: Bridges browser keyboard/IME events to ProseMirror transactions.
- Location: `packages/core/src/input`
- Contains: `Editor.ts` (Hidden `<textarea>` logic), `PasteTransformer.ts`
- Depends on: Model Layer, Layout Layer (for positioning the bridge)
- Used by: `Editor.ts`

## Data Flow

**Document Update (Edit):**

1. **Input:** User types in the hidden `<textarea>` or triggers a keybind.
2. **Transaction:** `Editor.ts` captures the event, translates it into a ProseMirror `Transaction`.
3. **Dispatch:** The transaction is applied to the `EditorState`, producing a new state.
4. **Invalidation:** `Editor.ts` marks the layout as "dirty".
5. **Layout:** `ensureLayout()` runs `layoutDocument()`, computing new page and block positions.
6. **Notification:** Subscribers (like `ViewManager`) are notified of the change.
7. **Render:** `ViewManager.update()` triggers `PageRenderer` to repaint visible canvases.

**Rendering Pipeline:**

1. **Document:** `Node` tree from ProseMirror.
2. **Pagination:** `layoutDocument()` splits blocks across `LayoutPage` objects based on `PageConfig`.
3. **Line Breaking:** `layoutBlock()` uses `LineBreaker` to split text into lines based on available width.
4. **Painting:** `PageRenderer` walks the layout and uses `CanvasRenderingContext2D` to draw glyphs and blocks.

## Key Abstractions

**`Editor`:**
- Purpose: The central orchestrator for state, layout, and input.
- Location: `packages/core/src/Editor.ts`
- Pattern: Singleton-per-instance controller.

**`Extension`:**
- Purpose: Defines a discrete feature (e.g., Bold, Heading) by providing schema, commands, and keymaps.
- Location: `packages/core/src/extensions/Extension.ts`
- Pattern: Modular configuration pattern.

**`ViewManager`:**
- Purpose: Manages the lifecycle of page DOM elements and their canvases.
- Location: `packages/core/src/renderer/ViewManager.ts`
- Pattern: Virtualized view orchestrator.

**`CharacterMap`:**
- Purpose: Maps document positions to (page, x, y) coordinates and vice versa.
- Location: `packages/core/src/layout/CharacterMap.ts`
- Pattern: Spatial index for hit-testing and cursor rendering.

## Entry Points

**`packages/core/src/index.ts`:**
- Location: `packages/core/src/index.ts`
- Triggers: Library consumers.
- Responsibilities: Exports the `Editor` class and core types.

**`packages/react/src/index.ts`:**
- Location: `packages/react/src/index.ts`
- Triggers: React applications.
- Responsibilities: Exports the `Canvas` component and `useCanvasEditor` hook.

## Error Handling

**Strategy:** Fail-fast for model inconsistencies, graceful degradation for rendering.

**Patterns:**
- **Schema Validation:** ProseMirror ensures the document always matches the schema.
- **Layout Versioning:** `DocumentLayout` includes a `version` to prevent stale renders from overwriting current ones during async operations.

## Cross-Cutting Concerns

**Logging:** Minimal, focused on boot and critical errors.
**Validation:** Handled by `prosemirror-model`.
**Authentication:** Not handled in core; deferred to the application layer.
**Collaboration:** Handled via Y.js integration in `packages/plugins/src/collaboration`.

---

*Architecture analysis: 2025-03-04*
