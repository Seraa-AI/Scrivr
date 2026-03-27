# Codebase Concerns

**Analysis Date:** 2024-05-22

## Tech Debt

**Editor "God Object":**
- Issue: `Editor.ts` handles state, layout, input bridge, command building, and extension lifecycle. It's a massive class with too many responsibilities.
- Files: `packages/core/src/Editor.ts`
- Impact: Hard to maintain, difficult to test in isolation, and high risk of regressions when making changes.
- Fix approach: Refactor `Editor.ts` by delegating more responsibilities to smaller, specialized classes or hooks.

**Manual Layout Engine:**
- Issue: The project implements its own layout engine for canvas rendering, including manual line breaking, font measurement, and text alignment.
- Files: `packages/core/src/layout/BlockLayout.ts`, `packages/core/src/layout/PageLayout.ts`, `packages/core/src/layout/LineBreaker.ts`, `packages/core/src/layout/TextMeasurer.ts`
- Impact: Inherently complex and fragile. Handling edge cases like nested lists, images, and complex pagination is difficult and prone to bugs.
- Fix approach: Continue to modularize the layout engine and add extensive unit tests for edge cases.

**Legacy Markdown Parser:**
- Issue: `PasteTransformer` contains a "legacy line-by-line parser" and a regex-based inline mark parser.
- Files: `packages/core/src/input/PasteTransformer.ts`
- Impact: Fragile and incomplete compared to standard Markdown parsers. May lead to inconsistent formatting when pasting Markdown.
- Fix approach: Fully transition to `prosemirror-markdown` and `markdown-it` for all Markdown parsing, removing the custom regex-based logic.

## Performance Bottlenecks

**Synchronous Layout on Every Change:**
- Issue: `Editor.ts` recomputes the entire document layout synchronously on every state change (via `ensureLayout`).
- Files: `packages/core/src/Editor.ts`, `packages/core/src/layout/PageLayout.ts`
- Impact: For very large documents, this could lead to frame drops and a sluggish editing experience.
- Fix approach: Implement incremental layout or move layout computation to a Web Worker.

**CharacterMap Memory Usage:**
- Issue: `CharacterMap` stores coordinates and metadata for every single glyph in the document.
- Files: `packages/core/src/layout/CharacterMap.ts`
- Impact: Large documents could consume significant memory, potentially leading to performance issues or crashes on memory-constrained devices.
- Fix approach: Optimize the data structure of `CharacterMap` or implement a more memory-efficient way to store glyph metadata.

## Fragile Areas

**Virtual Scrolling and Canvas Management:**
- Issue: `ViewManager` manages the lifecycle of multiple canvases and their attachment/detachment from the DOM based on visibility.
- Files: `packages/core/src/renderer/ViewManager.ts`
- Impact: Complex interactions with `IntersectionObserver` and DOM manipulation can lead to flickering, stale frames, or race conditions.
- Fix approach: Simplify the canvas management logic and ensure robust state synchronization between the Editor and the ViewManager.

**Hidden Textarea Input Bridge:**
- Issue: Input and IME are captured via a hidden textarea positioned at the cursor location.
- Files: `packages/core/src/Editor.ts`
- Impact: This is a common but fragile pattern. Misalignment between the textarea and the visual cursor can lead to broken IME behavior or incorrect browser scrolling.
- Fix approach: Ensure perfect synchronization of the textarea position and consider alternatives if browser-native editing features can be leveraged.

## Test Coverage Gaps

**Renderer and Extension Tests:**
- What's not tested: Most of the rendering logic (`PageRenderer.ts`, `OverlayRenderer.ts`, `ViewManager.ts`) and many built-in extensions (`Bold.ts`, `Heading.ts`, `List.ts`, etc.) lack unit tests.
- Files: `packages/core/src/renderer/`, `packages/core/src/extensions/built-in/`
- Risk: Changes to these core areas could introduce regressions that go unnoticed until they reach users.
- Priority: High

---

*Concerns audit: 2024-05-22*
