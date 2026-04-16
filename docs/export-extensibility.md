# Export Extensibility

Status: **design** — the extension seam that lets plugins (first-party or user-defined) contribute export handlers without editing core export code.

**Companion docs**:
- `docs/multi-surface-architecture.md` — the broader architectural frame. Export contributions are the format-land counterpart to `addPageChrome` (canvas-land).
- `docs/header-footer-plan.md` — the first concrete consumer. The header-footer PDF export flow in that plan's §10 is replaced by the `addExports` mechanism specified here.
- Memory `feedback_pdf_parity.md` — the rule this design operationalizes: every new canvas node/mark must ship with a corresponding export handler. The rule is unchanged; the mechanism moves from "edit a monolithic export package" to "plugin self-contains its export logic."

---

## 1. Why export extensibility

Scrivr's current export story:

- `packages/export/src/pdf/` — PDF via `pdf-lib`, walks `LayoutPages` directly, uses hardcoded switch statements per node type.
- Markdown via `prosemirror-markdown` (existing).
- First-party-only. **No extension seam.**

Every new feature that ships (headers, footers, footnotes, comments, track-changes marks, AI suggestions) requires editing the export package manually, and `feedback_pdf_parity.md` enforces this in code review. This works for first-party features. For **user-defined extensions** it's a wall: a user who builds a `CalloutBox`, `MathBlock`, or `MusicScore` node has no path to make it export without forking `@scrivr/export`.

If Scrivr is a framework — and the multi-surface architecture is committing to it being one — users will build their own extensions, and those extensions need the same export seam the first-party plugins use. That seam is the `addExports()` lane specified here.

---

## 2. Locked-in decisions

| Decision | Choice | Rationale |
|---|---|---|
| **Package structure** | Split `@scrivr/export` into per-format packages: `@scrivr/export-pdf`, `@scrivr/export-markdown`, future `@scrivr/export-docx` | Each format has heavy, distinct dependencies (`pdf-lib`, `prosemirror-markdown`, future `docx`). Users install only what they need. Release cadences can differ per format. |
| **Format tagging** | Single `addExports()` lane on `Extension`, returning format-tagged entries | Adding a new format should not require editing the `Extension` base class or touching core. Module augmentation on `FormatHandlers` keeps types safe. |
| **Handler signatures** | Format-specific, defined by format packages | Fundamentally different: PDF works on `LayoutBlock` + drawing primitives, Markdown walks PM tree + emits strings, docx walks PM tree + emits XML builders. Forcing a unified signature would be an over-abstraction. |
| **Type safety** | Module augmentation on `FormatHandlers` interface, same pattern as the existing `Commands` lane | Core stays format-agnostic; format packages each contribute a typed slot. `ExportContribution` becomes a discriminated union keyed by format string. |
| **Default handlers location** | Format packages ship defaults for the **core schema** (paragraph, heading, bold, italic, list, etc.). User/plugin extensions ship handlers for their **own custom** nodes. | Core extensions stay export-agnostic — they don't import `pdf-lib` or `docx` types. Format packages already know the core schema and can provide sensible defaults. |
| **Chrome contributions** | Separate hooks: `addPageChrome` for canvas paint, `addExports` for format output. Chrome is a named slot within format handlers. | Canvas and format concerns have different context types, lifecycles, and entry points. Unifying them would require a lowest-common-denominator abstraction that fits neither. |
| **Docx scope** | Not in this design, its own PR later | docx is legitimately complex (OOXML schema, field codes, style definitions). Don't scope creep. |
| **API style** | Standalone functions: `exportPdf(editor, options)`, `exportMarkdown(editor, options)` | No runtime registration, no side-effecty imports, explicit and discoverable. `editor.export.pdf()` style wrapper can be added later as a convenience. |

---

## 3. Package layout

```
packages/
  core/
    src/extensions/export.ts         # addExports() lane, FormatHandlers interface, ExportContribution type
  export-pdf/                         # NEW — split from current packages/export
    package.json                      # deps: pdf-lib, @scrivr/core
    src/
      index.ts                        # public API: exportPdf, types re-export
      context.ts                      # PdfContext, PdfDrawHelpers, PdfFontRegistry
      handlers.ts                     # PdfHandlers, PdfNodeHandler, PdfMarkHandler, PdfChromeHandler
      augmentation.ts                 # declare module "@scrivr/core" { interface FormatHandlers { pdf: PdfHandlers } }
      defaults.ts                     # Default handlers for core schema (paragraph, heading, bold, …)
      export.ts                       # The exportPdf() entry point: collects handlers, walks pages, dispatches
      fonts.ts                        # Font loading and embedding (moved from current exporter)
  export-markdown/                    # NEW — split from current packages/export
    package.json                      # deps: prosemirror-markdown, @scrivr/core
    src/
      index.ts
      handlers.ts                     # MarkdownHandlers — different shape from PDF (visitor pattern)
      augmentation.ts                 # declare module "@scrivr/core" { interface FormatHandlers { markdown: MarkdownHandlers } }
      defaults.ts
      export.ts
  export/                             # DEPRECATED — existing package, to be removed after migration
```

The current `@scrivr/export` package stops being the home for new code. Existing PDF code moves into `@scrivr/export-pdf`; existing markdown code moves into `@scrivr/export-markdown`. The old package can ship one more minor release as a compat shim that re-exports from the new packages, then get removed.

---

## 4. Core primitive: the `addExports()` lane

Lives in `packages/core/src/extensions/export.ts`. This is the entire core-side surface.

```ts
// packages/core/src/extensions/export.ts

/**
 * Declared empty in core. Format packages augment this via module
 * augmentation:
 *
 *   declare module "@scrivr/core" {
 *     interface FormatHandlers {
 *       pdf: PdfHandlers;
 *     }
 *   }
 *
 * Core never inspects the handler types — it only carries opaque tagged
 * contributions from extensions to format packages that know how to
 * interpret them.
 */
export interface FormatHandlers {}

/**
 * A single extension's contribution to one export format.
 * This is a discriminated union: `format` narrows `handlers` to the
 * format-specific type declared via module augmentation.
 */
export type ExportContribution = {
  [F in keyof FormatHandlers]: {
    format: F;
    handlers: FormatHandlers[F];
  };
}[keyof FormatHandlers];
```

On `Extension`:

```ts
// packages/core/src/extensions/Extension.ts

export interface ExtensionConfig {
  name: string;
  addNodes?(): Record<string, NodeSpec>;
  addMarks?(): Record<string, MarkSpec>;
  addCommands?(): ...;
  addKeymaps?(): ...;
  addDocAttrs?(): Record<string, AttributeSpec>;
  addPageChrome?(): PageChromeContribution;
  addSurfaceOwner?(): SurfaceOwnerRegistration;
  // NEW:
  addExports?(): ExportContribution[];
}
```

That's it for core. No aggregator, no dispatcher, no format knowledge. Format packages do all the work when their entry point is called.

**If no format package is installed**, `keyof FormatHandlers` is `never`, `ExportContribution` collapses to `never`, and `addExports()` returns `never[]`. Extensions that declare `addExports()` without any format package get a compile error. Correct behavior — you can't contribute handlers for formats you haven't imported.

---

## 5. PDF format package — worked example

### 5.1 Handler types

```ts
// packages/export-pdf/src/handlers.ts

import type { Node, Mark, LayoutBlock, LayoutPage, LayoutLine, LayoutSpan } from "@scrivr/core";
import type { PDFDocument, PDFPage, PDFFont } from "pdf-lib";

/**
 * Drawing context passed to every handler. Handlers mutate the current page
 * via `ctx.page` (pdf-lib API) and read layout info via ctx.{x,y,width}.
 */
export interface PdfContext {
  doc: PDFDocument;
  page: PDFPage;
  /** The LayoutPage being rendered. Handlers can read its chrome metrics. */
  layoutPage: LayoutPage;
  /**
   * The full DocumentLayout being exported. Most handlers only need layoutPage,
   * but some need global access:
   *   - totalPages calculation for page-number tokens
   *   - cross-page references (e.g. "see page 4")
   *   - chrome handlers that need fragments from other pages for lookahead
   *   - convergence state inspection (layout.convergence, layout.runId)
   */
  layout: DocumentLayout;
  /** Top-left of the current block in page coordinates (y is top-down, matching layout). */
  x: number;
  y: number;
  width: number;
  /** Font registry — lookup by (family, weight, style). */
  fonts: PdfFontRegistry;
  /**
   * Preloaded image registry keyed by source URL. Populated by loadImages()
   * in Phase 3 (walks the doc, embeds all images ahead of the sync hot loop).
   * Plugins can push custom entries in their onBeforeExport hook for
   * dynamically generated images (charts, server-rendered diagrams, etc.).
   */
  images: Map<string, PDFImage>;
  /**
   * Drawing primitives helper. All methods take TOP-DOWN layout coordinates
   * and handle the Y-axis flip to pdf-lib's bottom-up system internally.
   * Handlers never touch raw pdf-lib drawing methods directly.
   */
  draw: PdfDrawHelpers;
  /** The editor being exported, for handlers that need to read doc.attrs or query extensions. */
  editor: Editor;
}

export interface PdfHandlers {
  /**
   * Per-block drawing. One handler per `node.type.name`.
   *
   * IMPORTANT: the same map also serves as the inline atom dispatch table.
   * When the default paragraph line drawer encounters an inline atom span
   * (`image`, `pageNumber`, `totalPages`, `date`, etc.), it looks up the
   * handler here. See §5.5 for why this is a single table, not two.
   */
  nodes?: Record<string, PdfNodeHandler>;

  /**
   * Per-mark inline styling. Returns style modifiers applied during line
   * span iteration. The default span drawer reads these to pick fonts,
   * colors, and decorations.
   */
  marks?: Record<string, PdfMarkHandler>;

  /**
   * Per-page chrome (headers, footers, footnote bands). One handler per
   * chrome owner name, matching the plugin's addPageChrome contribution name.
   *
   * The handler receives its own contributor payload as a typed second
   * argument — the exporter does the lookup from layout._chromePayloads
   * centrally so handlers don't reach into core internals.
   */
  chrome?: Record<string, PdfChromeHandler<any>>;

  /**
   * Runs once at the start of the export, after the PdfContext is built
   * and the layout has converged. Intended for any document-level work
   * that needs to happen before page iteration:
   *
   *   - Footnote numbering (walk doc for refs, assign sequential numbers)
   *   - Table of contents collection (walk doc for headings, populate outline)
   *   - Citation resolution (walk doc for cite marks, resolve references)
   *   - Cross-reference resolution ("see page X" needs X to be known)
   *   - Custom font registration (plugin-specific fonts not in the default set)
   *   - Custom image pushing to ctx.images (server-rendered charts, diagrams)
   *
   * Async: yes. Runs sequentially across contributors in registration order.
   */
  onBeforeExport?(ctx: PdfContext): void | Promise<void>;

  /**
   * Runs once after all pages are drawn, before the doc is saved.
   * Typical use: emit metadata, outline entries, bookmarks.
   */
  onAfterExport?(ctx: PdfContext): void | Promise<void>;
}

export type PdfNodeHandler = (block: LayoutBlock, ctx: PdfContext) => void;

export type PdfMarkHandler = (
  mark: Mark,
  ctx: PdfContext,
) => PdfSpanStyle;

/**
 * Chrome handlers receive their contributor's opaque payload as a typed
 * second argument. The exporter retrieves the payload from
 * `layout._chromePayloads[contributorName]` and passes it in; handlers
 * don't know about core's internal payload storage.
 *
 * Generic parameter P is the plugin-specific payload type
 * (e.g., FootnoteIterationPayload, HeaderFooterPayload). Plugins constrain
 * it at the call site via `satisfies PdfChromeHandler<MyPayload>`.
 */
export type PdfChromeHandler<P = unknown> = (
  layoutPage: LayoutPage,
  payload: P,
  ctx: PdfContext,
) => void;

export interface PdfSpanStyle {
  font?: PDFFont;
  color?: { r: number; g: number; b: number };
  underline?: boolean;
  strikethrough?: boolean;
  backgroundColor?: { r: number; g: number; b: number };
}
```

### 5.2 Module augmentation

```ts
// packages/export-pdf/src/augmentation.ts

import type { PdfHandlers } from "./handlers";

declare module "@scrivr/core" {
  interface FormatHandlers {
    pdf: PdfHandlers;
  }
}

export {};
```

The augmentation file is imported for its side effect at package load. Users who want type-safe PDF contributions import from `@scrivr/export-pdf`:

```ts
import type { PdfHandlers } from "@scrivr/export-pdf";
```

### 5.3 Default handlers

```ts
// packages/export-pdf/src/defaults.ts

export const defaultPdfNodeHandlers: PdfHandlers["nodes"] = {
  paragraph: (block, ctx) => {
    ctx.draw.lines(block.lines, {
      x: ctx.x,
      y: ctx.y,
      width: ctx.width,
    });
  },

  heading: (block, ctx) => {
    // Same as paragraph — block.lines already have the correct font size
    // from the layout pass. No special case needed.
    ctx.draw.lines(block.lines, {
      x: ctx.x,
      y: ctx.y,
      width: ctx.width,
    });
  },

  bullet_list: (block, ctx) => { /* draw marker + content */ },
  ordered_list: (block, ctx) => { /* draw number + content */ },
  list_item: (block, ctx) => { /* ... */ },
  blockquote: (block, ctx) => { /* left bar + indent */ },
  code_block: (block, ctx) => { /* monospace font + background */ },

  /**
   * Handles BOTH block-level and inline images. When called from the top-level
   * Phase 5a loop, `block` is a real LayoutBlock. When called from the inline
   * atom dispatch rule (§5.5), `block` is a synthetic block scoped to the
   * span's rect. Either way: look up the preloaded PDFImage and draw it.
   */
  image: (block, ctx) => {
    const src = block.node.attrs.src as string;
    const pdfImage = ctx.images.get(src);
    if (!pdfImage) {
      console.warn(`[export-pdf] image not preloaded: ${src}`);
      return;
    }
    ctx.draw.image(pdfImage, {
      x: ctx.x,
      y: ctx.y,
      width: ctx.width,
      height: block.height,
    });
  },

  // hardBreak, table, tableRow, tableCell when they exist
};

export const defaultPdfMarkHandlers: PdfHandlers["marks"] = {
  bold: (mark, ctx) => ({ font: ctx.fonts.get({ weight: "bold" }) }),
  italic: (mark, ctx) => ({ font: ctx.fonts.get({ style: "italic" }) }),
  underline: () => ({ underline: true }),
  strikethrough: () => ({ strikethrough: true }),
  color: (mark) => ({ color: hexToRgb(mark.attrs.color) }),
  highlight: (mark) => ({ backgroundColor: hexToRgb(mark.attrs.color) }),
  // fontSize is already baked into block.lines via the layout pass
  // fontFamily is looked up via ctx.fonts during span iteration
  link: () => ({ color: { r: 0, g: 0, b: 1 }, underline: true }),
};

export const defaultPdfChromeHandlers: PdfHandlers["chrome"] = {
  // Empty. Chrome handlers are contributed by plugins (HeaderFooter, Footnotes),
  // not by defaults.
};
```

The key property: **defaults cover the core schema exhaustively**. Every built-in node and mark has a default PDF handler. User or plugin contributions only need to handle their own custom types.

### 5.4 The `exportPdf` entry point

```ts
// packages/export-pdf/src/export.ts

import type { Editor } from "@scrivr/core";
import { PDFDocument } from "pdf-lib";
import { defaultPdfNodeHandlers, defaultPdfMarkHandlers, defaultPdfChromeHandlers } from "./defaults";
import { buildPdfContext } from "./context";
import "./augmentation"; // side-effect: registers module augmentation

export interface PdfExportOptions {
  /** Ad-hoc handler overrides for this specific export call. Wins over extensions. */
  overrides?: PdfHandlers;
  /** Page range to export. Default: all pages. */
  pageRange?: { start: number; end: number };
  /** Font config override (default: editor's fontConfig). */
  fontConfig?: FontConfig;
  /**
   * Strict mode: throws on conditions that would produce a silently-degraded
   * export. Default false (warnings only).
   *
   * Strict mode errors:
   *   - Missing handler for a node/mark type encountered in the doc
   *   - Layout convergence is "exhausted" (iteration loop hit MAX_ITERATIONS
   *     without stabilizing — usually footnote oscillation). The exhausted
   *     layout is still visually correct but non-optimal, and a strict
   *     pipeline may want to fail rather than ship it.
   *   - Two extensions contributed the same node/mark/chrome handler key
   *     (collision; last-wins is often unintentional)
   */
  strict?: boolean;
  // ... other options: compression, metadata, bookmarks
}

export async function exportPdf(
  editor: Editor,
  options: PdfExportOptions = {},
): Promise<Uint8Array> {
  // ── Phase 1: Collect handlers with precedence ──────────────────────────
  // Merge order: defaults → extension contributions → user overrides.
  // Later sources fully replace earlier ones per key (shallow merge).
  // Collisions between extensions warn (not error) — last-wins is sometimes
  // intentional, but surfacing it helps catch mistakes. Strict mode throws.
  const nodeHandlers: Record<string, PdfNodeHandler> = { ...defaultPdfNodeHandlers };
  const markHandlers: Record<string, PdfMarkHandler> = { ...defaultPdfMarkHandlers };
  const chromeHandlers: Record<string, PdfChromeHandler<unknown>> = { ...defaultPdfChromeHandlers };
  const owners: { nodes: Record<string, string>; marks: Record<string, string>; chrome: Record<string, string> } = {
    nodes: {}, marks: {}, chrome: {},
  };
  const collisions: string[] = [];
  const lifecycleHooks: { before: Array<(ctx: PdfContext) => void | Promise<void>>; after: Array<(ctx: PdfContext) => void | Promise<void>> } = {
    before: [], after: [],
  };

  const mergeWithCollisionDetection = (
    target: Record<string, unknown>,
    source: Record<string, unknown> | undefined,
    owner: string,
    kind: "nodes" | "marks" | "chrome",
  ) => {
    if (!source) return;
    for (const [key, value] of Object.entries(source)) {
      const prev = owners[kind][key];
      if (prev && prev !== "__default__") {
        collisions.push(`${kind}.${key}: "${prev}" → "${owner}"`);
      }
      target[key] = value;
      owners[kind][key] = owner;
    }
  };
  // Seed owners map with "__default__" so defaults don't trigger collision warnings.
  for (const k of Object.keys(nodeHandlers)) owners.nodes[k] = "__default__";
  for (const k of Object.keys(markHandlers)) owners.marks[k] = "__default__";
  for (const k of Object.keys(chromeHandlers)) owners.chrome[k] = "__default__";

  for (const ext of editor.manager.extensions) {
    const contribs = ext.addExports?.() ?? [];
    for (const contrib of contribs) {
      if (contrib.format !== "pdf") continue;
      const h = contrib.handlers;
      mergeWithCollisionDetection(nodeHandlers, h.nodes, ext.name, "nodes");
      mergeWithCollisionDetection(markHandlers, h.marks, ext.name, "marks");
      mergeWithCollisionDetection(chromeHandlers, h.chrome, ext.name, "chrome");
      if (h.onBeforeExport) lifecycleHooks.before.push(h.onBeforeExport);
      if (h.onAfterExport) lifecycleHooks.after.push(h.onAfterExport);
    }
  }

  // User overrides are always allowed to replace without warning —
  // that's the whole point of options.overrides.
  if (options.overrides) {
    if (options.overrides.nodes) Object.assign(nodeHandlers, options.overrides.nodes);
    if (options.overrides.marks) Object.assign(markHandlers, options.overrides.marks);
    if (options.overrides.chrome) Object.assign(chromeHandlers, options.overrides.chrome);
    if (options.overrides.onBeforeExport) lifecycleHooks.before.push(options.overrides.onBeforeExport);
    if (options.overrides.onAfterExport) lifecycleHooks.after.push(options.overrides.onAfterExport);
  }

  // Report collisions
  if (collisions.length > 0) {
    const msg = `[export-pdf] extension-level handler collisions (last-registered wins):\n  ${collisions.join("\n  ")}`;
    if (options.strict) throw new Error(msg);
    else console.warn(msg);
  }

  // ── Phase 2: Ensure layout is complete + converged ─────────────────────
  // `force: true` means three things at once:
  //   1. Synchronous — block the main thread until done
  //   2. Complete — no isPartial:true (streaming chunks are flushed)
  //   3. Converged — iterative chrome loop runs until `stable: true` for
  //      all contributors, or exhausts MAX_ITERATIONS gracefully
  //
  // This call can block for a few ms per iteration on footnote-heavy docs.
  // Acceptable because export is already a blocking user action, but
  // consumer apps should show a loading state if they expect large docs.
  const layout = editor.ensureLayout({ force: true });

  // Strict mode: refuse to export a layout that didn't converge.
  // Non-strict: silently accept the exhausted layout — it's still visually
  // correct, just non-optimal (some footnote oscillation artifacts possible).
  if (layout.convergence === "exhausted") {
    const msg = `[export-pdf] layout convergence exhausted after ${layout.iterationCount} iterations. Non-optimal placement may be present (usually footnote oscillation).`;
    if (options.strict) throw new Error(msg);
    else console.warn(msg);
  }

  // ── Phase 3: Build PDF doc and context ─────────────────────────────────
  const pdfDoc = await PDFDocument.create();
  const fonts = await loadFonts(editor, pdfDoc, options.fontConfig);
  const images = await loadImages(editor, pdfDoc);  // preload all inline/block images
  const draw = createPdfDrawHelpers(markHandlers, fonts, images);

  // Note: ctx.page is re-bound per page during Phase 5. The context here
  // is a partially-constructed shell; pre-export hooks get a ctx without
  // a specific page.
  const ctx: PdfContext = buildPdfContext({ doc: pdfDoc, layout, fonts, images, draw, editor });

  // ── Phase 4: Pre-export hooks ──────────────────────────────────────────
  for (const hook of lifecycleHooks.before) {
    await hook(ctx);
  }

  // ── Phase 5: Walk pages, dispatch handlers ─────────────────────────────
  const pages = pageRangeSlice(layout.pages, options.pageRange);
  for (const layoutPage of pages) {
    const pdfPage = pdfDoc.addPage([layout.pageConfig.pageWidth, layout.pageConfig.pageHeight]);
    ctx.page = pdfPage;
    ctx.layoutPage = layoutPage;

    // 5a. Body blocks — top-level dispatch by node type
    //     (inline atom nodes like pageNumber/totalPages/date/image are
    //      dispatched from WITHIN the default paragraph line drawer via
    //      the same nodeHandlers map — see §5.5 for the dispatch rule)
    for (const block of layoutPage.blocks) {
      const handler = nodeHandlers[block.node.type.name];
      if (!handler) {
        console.warn(`[export-pdf] no handler for node type "${block.node.type.name}"`);
        continue;
      }
      ctx.x = block.x;
      ctx.y = block.y;
      ctx.width = block.width;
      handler(block, ctx);
    }

    // 5b. Chrome (headers, footers, footnote bands)
    //     Dispatched in ExtensionManager registration order — last-registered
    //     paints on top. See §12.2.
    //     Each handler receives its own contributor payload via the central
    //     lookup from layout._chromePayloads — handlers never reach into core
    //     internals themselves.
    for (const [chromeName, chromeHandler] of Object.entries(chromeHandlers)) {
      const payload = layout._chromePayloads?.[chromeName];
      chromeHandler(layoutPage, payload, ctx);
    }
  }

  // ── Phase 6: Post-export hooks ─────────────────────────────────────────
  for (const hook of lifecycleHooks.after) {
    await hook(ctx);
  }

  // ── Phase 7: Save ──────────────────────────────────────────────────────
  return pdfDoc.save();
}
```

Key properties:

- **Extension iteration is O(extensions × contributions)**, which is small (~20 extensions max, each contributes 0–1 entries per format). No perf concern.
- **Handler dispatch is O(1) per block** — single map lookup by node type name.
- **Missing handlers warn, don't throw.** Partial handler coverage is recoverable; throwing would brick the whole export. In strict mode (`options.strict: true`), missing handlers are a hard error.
- **Font loading, image preloading, and lifecycle hooks are async**, but the hot loop (Phase 5) is sync. Matches pdf-lib's sync drawing API.
- **Layout is guaranteed converged**: Phase 2's `ensureLayout({ force: true })` blocks until the iteration loop reports `stable` (or `exhausted`). Handlers operate on finalized `LayoutPage.metrics[]` — footnote bands won't overlap body text.

### 5.5 The inline atom dispatch rule

The top-level Phase 5a loop dispatches `nodeHandlers[block.node.type.name]` once per `LayoutBlock`. But some nodes never appear as top-level blocks — they're **inline atoms** that live inside a paragraph's line spans: `pageNumber`, `totalPages`, `date` (from the HeaderFooter plugin), inline `image` nodes, `@mentions`, and any future custom inline-object nodes.

Rule: **`nodeHandlers` doubles as the inline atom dispatch table.** The default paragraph/heading/blockquote/etc. line drawer iterates each line's spans, and when it encounters a span with `kind: "object"` (i.e., an inline atom), it looks up `nodeHandlers[span.node.type.name]` and invokes it with a synthetic context scoped to that span's rect:

```ts
// Inside the default paragraph line drawer (defaults.ts)
function drawLine(line: LayoutLine, blockCtx: PdfContext) {
  for (const span of line.spans) {
    if (span.kind === "text") {
      drawTextSpan(span, blockCtx, markHandlers);
    } else if (span.kind === "object") {
      // Atom inline node — dispatch via nodeHandlers with a scoped context
      const handler = nodeHandlers[span.node.type.name];
      if (!handler) {
        console.warn(`[export-pdf] no handler for inline atom "${span.node.type.name}"`);
        continue;
      }
      // Synthesize a LayoutBlock-like argument: the span IS the block for
      // this dispatch. The handler receives a narrowed rect + the atom node.
      const spanBlock: LayoutBlock = {
        node: span.node,
        nodePos: span.docPos,
        x: blockCtx.x + span.x,
        y: blockCtx.y + line.y,
        width: span.width,
        height: line.lineHeight,
        lines: [],                // atoms have no inner lines
        spaceBefore: 0,
        spaceAfter: 0,
        blockType: "atom",
        align: "left",
        availableWidth: span.width,
      };
      const atomCtx = { ...blockCtx, x: spanBlock.x, y: spanBlock.y, width: spanBlock.width };
      handler(spanBlock, atomCtx);
    }
  }
}
```

**Why this dispatch rule matters**:

- **One handler function works for both cases.** The `image` handler in `defaults.ts` doesn't know whether it's being called for a block-level image (top-level dispatch) or an inline image (line-drawer dispatch). Both paths converge on the same function, called with a rect and a context. Handler implementation stays unified.
- **Plugin contributions work for both cases for free.** A `CalloutBox` that contains an inline `image` gets that image drawn via the same handler registered by the core image extension. A header containing `pageNumber` gets it drawn via the same handler the body would use if you put a page number in a paragraph (unusual but valid).
- **No second dispatch table to maintain.** Without this rule, we'd need `nodeHandlers` for blocks and `atomHandlers` for inline atoms, keeping them synchronized. The rule collapses them into one.

**Resolution of `project_pdf_inline_objects.md`**: the old memory flagged that inline object spans were skipped in the PDF exporter via a `continue` guard. That `continue` becomes the dispatch call above. Combined with `ctx.draw.image(preloadedImage, rect)` as the drawing primitive (see §5.6), inline image rendering is fully resolved.

#### Why not a separate `inlineNodes` dispatch table

A natural suggestion when reviewing this design: "split `nodes` into `nodes` (block-level) and `inlineNodes` (atom inline) so each has its own dispatch table." **This is rejected**, and the rejection is load-bearing enough to spell out:

1. **One handler function should work for both cases.** The `image` handler doesn't care whether it was invoked from Phase 5a's top-level loop (block-level image) or from this dispatch rule (inline image). It receives a rect and draws. Forcing two separate handler declarations for the same node type means the plugin writes the same logic twice, the second copy drifts out of sync, and the `image` node starts rendering differently depending on where it appears.
2. **Plugin contributions must work for both cases for free.** When a user adds an `image` extension that contributes a PDF handler, it should render correctly whether the image is a top-level block or embedded in a paragraph. Two tables means the user has to register in both, and forgetting one is a silent gap.
3. **No second table to keep in sync.** Every future review will propose changes to "inline dispatch" separately from "block dispatch," and the two tables will gradually diverge. Single-table dispatch is self-consistent by construction.
4. **Ambiguity for dual-use nodes.** An image can legitimately appear as a block (standalone on its own line) OR inline (embedded in text). A `pageNumber` could appear as a block in a header (weird but valid) OR inline (typical). With two tables, the plugin has to predict every context and register in both. With one table, context is the caller's problem — the handler just draws.

The cost of single-table dispatch is one small branch in the default paragraph line drawer (the `span.kind === "object"` check). That's the only place the two call paths diverge in code. It's not "hidden coupling"; it's the only place the rule could possibly be implemented, and it's documented here.

**If a reviewer proposes `inlineNodes` in the future, point them at this subsection.**

### 5.6 `ctx.draw.image()` and the Y-axis flip

pdf-lib uses a **bottom-up** Y coordinate system (origin at bottom-left, y increases upward). Scrivr's layout uses a **top-down** Y system (origin at top-left, y increases downward, matching canvas). Every handler drawing to pdf-lib has to flip Y, and getting this wrong is the single most common PDF bug.

`ctx.draw.image(image, rect)` and its siblings (`ctx.draw.rectangle`, `ctx.draw.text`, `ctx.draw.lines`) take **Scrivr-flavored top-down rects** and handle the flip internally. Handlers pass `{ x, y, width, height }` in layout coordinates and get correct PDF output without ever seeing `pdf-lib`'s coordinate convention.

```ts
// Handler code — looks natural, uses layout coordinates
nodeHandlers.image = (block, ctx) => {
  const src = block.node.attrs.src as string;
  const preloaded = ctx.images.get(src);
  if (!preloaded) {
    console.warn(`[export-pdf] image not preloaded: ${src}`);
    return;
  }
  ctx.draw.image(preloaded, {
    x: ctx.x,
    y: ctx.y,
    width: ctx.width,
    height: block.height,
  });
};
```

Image preloading happens in Phase 3 (`loadImages`): walks the doc, collects every `image` node's `src`, fetches the bytes (async), decodes via `pdfDoc.embedPng` or `pdfDoc.embedJpg` based on sniffed format, stores in a `Map<string, PDFImage>` on `ctx.images`. Handlers do the fast lookup at draw time. Plugins that need custom image sources (e.g., server-side generated diagrams) can push to `ctx.images` in their `onBeforeExport` hook.

---

## 6. Markdown format package — worked example

Different shape, different calling convention, same `addExports()` lane. Shows that format-specific handler types genuinely diverge and the opaque-payload design is justified.

```ts
// packages/export-markdown/src/handlers.ts

import type { Node, Mark } from "@scrivr/core";

export interface MarkdownContext {
  /** The editor being exported. */
  editor: Editor;
  /** Depth in nested blockquote / list — used by default handlers for indentation. */
  depth: number;
}

export interface MarkdownHandlers {
  /**
   * Per-node serializer. Receives the pre-rendered children string and
   * returns the complete string for this node. Classic visitor pattern,
   * matches prosemirror-markdown's internal shape.
   */
  nodes?: Record<string, MarkdownNodeHandler>;

  /**
   * Per-mark wrapper. Receives the already-marked text and wraps it.
   * Multiple marks compose by nested calls (order determined by mark precedence).
   */
  marks?: Record<string, MarkdownMarkHandler>;

  /** Runs once before tree walking starts. */
  onBeforeExport?(ctx: MarkdownContext): void | Promise<void>;

  /** Runs once after the final string is assembled. */
  onAfterExport?(output: string, ctx: MarkdownContext): Promise<string> | string;
}

export type MarkdownNodeHandler = (
  node: Node,
  children: string,
  ctx: MarkdownContext,
) => string;

export type MarkdownMarkHandler = (
  content: string,
  mark: Mark,
  ctx: MarkdownContext,
) => string;

declare module "@scrivr/core" {
  interface FormatHandlers {
    markdown: MarkdownHandlers;
  }
}
```

```ts
// packages/export-markdown/src/defaults.ts

export const defaultMarkdownNodeHandlers: MarkdownHandlers["nodes"] = {
  paragraph: (_, children) => `${children}\n\n`,
  heading: (node, children) => `${"#".repeat(node.attrs.level)} ${children}\n\n`,
  bullet_list: (_, children) => `${children}\n`,
  ordered_list: (_, children) => `${children}\n`,
  list_item: (_, children, ctx) => `${"  ".repeat(ctx.depth)}- ${children}`,
  blockquote: (_, children) => children.split("\n").map(l => l ? `> ${l}` : l).join("\n"),
  code_block: (node, children) => `\`\`\`${node.attrs.language ?? ""}\n${children}\n\`\`\`\n\n`,
  image: (node) => `![${node.attrs.alt ?? ""}](${node.attrs.src})`,
  hardBreak: () => "  \n",
  text: (node) => node.text ?? "",
};

export const defaultMarkdownMarkHandlers: MarkdownHandlers["marks"] = {
  bold: (content) => `**${content}**`,
  italic: (content) => `*${content}*`,
  strikethrough: (content) => `~~${content}~~`,
  code: (content) => `\`${content}\``,
  link: (content, mark) => `[${content}](${mark.attrs.href})`,
  // underline, color, highlight: markdown has no standard syntax, default is identity
  underline: (content) => content,
  color: (content) => content,
  highlight: (content) => content,
};
```

The `exportMarkdown` entry point walks the PM tree recursively rather than iterating `LayoutPages`:

```ts
// packages/export-markdown/src/export.ts

export async function exportMarkdown(
  editor: Editor,
  options: MarkdownExportOptions = {},
): Promise<string> {
  const nodeHandlers = { ...defaultMarkdownNodeHandlers };
  const markHandlers = { ...defaultMarkdownMarkHandlers };

  // Same merge loop as PDF — defaults → extension contributions → user overrides
  for (const ext of editor.manager.extensions) {
    const contribs = ext.addExports?.() ?? [];
    for (const contrib of contribs) {
      if (contrib.format !== "markdown") continue;
      if (contrib.handlers.nodes) Object.assign(nodeHandlers, contrib.handlers.nodes);
      if (contrib.handlers.marks) Object.assign(markHandlers, contrib.handlers.marks);
    }
  }
  if (options.overrides) {
    if (options.overrides.nodes) Object.assign(nodeHandlers, options.overrides.nodes);
    if (options.overrides.marks) Object.assign(markHandlers, options.overrides.marks);
  }

  const ctx: MarkdownContext = { editor, depth: 0 };
  const output = walkNode(editor.state.doc, ctx, nodeHandlers, markHandlers);
  return output;
}

function walkNode(
  node: Node,
  ctx: MarkdownContext,
  nodeHandlers: Record<string, MarkdownNodeHandler>,
  markHandlers: Record<string, MarkdownMarkHandler>,
): string {
  // Render children first (depth-first)
  let children = "";
  if (node.isText) {
    children = node.text ?? "";
    // Apply marks in reverse spec order (innermost first)
    for (const mark of node.marks) {
      const markHandler = markHandlers[mark.type.name];
      if (markHandler) children = markHandler(children, mark, ctx);
    }
  } else {
    const childDepth = node.type.name === "list_item" ? ctx.depth + 1 : ctx.depth;
    const childCtx = { ...ctx, depth: childDepth };
    for (let i = 0; i < node.content.childCount; i++) {
      children += walkNode(node.content.child(i), childCtx, nodeHandlers, markHandlers);
    }
  }

  // Dispatch this node's handler
  const handler = nodeHandlers[node.type.name];
  if (!handler) {
    console.warn(`[export-markdown] no handler for node type "${node.type.name}"`);
    return children;  // pass through children if no handler
  }
  return handler(node, children, ctx);
}
```

**Notice**: same contribution shape (`ExportContribution[]`), same merge semantics, completely different handler signatures and walker. Core doesn't care.

---

## 7. Plugin contributions — worked examples

### 7.1 HeaderFooter plugin

HeaderFooter is a chrome contributor in canvas-land (`addPageChrome`) and a chrome contributor in PDF-land (`addExports` with a `chrome` slot). Two separate hooks, two separate concerns.

```ts
// packages/plugins/header-footer/src/HeaderFooter.ts

import { Extension } from "@scrivr/core";
import type { PdfHandlers } from "@scrivr/export-pdf";
import type { MarkdownHandlers } from "@scrivr/export-markdown";
import { drawHeaderFooterOnPdfPage } from "./pdf";
import { headerFooterToMarkdown } from "./markdown";

export const HeaderFooter = Extension.create({
  name: "headerFooter",

  addDocAttrs() {
    return { headerFooter: { default: null } };
  },

  addNodes() {
    return { pageNumber: pageNumberNode, totalPages: totalPagesNode, date: dateNode };
  },

  addPageChrome() {
    // Canvas rendering — unchanged from header-footer-plan §4.2
    return { name: "headerFooter", measure: resolveChrome, render: drawPageChrome };
  },

  addExports() {
    return [
      {
        format: "pdf",
        handlers: {
          chrome: {
            // Typed chrome handler: receives its own payload as the second arg.
            // The exporter pulls HeaderFooterPayload from layout._chromePayloads
            // centrally — this handler doesn't know about that internal storage.
            headerFooter: ((layoutPage, payload: HeaderFooterPayload, ctx) => {
              // payload.resolvedSlots has the pre-measured header/footer
              // mini-layouts for this page's applicable variant.
              drawHeaderFooterOnPdfPage(layoutPage, payload, ctx);
            }) satisfies PdfChromeHandler<HeaderFooterPayload>,
          },
          // pageNumber/totalPages/date atom inline nodes dispatch via the
          // single `nodes` table per §5.5. These run for BOTH top-level
          // dispatch (if the user put a pageNumber in a body paragraph) and
          // inline-in-line dispatch (if it's in a header's line spans).
          nodes: {
            pageNumber: (block, ctx) => {
              ctx.draw.text(String(ctx.layoutPage.pageNumber), { x: ctx.x, y: ctx.y });
            },
            totalPages: (block, ctx) => {
              // ctx.layout is the full DocumentLayout — total page count is
              // known at handler-invocation time because layout has converged
              // in Phase 2.
              ctx.draw.text(String(ctx.layout.pages.length), { x: ctx.x, y: ctx.y });
            },
            date: (block, ctx) => {
              const frozen = block.node.attrs.frozen as string | null;
              const text = frozen ?? new Date().toLocaleDateString();
              ctx.draw.text(text, { x: ctx.x, y: ctx.y });
            },
          },
        } satisfies PdfHandlers,
      },
      {
        format: "markdown",
        handlers: {
          // Markdown has no header/footer concept. Skip them in the output.
          // Tokens render as plain text.
          nodes: {
            pageNumber: () => "",    // markdown has no page numbers
            totalPages: () => "",
            date: (node) => (node.attrs.frozen as string | null) ?? new Date().toLocaleDateString(),
          },
        } satisfies MarkdownHandlers,
      },
    ];
  },

  addCommands() {
    return { setHeaderFooter: /* ... */ };
  },
});
```

The critical point: the header/footer PDF handler replaces the direct-import approach in the header-footer plan's §10. `@scrivr/export-pdf` does NOT import anything from `@scrivr/plugins/header-footer`. The plugin ships its PDF handler as a contribution, and the PDF exporter picks it up via the extension iteration loop.

### 7.2 User-defined `CalloutBox` plugin

```ts
// user-code/CalloutBox.ts

import { Extension } from "@scrivr/core";
import type { PdfHandlers } from "@scrivr/export-pdf";
import type { MarkdownHandlers } from "@scrivr/export-markdown";
import { rgb } from "pdf-lib";

export const CalloutBox = Extension.create({
  name: "calloutBox",

  addNodes() {
    return {
      callout: {
        group: "block",
        content: "inline*",
        attrs: { tone: { default: "info" } },
        parseDOM: [{ tag: "div.callout", getAttrs: (el) => ({ tone: el.getAttribute("data-tone") ?? "info" }) }],
        toDOM: (node) => ["div", { class: `callout callout-${node.attrs.tone}`, "data-tone": node.attrs.tone }, 0],
      },
    };
  },

  addExports() {
    return [
      {
        format: "pdf",
        handlers: {
          nodes: {
            callout: (block, ctx) => {
              const tone = block.node.attrs.tone as string;
              const bg = {
                info: rgb(0.9, 0.95, 1),
                warning: rgb(1, 0.95, 0.8),
                danger: rgb(1, 0.9, 0.9),
              }[tone] ?? rgb(0.95, 0.95, 0.95);

              // Background fill
              ctx.page.drawRectangle({
                x: ctx.x,
                y: ctx.page.getHeight() - ctx.y - block.height,
                width: ctx.width,
                height: block.height,
                color: bg,
              });

              // Indent content and draw the lines using the default helper
              ctx.draw.lines(block.lines, {
                x: ctx.x + 16,
                y: ctx.y + 8,
                width: ctx.width - 32,
              });
            },
          },
        } satisfies PdfHandlers,
      },
      {
        format: "markdown",
        handlers: {
          nodes: {
            callout: (node, children) => {
              // GitHub-style admonition syntax
              const tone = node.attrs.tone as string;
              return `> [!${tone.toUpperCase()}]\n${children.split("\n").map(l => `> ${l}`).join("\n")}\n\n`;
            },
          },
        } satisfies MarkdownHandlers,
      },
    ];
  },
});
```

A complete, self-contained user extension that ships its own rendering for two formats. No core changes, no exporter forks.

### 7.3 Document-level preprocessing — a TOC plugin

Some features need a document-level pass before page iteration starts: footnote numbering, TOC collection, citation resolution, cross-references. All of these use `onBeforeExport` — there is no separate "preprocess" hook because `onBeforeExport` runs at exactly the right point (layout is converged, context is built, no pages drawn yet).

```ts
// packages/plugins/toc/src/TableOfContents.ts

import { Extension } from "@scrivr/core";
import type { PdfHandlers } from "@scrivr/export-pdf";

interface HeadingEntry {
  level: number;
  text: string;
  pageNumber: number;
  y: number;
}

export const TableOfContents = Extension.create({
  name: "tableOfContents",

  addExports() {
    // Module-scoped state lives on a WeakMap keyed by ctx.editor so multiple
    // concurrent exports don't clobber each other.
    const tocCache = new WeakMap<Editor, HeadingEntry[]>();

    return [
      {
        format: "pdf",
        handlers: {
          onBeforeExport: (ctx) => {
            // Walk the converged layout and collect all headings with their
            // resolved page numbers and y positions. Layout has already
            // finalized page placement at this point (Phase 2 blocked until
            // convergence), so pageNumber is authoritative.
            const entries: HeadingEntry[] = [];
            for (const page of ctx.layout.pages) {
              for (const block of page.blocks) {
                if (block.node.type.name !== "heading") continue;
                entries.push({
                  level: block.node.attrs.level as number,
                  text: block.node.textContent,
                  pageNumber: page.pageNumber,
                  y: block.y,
                });
              }
            }
            tocCache.set(ctx.editor, entries);
          },

          onAfterExport: (ctx) => {
            // Use the collected headings to emit PDF outline entries (bookmarks).
            const entries = tocCache.get(ctx.editor) ?? [];
            for (const entry of entries) {
              // pdf-lib outline API (simplified)
              ctx.doc.setOutline?.(entry);
            }
            tocCache.delete(ctx.editor);
          },

          nodes: {
            // Custom "table_of_contents" node that renders inline in the body.
            // At draw time, look up the cached entries and render them as
            // hyperlinks to their target pages.
            table_of_contents: (block, ctx) => {
              const entries = tocCache.get(ctx.editor) ?? [];
              let y = ctx.y;
              for (const entry of entries) {
                const indent = ctx.x + (entry.level - 1) * 16;
                const dots = "." .repeat(Math.max(0, 40 - entry.text.length));
                ctx.draw.text(`${entry.text} ${dots} ${entry.pageNumber}`, {
                  x: indent,
                  y,
                  width: ctx.width - (indent - ctx.x),
                });
                y += 14;
              }
            },
          },
        } satisfies PdfHandlers,
      },
    ];
  },
});
```

Three things this example demonstrates:

1. **`onBeforeExport` is the "walk the doc before drawing" hook.** No separate `preprocess` lane needed — the use cases ChatGPT might propose (footnotes, TOC, citations, cross-refs) all fit here.
2. **`ctx.layout` gives handlers global access.** The TOC walker needs to know every heading's page number, which requires iterating all pages. Because layout has converged before `onBeforeExport` runs, those page numbers are authoritative and won't change during dispatch.
3. **Shared state between hooks uses a `WeakMap<Editor, …>` keyed by the editor**, not module-scoped. This prevents two concurrent exports from the same process clobbering each other.

---

## 8. Handler composition and override

### 8.1 Precedence

```
built-in defaults (format package)
    ↓ overridden by
extension contributions (addExports)
    ↓ overridden by
export call options.overrides
```

Merge semantics: **shallow `Object.assign` per handler type** (`nodes`, `marks`, `chrome`). Later sources fully replace earlier ones per key.

### 8.2 "One extension per node type" rule

**An extension-contributed handler for a given node type should have exactly one owner.** If two extensions both contribute `nodes.paragraph`, the later-registered extension wins — but this is almost always a mistake, because the two plugins are fighting over the same slot without coordinating.

The exporter detects cross-extension collisions at merge time and logs a warning:

```
[export-pdf] extension-level handler collisions (last-registered wins):
  nodes.paragraph: "extension-A" → "extension-B"
  chrome.footnotes: "plugins-footnotes" → "some-other-plugin"
```

In `strict: true` mode the warning becomes a thrown error, so CI pipelines can catch unintentional collisions.

**What counts as a collision**:
- Two extensions contributing the same key in `nodes`, `marks`, or `chrome`. Warned.
- Default handler + extension contribution on the same key. **Not** a collision — this is the expected override path (extensions intentionally replace defaults for nodes they own).
- Extension contribution + user `options.overrides` on the same key. **Not** a collision — user overrides are always allowed to win without warning, that's the whole point of the options slot.

### 8.3 Decorating an existing handler (the composition pattern)

### 8.2 Decorating an existing handler (the composition pattern)

Users who want to *extend* a handler rather than replace it compose by calling the existing handler inside their override:

```ts
import { defaultPdfNodeHandlers } from "@scrivr/export-pdf";
import { exportPdf } from "@scrivr/export-pdf";

const bytes = await exportPdf(editor, {
  overrides: {
    nodes: {
      heading: (block, ctx) => {
        // Draw a red underline before the heading
        ctx.draw.rectangle({
          x: ctx.x,
          y: ctx.y - 4,
          width: ctx.width,
          height: 2,
          color: rgb(1, 0, 0),
        });
        // Delegate to the default handler for the actual text
        defaultPdfNodeHandlers.heading!(block, ctx);
      },
    },
  },
});
```

Simple, predictable, no deep-merge magic. Users who want decoration compose at the handler-function level.

### 8.4 Disabling a handler

To disable a built-in handler (e.g., skip images in PDF):

```ts
exportPdf(editor, {
  overrides: {
    nodes: {
      image: () => { /* no-op */ },
    },
  },
});
```

No special-case API, just replace with a no-op.

---

## 9. Migration from current `@scrivr/export`

### 9.1 Phased migration

| Phase | Scope | Outcome |
|---|---|---|
| **M0** | Create `@scrivr/export-pdf` + `@scrivr/export-markdown` packages, move existing code into them. No behavior change, no `addExports` lane yet. | Packages split, old `@scrivr/export` becomes a re-export shim. |
| **M1** | Add `addExports()` lane to `Extension` in core. Add `FormatHandlers` interface and `ExportContribution` type. Add module augmentation in each format package. | Core compiles; no extensions contribute yet. |
| **M2** | Refactor `exportPdf` and `exportMarkdown` entry points to use the handler dispatch pattern. Extract current hardcoded switch statements into `defaults.ts` files. All existing tests pass. | Default handlers work; contributions are a no-op since no extension uses them yet. |
| **M3** | First-party plugins (HeaderFooter, Footnotes when landed) contribute via `addExports`. Remove direct imports from `@scrivr/export-pdf` into plugin internals. | `feedback_pdf_parity.md` mechanism changes — plugins self-contain their export logic. |
| **M4** | Deprecate `@scrivr/export` compat shim after one minor release cycle. | Clean package tree. |

### 9.2 What the existing PDF exporter becomes

`packages/export/src/pdf/index.ts` (current) has a `buildPdf` function that walks `LayoutPages` with hardcoded per-type logic. In M2, that becomes:

- `packages/export-pdf/src/defaults.ts` — the hardcoded per-type logic extracted into `defaultPdfNodeHandlers` / `defaultPdfMarkHandlers`.
- `packages/export-pdf/src/export.ts` — the page-walking loop, refactored to dispatch via the handler map. Contains the Phase 1–6 pipeline shown in §5.4.
- `packages/export-pdf/src/context.ts` — `PdfContext`, `PdfDrawHelpers`, `PdfFontRegistry` (font loading logic moves here from the current exporter).

The existing 15 PDF integration tests (`packages/export/src/pdf/__tests__/buildPdf.test.ts`) move with the code and are re-pointed at the new package. They should pass unchanged if M2 is done correctly — no behavior change.

### 9.3 `feedback_pdf_parity.md` memory update

The rule is unchanged: every new canvas-rendered node or mark must also ship with export support. The mechanism changes from "edit `@scrivr/export/src/pdf/index.ts`" to "contribute PDF handlers via your extension's `addExports()`." The memory file needs updating to reflect the new mechanism.

---

## 10. Implementation sequencing

This extends the sequencing in `docs/multi-surface-architecture.md` §10. The export migration interleaves with the existing multi-surface phases.

| Step | Feature | Depends on | Notes |
|---|---|---|---|
| **M0** | Split `@scrivr/export` into `@scrivr/export-pdf` + `@scrivr/export-markdown` packages | — | Can ship before any of the multi-surface work. No behavior change. |
| **M1** | `addExports()` lane + `FormatHandlers` interface in core | Phase 1a (DocAttrStep + addDocAttrs pattern establishes the module augmentation conventions) | Tiny — ~30 lines in core plus module augmentation in format packages. |
| **M2** | Refactor format package entry points to dispatch via handler map | M0, M1 | Existing tests continue passing. |
| **M3a** | HeaderFooter plugin contributes PDF chrome handler via `addExports` | Multi-surface Phase 6 (was "Header/footer PDF export"); replaces the direct-import approach | Replaces the `@scrivr/export` → plugin direct import the header-footer plan originally proposed. |
| **M3b** | Footnotes plugin contributes PDF chrome handler | Multi-surface Step 16 | Same pattern. |
| **M4** | Remove `@scrivr/export` compat shim | After one release cycle | Clean up. |
| **future** | `@scrivr/export-docx` package | M1 | Independent PR, own design session. |

**Where M0-M2 fit in the existing sequencing**: M0 can happen any time (independent refactor). M1 naturally aligns with Phase 1a in the multi-surface architecture (the core primitive-adding phase). M2 can run in parallel with any of the later phases. M3a replaces what was previously "Step 6 — Header/footer PDF export" in the multi-surface sequencing.

---

## 11. Out of scope for v1

- **`@scrivr/export-docx`**. Own design session, own PR. OOXML + field codes + style definitions is a real feature.
- **Format discovery API** (`editor.getAvailableFormats()`). Useful for UIs but not blocking any current feature. Add when a caller needs it.
- **Async handlers** in the hot loop. Font loading (Phase 2) and lifecycle hooks (Phase 3/5) are async; the per-block dispatch loop is sync to match pdf-lib's sync drawing API. A future format with async drawing (e.g., server-side rendering with remote font calls) would need a streaming variant.
- **Streaming export** for very large documents. v1 buffers the whole PDF in memory. Fine for < 500 pages.
- **Per-page handler overrides**. Handlers are fixed for the whole export call. No "use these handlers for pages 3–5."
- **Runtime handler swapping during export**. Same reason — fixed handlers per call.
- **Handler access to raw PM doc during layout-based formats**. PDF handlers get `LayoutBlock`, which exposes `block.node` for the source PM node if needed. No separate doc-walk facility.
- **HTML export**. Not currently planned. Would follow the same pattern (own package, own handler shape) if added.

---

## 12. Resolved design decisions

The five open questions from earlier drafts are all settled. Documenting the resolutions here so the rationale survives the implementation PRs.

### 12.1 Layout triggering for export — `ensureLayout({ force: true })`

**Decision**: `exportPdf` calls `editor.ensureLayout({ force: true })` at the start of Phase 2. The `force: true` flag means three things at once:

1. **Synchronous** — the call blocks the main thread until complete. No deferred work, no rAF, no idle callbacks.
2. **Complete** — any in-flight streaming / chunked layout (`isPartial: true`) is flushed to full. Export cannot operate on a partial layout because the page count and pagination are undefined until all blocks are placed.
3. **Converged** — the iterative chrome loop (§3.4 in `docs/multi-surface-architecture.md`) runs until all contributors report `stable: true`, or it hits `MAX_ITERATIONS` and marks the run `exhausted`. Either outcome produces a final `LayoutPage.metrics[]` array that export can walk.

**Why all three flags**: "force" without "sync" could mean "ignore cache but keep running in the background," which is wrong for export. "Force" without "converged" could hand export a mid-iteration layout where footnote bands are half-resolved and body text overlaps them. All three together mean "stop the world, produce a final authoritative layout, then return."

**Perf note**: on footnote-heavy documents, this call can block for several ms per iteration. Typical case is 2–3 iterations (≤10ms on a 50-page doc); worst case is 5 iterations with exhaustion. This is acceptable because export is already a blocking user action — the user clicks "Export" and expects a moment of wait. Consumer apps rendering the export button should show a loading state if they expect large docs.

**Implementation note**: the current layout production lives on `LayoutCoordinator`, accessed via `editor.lc.ensureLayout()`. A public `editor.ensureLayout({ force })` method needs to be added in the M1 migration phase as a thin wrapper. It's a small addition (<20 lines) to `Editor.ts`.

### 12.2 Chrome z-ordering — implicit registration order, last-registered paints on top

**Decision**: chrome handlers are dispatched in **`ExtensionManager` registration order**. Extensions registered later paint on top of earlier ones. No `zIndex` field on `PageChromeContribution` in v1.

**Registration order comes from the `extensions` array** passed to the Editor constructor:

```ts
new Editor({
  extensions: [
    StarterKit,       // registered first → bottom layer
    HeaderFooter,     // middle
    Footnotes,        // registered last → top layer (paints on top of headers)
  ],
});
```

**Practical ordering guidance**:

- **Background-like chrome first** (page backgrounds, watermarks, grid overlays). They want to be at the bottom of the stack.
- **Structural chrome next** (headers, footers, footnote bands). Standard document furniture.
- **Decorative chrome last** (draft stamps, annotations, review overlays). They want to be on top.

This is an *implicit* guarantee — developers reasoning about z-order have to trace back to their `extensions` array ordering. For v1, that's acceptable; if real-world stacking conflicts arise, we add an explicit `zIndex` field later without breaking existing consumers (default = 0).

**Implementation**: the exporter's merge loop uses `Object.assign` + `Object.entries` iteration, both of which preserve insertion order per ES2015+. The order in `chromeHandlers` is the order in which extensions contributed — which is the extension registration order. Dispatch in Phase 5b iterates in that order. Stable, deterministic, no surprises.

### 12.3 Format package versioning — SemVer + optional peer dependencies

**Decision**: format packages (`@scrivr/export-pdf`, `@scrivr/export-markdown`, future `@scrivr/export-docx`) ship on **independent SemVer timelines** from `@scrivr/core`. The handler API types (`PdfHandlers`, `PdfContext`, `PdfNodeHandler`, etc.) are classified as a **stable API boundary**.

**Versioning rules**:

- **Additive changes** (new optional fields on `PdfContext`, new slots on `PdfHandlers` like a hypothetical `outlines`) → minor version bump.
- **Breaking changes** (mandatory field on `PdfContext`, renamed handler signature, removed slot) → major version bump.
- **Internal changes** (default handler implementations, font loading logic, pdf-lib version) → patch version bump.

**Plugin dependency declaration**: plugins that contribute format handlers use **optional peer dependencies** — `peerDependencies` plus `peerDependenciesMeta.optional: true`:

```json
{
  "name": "@scrivr/plugins-header-footer",
  "peerDependencies": {
    "@scrivr/core": "^1.0.0",
    "@scrivr/export-pdf": "^1.0.0",
    "@scrivr/export-markdown": "^1.0.0"
  },
  "peerDependenciesMeta": {
    "@scrivr/export-pdf": { "optional": true },
    "@scrivr/export-markdown": { "optional": true }
  }
}
```

**Why `optional: true` is non-negotiable**: plain peerDependencies would force every consumer of `@scrivr/plugins-header-footer` to also install `@scrivr/export-pdf`, even if they never export to PDF. That forces `pdf-lib` into every consumer's bundle and defeats the whole purpose of the per-format package split. Optional peer deps mean "if the user has `@scrivr/export-pdf` installed at a compatible version, my PDF handlers will type-check and load; if they don't, the `addExports()` contribution is inert (dead code, possibly tree-shaken)."

**Type imports**: plugins import format handler types via `import type`:

```ts
import type { PdfHandlers } from "@scrivr/export-pdf";
```

Type-only imports get erased at compile time — they don't create a runtime dependency. Combined with optional peer deps, a plugin can declare typed PDF handlers without forcing any consumer to install the PDF package. The handlers just sit unused if PDF export isn't happening.

**What the consumer sees**:

- App that needs PDF export: installs `@scrivr/plugins-header-footer` + `@scrivr/export-pdf`. Headers render in PDFs.
- App that doesn't need PDF export: installs only `@scrivr/plugins-header-footer`. Headers render on canvas. The PDF handler code exists in the plugin's bundle but is never invoked.
- App that only needs markdown export: installs `@scrivr/plugins-header-footer` + `@scrivr/export-markdown`. Headers are omitted from markdown output (markdown has no header concept), the PDF contribution is dead code.

No forced installs, no bundled `pdf-lib` for non-PDF users, no handlers silently missing from exports. The dependency graph matches the feature graph.

### 12.4 Image rendering — `ctx.draw.image()` + inline atom dispatch

**Decision**: image rendering is fully resolved by combining two mechanisms already specified:

1. **`ctx.draw.image(image, rect)` helper** (§5.6) — takes top-down layout rects and handles the Y-axis flip for pdf-lib internally. Handlers never touch pdf-lib's bottom-up coordinate system directly.
2. **Inline atom dispatch rule** (§5.5) — the default paragraph line drawer calls `nodeHandlers[span.node.type.name]` for inline object spans (images, pageNumber, totalPages, date, mentions). The same `nodeHandlers.image` function handles both block-level and inline images because the dispatch converges on one entry point.

**Image preloading pipeline**:

```
Phase 3 (build context):
  loadImages(editor, pdfDoc):
    1. Walk editor.state.doc, collect every image node's `src`
    2. For each unique src:
       a. Fetch bytes (async — fetch() or fs.readFile() depending on runtime)
       b. Sniff format (PNG magic bytes vs JPG SOI marker)
       c. Embed via pdfDoc.embedPng(bytes) or pdfDoc.embedJpg(bytes)
    3. Return Map<string, PDFImage>
  → ctx.images = result

Phase 5 (walk pages):
  - Block-level image: nodeHandlers.image(block, ctx) looks up ctx.images.get(block.node.attrs.src) and draws via ctx.draw.image()
  - Inline image: span dispatch calls nodeHandlers.image with a synthetic block scoped to the span's rect; same lookup, same draw call
```

**Plugin extensibility**: plugins needing custom image sources (e.g., server-side generated diagrams, inline charts, LaTeX-rendered math) add to `ctx.images` in their `onBeforeExport` hook:

```ts
onBeforeExport: async (ctx) => {
  const charts = ctx.editor.state.doc;  // walk for chart nodes
  for (const chartNode of collectChartNodes(charts)) {
    const svg = await renderChartToPng(chartNode.attrs.data);
    const pdfImage = await ctx.doc.embedPng(svg);
    ctx.images.set(`chart:${chartNode.attrs.id}`, pdfImage);
  }
}
```

Then the chart's node handler calls `ctx.draw.image(ctx.images.get(\`chart:${id}\`), rect)` during dispatch.

**Resolution of the pre-existing TODO**: memory `project_pdf_inline_objects.md` previously flagged that the PDF exporter's line drawer had a `continue` guard skipping all `kind: "object"` spans. After this design lands:

- The `continue` guard is removed.
- Object spans are dispatched via `nodeHandlers[span.node.type.name]`.
- Default `image` handler (for both block-level and inline images) lives in `packages/export-pdf/src/defaults.ts`.
- Preloading walks the doc and populates `ctx.images` before the dispatch loop runs.
- The memory file is updated to reflect that inline object rendering is no longer a TODO — it's a regular feature built via the standard extension lane.

---

## 13. References

- `docs/multi-surface-architecture.md` — the broader architecture. Export contributions are the format-land counterpart to `addPageChrome` (canvas-land).
- `docs/header-footer-plan.md` — the concrete consumer that uses `addExports` for PDF chrome.
- Memory `feedback_pdf_parity.md` — the rule this design operationalizes. Memory needs updating to reflect the new mechanism (plugin ships handlers, not "edit the export package").
- Memory `project_pdf_inline_objects.md` — pending image rendering work; follows this pattern.
- Current code: `packages/export/src/pdf/` is the source of defaults for M2.
