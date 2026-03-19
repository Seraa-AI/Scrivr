# Extensibility Design

The core insight: **ProseMirror is the source of truth, the canvas is a display surface.**
Extensibility means letting consumers define how new node types are measured and rendered — not what the document *is*.

This doc covers the design decisions for extensibility so we don't paint ourselves into a corner during Phase 1–2. Implementation target: Phase 3.

---

## The Problem with Hardcoded Block Types

Current `BlockLayout.ts` handles `paragraph`, `heading`, and lists. When someone wants to add an `image` node, they'd have to fork the core. That's not acceptable for an open-source project.

The fix: a **BlockRegistry** that maps ProseMirror node type names to **measure + render strategies**.

---

## BlockRegistry Interface

Every block type needs to answer two questions:

1. **How tall am I?** (measured before pages are assigned — the "measure pass")
2. **How do I draw myself?** (called during render — the "render pass")

These are separate because PageLayout does a full measure pass before committing blocks to pages.

```typescript
// packages/core/src/layout/BlockRegistry.ts

import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { CanvasRenderingContext2D } from "./types";

/** Output of the measure pass — everything PageLayout needs to place the block */
export interface BlockMeasurement {
  width: number;
  height: number;
  spaceBefore: number;  // margin above (will be collapsed with prev block)
  spaceAfter: number;   // margin below (will be collapsed with next block)
}

/** Everything the render pass needs to draw the block */
export interface BlockRenderContext {
  ctx: CanvasRenderingContext2D;
  x: number;            // page-local x (already includes left margin)
  y: number;            // page-local y (already includes top margin)
  width: number;
  height: number;
  dpr: number;
  pageConfig: PageConfig;
}

/** Options passed to measure() */
export interface MeasureOptions {
  availableWidth: number;
  measurer: TextMeasurer;
  pageConfig: PageConfig;
}

export interface BlockStrategy {
  /**
   * Measure pass — called for every block before page assignment.
   * Must be synchronous and side-effect free.
   * Do NOT populate CharacterMap here.
   */
  measure(node: ProseMirrorNode, options: MeasureOptions): BlockMeasurement;

  /**
   * Render pass — called during canvas rendering.
   * May populate CharacterMap for hit-testing.
   * Should check renderVersion === currentVersion() before expensive work.
   */
  render(
    node: ProseMirrorNode,
    layout: BlockMeasurement & { x: number; y: number },
    ctx: BlockRenderContext,
    map?: CharacterMap,
  ): void;
}

export class BlockRegistry {
  private strategies = new Map<string, BlockStrategy>();

  register(nodeTypeName: string, strategy: BlockStrategy): this {
    this.strategies.set(nodeTypeName, strategy);
    return this;  // chainable
  }

  get(nodeTypeName: string): BlockStrategy | undefined {
    return this.strategies.get(nodeTypeName);
  }

  has(nodeTypeName: string): boolean {
    return this.strategies.has(nodeTypeName);
  }
}
```

### Usage — built-in text blocks

The existing `layoutBlock` function becomes the default text strategy:

```typescript
const textStrategy: BlockStrategy = {
  measure(node, options) {
    const block = layoutBlock(node, {
      x: options.pageConfig.marginLeft,
      y: 0,  // y is assigned by PageLayout
      availableWidth: options.availableWidth,
      measurer: options.measurer,
      nodePos: 0,  // placeholder; real pos assigned by PageLayout
    });
    return {
      width: block.width,
      height: block.height,
      spaceBefore: block.spaceBefore,
      spaceAfter: block.spaceAfter,
    };
  },

  render(node, layout, ctx, map) {
    // existing renderPage text drawing logic
  },
};

// Registered for all text-based node types
["paragraph", "heading", "bullet_list", "ordered_list"].forEach((type) =>
  defaultRegistry.register(type, textStrategy)
);
```

### Usage — image block (consumer-provided)

```typescript
editor.blockRegistry.register("image", {
  measure(node, { availableWidth }) {
    const aspectRatio = node.attrs.height / node.attrs.width;
    const width = Math.min(node.attrs.width, availableWidth);
    return {
      width,
      height: width * aspectRatio,
      spaceBefore: 12,
      spaceAfter: 12,
    };
  },

  render(node, layout, { ctx, dpr }) {
    const img = imageCache.get(node.attrs.src);
    if (!img) {
      // Draw placeholder box
      ctx.strokeStyle = "#ccc";
      ctx.strokeRect(layout.x, layout.y, layout.width, layout.height);
      return;
    }
    ctx.drawImage(img, layout.x, layout.y, layout.width, layout.height);
  },
});
```

---

## Lifecycle Hook System

These hooks let consumers extend behaviour without touching core code.

```typescript
interface EditorHooks {
  /**
   * Called after every layout pass with the complete DocumentLayout.
   * Use for: word count, table of contents generation, analytics.
   * Must be synchronous and non-mutating.
   */
  onLayout?: (layout: DocumentLayout) => void;

  /**
   * Called at the start of each page render, before any blocks are drawn.
   * Use for: watermarks, page backgrounds, custom page borders.
   * ctx transform is already scaled for DPR.
   */
  onBeforeRenderPage?: (ctx: CanvasRenderingContext2D, page: LayoutPage, pageConfig: PageConfig) => void;

  /**
   * Called after all blocks on a page are drawn.
   * Use for: page numbers, footers, margin annotations, comment indicators.
   */
  onAfterRenderPage?: (ctx: CanvasRenderingContext2D, page: LayoutPage, pageConfig: PageConfig) => void;

  /**
   * Called when the user pastes content, before it hits the document.
   * Return a modified Slice to filter/transform pasted content.
   * Use for: stripping unwanted marks, normalizing fonts, injecting metadata.
   */
  transformPaste?: (slice: Slice) => Slice;
}
```

### Concrete examples for legal SaaS

```typescript
const editor = new Editor({
  hooks: {
    // Word count in sidebar
    onLayout(layout) {
      const wordCount = countWords(layout);
      updateWordCountDisplay(wordCount);
    },

    // Watermark on every page
    onBeforeRenderPage(ctx, page, config) {
      ctx.save();
      ctx.globalAlpha = 0.06;
      ctx.font = "bold 72px Georgia";
      ctx.fillStyle = "#000";
      ctx.translate(config.pageWidth / 2, config.pageHeight / 2);
      ctx.rotate(-Math.PI / 4);
      ctx.textAlign = "center";
      ctx.fillText("DRAFT", 0, 0);
      ctx.restore();
    },

    // Page numbers in footer
    onAfterRenderPage(ctx, page, config) {
      ctx.font = "11px Georgia";
      ctx.fillStyle = "#666";
      ctx.textAlign = "center";
      ctx.fillText(
        String(page.pageNumber),
        config.pageWidth / 2,
        config.pageHeight - config.marginBottom / 2,
      );
    },

    // Strip formatting on paste (legal docs need clean text)
    transformPaste(slice) {
      return stripMarks(slice, ["color", "font_family", "font_size"]);
    },
  },
});
```

---

## Theme Engine

We already have `FontConfig` (typography constants) and `StyleResolver` (marks → font string). The theme concept extends this to cover colors, spacing, and non-text rendering.

```typescript
interface Theme {
  /** Map mark type name → canvas fill style */
  markColors?: Partial<Record<string, string>>;

  /** Override default typography per block type */
  blockStyles?: Partial<Record<string, Partial<BlockStyle>>>;

  /** Page appearance */
  page?: {
    background?: string;   // default "#fff"
    shadow?: string;       // default "0 4px 32px rgba(0,0,0,0.12)"
  };

  /** Selection highlight color */
  selectionColor?: string;  // default "rgba(0, 120, 215, 0.25)"

  /** Cursor color */
  cursorColor?: string;     // default "#000"
}

// Usage
const editor = new Editor({
  theme: {
    selectionColor: "rgba(0, 100, 255, 0.3)",
    cursorColor: "#1a1a1a",
    blockStyles: {
      heading: { fontSize: 24, fontFamily: "Arial" },
    },
    markColors: {
      link: "#0066cc",
    },
  },
});
```

**Important:** `FontConfig` is already the "theme engine for typography." The `Theme` interface above is additive — it doesn't replace `FontConfig`, it extends it. Keep them separate: `FontConfig` = type metrics for layout, `Theme` = visual presentation for rendering.

---

## What the Core Must NOT Bake In

These must come via `BlockRegistry` or `hooks`, never hardcoded in core:

| Feature | Mechanism |
|---|---|
| Images | `blockRegistry.register("image", ...)` |
| Code blocks (monospace, syntax highlight) | `blockRegistry.register("code_block", ...)` |
| Horizontal rules | `blockRegistry.register("horizontal_rule", ...)` |
| Page numbers | `hooks.onAfterRenderPage` |
| Watermarks | `hooks.onBeforeRenderPage` |
| Word count | `hooks.onLayout` |
| Paste filtering | `hooks.transformPaste` |
| Custom selection color | `theme.selectionColor` |

**Paragraph, heading, lists, tables** belong in core because the layout engine (PageLayout, LineBreaker) needs to understand them for correct text flow, page breaks, and margin collapsing.

---

## Implementation Order

These are Phase 3 tasks, but **the interface must be stable before Phase 2** so we don't break consumers when we add them.

**Phase 2 (now):** Implement `transformPaste` hook — it's needed for paste handling.

**Phase 3 (next):**
1. `BlockRegistry` with text strategy as default
2. `onBeforeRenderPage` / `onAfterRenderPage` hooks — needed for page numbers
3. `Theme` object wired into renderer
4. Example: `image` block strategy as a reference implementation

---

## What's Already There (Don't Rebuild)

| This design calls for | What already exists |
|---|---|
| Mark → font string | `StyleResolver.resolveFont()` |
| Block type → typography | `FontConfig` + `getBlockStyle()` |
| Glyph hit testing | `CharacterMap` |
| Per-page render lifecycle | `renderPage()` in `PageRenderer.ts` |
| Text measurement | `TextMeasurer` |

The BlockRegistry and hook system are **additions**, not replacements.
