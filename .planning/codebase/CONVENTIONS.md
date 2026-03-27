# Coding Conventions

**Analysis Date:** 2024-03-27

## Naming Patterns

**Files:**
- PascalCase for Classes and React components: `packages/core/src/Editor.ts`, `packages/react/src/Canvas.tsx`.
- camelCase for hooks, utilities, and general modules: `packages/react/src/useCanvasEditor.ts`, `packages/core/src/layout/BlockLayout.ts`.
- `.test.ts` / `.test.tsx` suffix for tests: `packages/core/src/Editor.test.ts`.

**Functions:**
- camelCase: `keyEventToString`, `resolveLeafBlockDimensions`.
- Hooks use the `use` prefix: `useCanvasEditor`.

**Variables:**
- camelCase: `latestState`, `optionsRef`.
- SCREAMING_SNAKE_CASE for constants: `MOCK_CHAR_WIDTH` (in tests).

**Types/Interfaces:**
- PascalCase: `EditorOptions`, `UseCanvasEditorOptions`.
- No `I` prefix for interfaces.

## Code Style

**Formatting:**
- Indentation: 2 spaces.
- Semicolons: Yes.
- Quotes: Double quotes for strings and imports.
- Trailing Commas: Used in multi-line objects and arrays.

**Linting:**
- Not explicitly configured via `.eslintrc` or `.prettierrc` in the repository.
- Relying on TypeScript compiler for type safety.

## Import Organization

**Order:**
1. React / Framework imports: `import { useState, useEffect } from "react";`.
2. External library imports: `import { EditorState } from "prosemirror-state";`.
3. Internal package imports: `import { Editor } from "@inscribe/core";`.
4. Relative imports (same package): `import { ExtensionManager } from "./extensions/ExtensionManager";`.

**Path Aliases:**
- Monorepo package names are used for cross-package imports: `@inscribe/core`, `@inscribe/plugins`.

## Error Handling

**Patterns:**
- Graceful fallbacks for missing values: `return m ? parseFloat(m[1]!) : null;`.
- Use of TypeScript non-null assertion `!` for values known to exist (e.g., after a regex match).

## Logging

**Framework:** `console`

**Patterns:**
- No extensive logging observed in core logic.
- Debug logging used sparingly during development.

## Comments

**When to Comment:**
- Public APIs (Classes, Hooks, Interfaces).
- Complex logic (Layout algorithms, Event handling).
- Code blocks within functions to explain steps.

**JSDoc/TSDoc:**
- Widely used for documenting exports:
```typescript
/**
 * useCanvasEditor — create and manage an Editor instance.
 * @param options  Editor configuration + event callbacks
 * @param deps     Re-create the editor when these values change (default: never)
 */
```

## Function Design

**Size:** Functions are kept small and focused on a single responsibility.

**Parameters:** Prefer object parameters (options) for complex functions to maintain readability.

**Return Values:** Explicit return types are preferred for public APIs.

## Module Design

**Exports:**
- Named exports are preferred over default exports.
- Barrel files (`index.ts`) are used at package and directory levels for clean public APIs: `packages/core/src/index.ts`.

---

*Convention analysis: 2024-03-27*
