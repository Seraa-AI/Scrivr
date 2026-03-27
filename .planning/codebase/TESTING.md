# Testing Patterns

**Analysis Date:** 2024-03-27

## Test Framework

**Runner:**
- Vitest (^2.0.0)
- Config: `packages/core/vitest.config.ts`, `packages/plugins/vitest.config.ts`

**Assertion Library:**
- Built-in Vitest (similar to Jest)

**Run Commands:**
```bash
turbo test             # Run all tests via Turborepo
pnpm test:watch        # Run tests in watch mode
pnpm coverage          # Generate coverage reports
```

## Test File Organization

**Location:**
- Co-located with source files: `src/*.test.ts`, `src/layout/*.test.ts`.

**Naming:**
- `*.test.ts` or `*.test.tsx`.

**Structure:**
```
packages/core/src/
├── Editor.ts
├── Editor.test.ts
├── layout/
│   ├── BlockLayout.ts
│   └── BlockLayout.test.ts
└── test-utils.ts
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";

describe("Component or Function Name", () => {
  beforeEach(() => {
    // Shared setup
  });

  it("should do something specific", () => {
    // Arrange, Act, Assert
  });
});
```

**Patterns:**
- **Arrange:** Setup data and mocks using `test-utils.ts`.
- **Act:** Perform the operation being tested.
- **Assert:** Verify outcomes using `expect()`.

## Mocking

**Framework:** Vitest (`vi`)

**Patterns:**
- **Canvas Mocking:** Essential for layout and rendering tests since Inscribe is canvas-based.
```typescript
vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
  measureText: vi.fn((text: string) => ({
    width: text.length * 8,
    actualBoundingBoxAscent: 12,
    actualBoundingBoxDescent: 3,
    fontBoundingBoxAscent: 12,
    fontBoundingBoxDescent: 3,
  })),
  font: "",
} as unknown as CanvasRenderingContext2D);
```

**What to Mock:**
- Browser APIs like `HTMLCanvasElement.getContext` and `window.matchMedia`.
- Time-consuming or external side effects (spies on event handlers).

**What NOT to Mock:**
- Internal logic (layout engine, state manager) should be tested as unit or integration tests without mocks where possible.

## Fixtures and Factories

**Test Data:**
- ProseMirror node builders are centralized in `packages/core/src/test-utils.ts`.
```typescript
export function paragraph(text = ""): Node {
  return text
    ? schema.node("paragraph", null, [schema.text(text)])
    : schema.node("paragraph", null, []);
}

export function doc(...blocks: Node[]): Node {
  return schema.node("doc", null, blocks);
}
```

**Location:**
- Shared utilities in `packages/core/src/test-utils.ts`.

## Coverage

**Requirements:**
- No strict requirements found in the codebase.
- Reports generated using `vitest --coverage`.

**View Coverage:**
```bash
pnpm coverage
```

## Test Types

**Unit Tests:**
- Core logic: `BlockLayout.test.ts`, `CharacterMap.test.ts`, `LineBreaker.test.ts`.
- Pure functions and small classes.

**Integration Tests:**
- Editor lifecycle: `Editor.test.ts` mounts the editor in a container and simulates input.

**E2E Tests:**
- Not explicitly detected in the root project (may be in `apps/demo` if added later).

## Common Patterns

**Async Testing:**
- Use `await` with async operations or `vi.useFakeTimers()` for time-based logic.

**Error Testing:**
- Use `expect(() => ...).toThrow()` for synchronous errors.

---

*Testing analysis: 2024-03-27*
