// Side-effect: augments FormatHandlers with the "pdf" key.
import "./augmentation";

export { PdfExport } from "./PdfExport";
export type { PdfHandlers, PdfNodeHandler, PdfChromeHandler } from "./augmentation";
// The mark lane's contract lives in core so an extension can describe its
// mark without depending on this package; re-exported for consumers already
// importing it from here.
export type {
  FontResolutionId,
  PdfMarkHandler,
  PdfSpanStyle,
  PdfSpanMark,
  PdfMarkContext,
  PdfDrawSurface,
  PdfPoint,
  PdfBox,
  PdfTextOp,
  PdfLineOp,
  PdfRectOp,
  PdfImageOp,
  PdfFontHandle,
  PdfImageHandle,
  Rgb,
} from "@scrivr/core";
export type { PdfContext, PdfFontRegistry, PdfDrawHelpers } from "./context";
export type { PdfMetadata } from "./metadata";
export type { ImageResolver, ImageBytes } from "./fetchImage";

import { PDFDocument, type PDFPage, type PDFImage } from "pdf-lib";
import type {
  PdfMarkHandler,
  IEditor,
  IBaseEditor,
  DocumentLayout,
  AnchoredObjectPlacement,
  LayoutBlock,
  ResolvedTheme,
} from "@scrivr/core";
import type { FontShortfall } from "@scrivr/core";
import {
  chromeBlocks,
  compareAnchoredObjectPaintOrder,
  defaultPdfTheme,
} from "@scrivr/core";
import { createDefaultImageResolver } from "./fetchImage";
import type { ImageResolver } from "./fetchImage";
import type { PdfNodeHandler, PdfChromeHandler } from "./augmentation";
import { PT_PER_PX, createDrawHelpers, parseCssColor } from "./context";
import type { PdfContext } from "./context";
import {
  embedStandardFonts,
  embedResolvedFonts,
  createFontRegistry,
} from "./fonts";
import { defaultNodeHandlers, defaultMarkHandlers } from "./defaults";
import { preparePdfLayout } from "./prepareLayout";
import { applyMetadata, type PdfMetadata } from "./metadata";
import { addHeadingOutline } from "./outline";

/** Public types */

export interface PdfExportOptions {
  /**
   * Called when the document asks for faces this editor could not honour under
   * the conditions a PDF imposes. Reporting, not failure: the export proceeds
   * with what it resolved to.
   */
  onFontShortfall?: (shortfalls: FontShortfall[]) => void;
  /**
   * Optional theme override. Shallow-merged over the print-ready
   * `defaultPdfTheme`. The PDF default ignores the canvas theme entirely —
   * passing `theme` is the explicit opt-in for a themed export. Values must
   * be literal CSS colors (hex or rgb/rgba); `var(...)` strings are not
   * supported because the resolver is browser-only.
   *
   * @example
   * editor.commands.exportPdf({
   *   theme: { pageBg: "#1e1e1e", defaultText: "#e0e0e0" },
   * });
   */
  theme?: Partial<ResolvedTheme>;
  /**
   * What the file says about itself — title, author, dates. Written to the
   * PDF's Info dictionary, which is what a viewer's title bar, a desktop
   * search and a document system all read.
   */
  metadata?: PdfMetadata;
  /**
   * Build bookmarks from the document's headings. On by default: a reader
   * opening a long agreement has no way through it but scrolling without them.
   */
  outline?: boolean;
  /**
   * How an image `src` becomes bytes.
   *
   * A document names its own image URLs, so exporting one makes this process
   * request whatever it names. The built-in resolver refuses anything that is
   * not a public http(s) address — loopback, private ranges, link-local and
   * cloud metadata included — and caps the wait, the size and the redirects.
   *
   * Supply your own to widen that (internal images on a self-hosted install)
   * or to narrow it (an allowlist, when the documents are untrusted). Yours is
   * the whole policy: nothing is checked around it.
   */
  resolveImage?: ImageResolver;
  /**
   * Called when the built-in resolver refuses a URL the document asked for.
   * The export continues and draws a placeholder; without this the refusal
   * looks exactly like a broken link.
   */
  onImageRefused?: (src: string, reason: string) => void;
}

/** Public API */

/**
 * Export the editor's current document to a PDF binary.
 * Collects extension-contributed handlers via addExports().
 */
export async function exportToPdf(
  editor: IEditor,
  options?: PdfExportOptions,
): Promise<Uint8Array> {
  if (editor.fonts) {
    const prepared = await preparePdfLayout(editor);
    if (prepared.shortfalls.length) options?.onFontShortfall?.(prepared.shortfalls);
    return writePdf(prepared.layout, editor, options, prepared);
  }

  editor.ensureFullLayout();
  const layout = editor.layout;
  if (layout.isPartial) {
    throw new Error(
      "[exportToPdf] cannot export a partial layout. " +
        "Upgrade @scrivr/core or call editor.ensureFullLayout() before exporting.",
    );
  }
  return buildPdf(layout, editor, options);
}

/**
 * Lower-level export — accepts a pre-computed DocumentLayout directly (useful
 * for server-side rendering or testing).
 *
 * `editor` is required: extension nodes (e.g. `table`) contribute their PDF
 * handler through `editor.getExportContributions()`, so without it those blocks
 * would render blank. A `ServerEditor` is sufficient (it satisfies the needed
 * surface). A block whose node type still has no handler is skipped with a
 * one-time warning.
 */
export async function buildPdf(
  layout: DocumentLayout,
  editor: IBaseEditor,
  options?: PdfExportOptions,
): Promise<Uint8Array> {
  return writePdf(layout, editor, options);
}

async function writePdf(
  layout: DocumentLayout,
  editor: IBaseEditor,
  options?: PdfExportOptions,
  prepared?: Awaited<ReturnType<typeof preparePdfLayout>>,
): Promise<Uint8Array> {
  // Only own contribution entries enter these registries. Every string is a
  // valid key, including names shared with Object.prototype. Later extensions
  // override earlier registrations in all three lanes.
  // ── Phase 1: Collect handlers ──────────────────────────────────────────
  const nodeHandlers = new Map<string, PdfNodeHandler>(Object.entries(defaultNodeHandlers));
  const markHandlers = new Map<string, PdfMarkHandler>(Object.entries(defaultMarkHandlers));
  const chromeHandlers = new Map<string, PdfChromeHandler<unknown>>();
  const lifecycleHooks: {
    before: Array<(ctx: PdfContext) => void | Promise<void>>;
    after: Array<(ctx: PdfContext) => void | Promise<void>>;
  } = { before: [], after: [] };

  for (const contrib of editor.getExportContributions()) {
    const pdfContrib = contrib.pdf;
    if (!pdfContrib) continue;
    for (const [name, handler] of Object.entries(pdfContrib.nodes ?? {})) {
      nodeHandlers.set(name, handler);
    }
    for (const [name, handler] of Object.entries(pdfContrib.marks ?? {})) {
      markHandlers.set(name, handler);
    }
    for (const [name, handler] of Object.entries(pdfContrib.chrome ?? {})) {
      chromeHandlers.set(name, handler);
    }
    if (pdfContrib.onBeforeExport) lifecycleHooks.before.push(pdfContrib.onBeforeExport);
    if (pdfContrib.onAfterExport) lifecycleHooks.after.push(pdfContrib.onAfterExport);
  }

  // A block type with no handler is skipped (renders blank). Warn once per type
  // so the gap is loud rather than silent (e.g. an extension that wasn't enabled
  // on the editor).
  const warnedMissing = new Set<string>();

  /**
   * The one lookup. Both dispatch sites reach a node's handler through it — a
   * block and the same node as an inline atom — so a missing handler is
   * reported identically wherever it appears, instead of one path warning and
   * the other dropping the node in silence.
   */
  const resolveNodeHandler = (name: string): PdfNodeHandler | undefined => {
    const handler = nodeHandlers.get(name);
    if (handler) return handler;
    if (!warnedMissing.has(name)) {
      warnedMissing.add(name);
      // eslint-disable-next-line no-console
      console.warn(
        `[exportPdf] no PDF handler for "${name}" — it will not appear in the PDF. ` +
          `Ensure the contributing extension is enabled on the editor passed to exportToPdf/buildPdf.`,
      );
    }
    return undefined;
  };

  // ── Phase 2: Build PDF document + assets ───────────────────────────────
  const { pageConfig } = layout;
  const pageWidthPt = pageConfig.pageWidth * PT_PER_PX;
  const pageHeightPt = pageConfig.pageHeight * PT_PER_PX;

  const pdfDoc = prepared?.doc ?? await PDFDocument.create();

  const fontRegistry = prepared?.fonts ?? createFontRegistry(
    await embedStandardFonts(pdfDoc), await embedResolvedFonts(pdfDoc, layout),
  );
  const imageCache = await embedImages(
    pdfDoc,
    layout,
    options?.resolveImage ?? createDefaultImageResolver(options?.onImageRefused),
  );

  // Mutable page ref — updated per page in the loop. Draw helpers read lazily.
  let currentPage: PDFPage = null!;
  const getPage = () => currentPage;

  // Resolved before the draw helpers, which paint the image placeholder from it.
  // Defaults are always print-ready; the caller's `theme` option (literal
  // colours only) shallow-merges over them. `editor.theme` is deliberately
  // ignored so a dark canvas still produces a printable PDF.
  const resolvedTheme: ResolvedTheme = { ...defaultPdfTheme, ...(options?.theme ?? {}) };

  const draw = createDrawHelpers(
    getPage,
    pageHeightPt,
    fontRegistry,
    resolvedTheme,
    prepared?.fitToMeasuredWidth ?? false,
    imageCache,
    resolveNodeHandler,
    markHandlers,
  );

  // ── Phase 3: Build context shell ───────────────────────────────────────
  /**
   * The single route from a block to its paint. Defined here because it closes
   * over the collected handlers, and hung on the context so nested content and
   * chrome reach the same one rather than each re-deriving it.
   */
  const renderBlocks = (blocks: readonly LayoutBlock[]): void => {
    for (const block of blocks) {
      const handler = resolveNodeHandler(block.node.type.name);
      if (!handler) continue;
      const { x, y, width } = ctx;
      ctx.x = block.x;
      ctx.y = block.y;
      ctx.width = block.width;
      try {
        handler(block, ctx);
      } finally {
        // Nested dispatch must return the caller's box, even if a child fails.
        ctx.x = x;
        ctx.y = y;
        ctx.width = width;
      }
    }
  };

  const ctx: PdfContext = {
    doc: pdfDoc,
    page: null!,
    layoutPage: null!,
    layout,
    x: 0,
    y: 0,
    width: 0,
    fonts: fontRegistry,
    images: imageCache,
    draw,
    blocks: renderBlocks,
    editor,
    theme: resolvedTheme,
  };

  // ── Phase 4: Pre-export hooks ──────────────────────────────────────────
  for (const hook of lifecycleHooks.before) {
    await hook(ctx);
  }

  // ── Phase 5: Walk pages, dispatch handlers ─────────────────────────────
  for (let i = 0; i < layout.pages.length; i++) {
    const layoutPage = layout.pages[i]!;
    const pageNumber = i + 1;

    currentPage = pdfDoc.addPage([pageWidthPt, pageHeightPt]);
    ctx.page = currentPage;
    ctx.layoutPage = layoutPage;

    // Page background — pdf-lib's default is white, so themed exports must
    // explicitly paint pageBg or a dark `theme.pageBg` would be invisible.
    currentPage.drawRectangle({
      x: 0,
      y: 0,
      width: pageWidthPt,
      height: pageHeightPt,
      color: parseCssColor(resolvedTheme.pageBg),
    });

    // Anchored objects behind blocks
    const pageObjects = (layout.anchoredObjects ?? [])
      .filter((o) => o.page === pageNumber)
      .sort(compareAnchoredObjectPaintOrder);
    ctx.blocks(
      pageObjects.filter((object) => object.wrapMode === "behind").map(anchoredBlock),
    );

    ctx.blocks(layoutPage.blocks);

    // Anchored objects in front of (or alongside) blocks
    ctx.blocks(
      pageObjects.filter((object) => object.wrapMode !== "behind").map(anchoredBlock),
    );

    // Chrome handlers (headers, footers, etc.)
    for (const [chromeName, chromeHandler] of chromeHandlers) {
      const payload = layout.chromePayloads && Object.hasOwn(layout.chromePayloads, chromeName)
        ? layout.chromePayloads[chromeName]
        : undefined;
      chromeHandler(layoutPage, payload, ctx);
    }
  }

  // ── Phase 6: Post-export hooks ─────────────────────────────────────────
  for (const hook of lifecycleHooks.after) {
    await hook(ctx);
  }

  // ── Phase 7: Describe the file, then save ──────────────────────────────
  // After the pages exist, because a bookmark's destination names the page
  // object it jumps to.
  applyMetadata(pdfDoc, options?.metadata);
  if (options?.outline !== false) addHeadingOutline(pdfDoc, layout);
  return pdfDoc.save();
}

// ── Anchored objects ────────────────────────────────────────────────────────

/**
 * An anchored object as the block it is: one leaf, no lines, at its own box.
 *
 * The pipeline owns where it sits — that is what `AnchoredObjectPlacement`
 * settled — and its extension owns what it looks like. Drawing it here instead
 * meant every anchored object was assumed to be an image, so anything else
 * anchored would have painted nothing at all.
 */
function anchoredBlock(object: AnchoredObjectPlacement): LayoutBlock {
  return {
    kind: "leaf",
    node: object.node,
    nodePos: object.docPos,
    x: object.x,
    y: object.y,
    width: object.width,
    height: object.height,
    lines: [],
    spaceBefore: 0,
    spaceAfter: 0,
    blockType: object.node.type.name,
    align: "left",
    availableWidth: object.width,
  };
}

// ── Image embedding ──────────────────────────────────────────────────────────

async function embedImages(
  pdfDoc: PDFDocument,
  layout: DocumentLayout,
  resolveImage: ImageResolver,
): Promise<Map<string, PDFImage | null>> {
  const srcs = new Set<string>();

  for (const object of layout.anchoredObjects ?? []) {
    const src = object.node.attrs["src"] as string | undefined;
    if (src) srcs.add(src);
  }

  const collectFromBlock = (block: DocumentLayout["pages"][0]["blocks"][number]) => {
    for (const cell of block.cells ?? []) {
      for (const child of cell.blocks) collectFromBlock(child);
    }

    if (block.node.type.name === "image") {
      const src = block.node.attrs["src"] as string | undefined;
      if (src) srcs.add(src);
    }

    for (const line of block.lines) {
      for (const span of line.spans) {
        if (span.kind === "object" && span.node.type.name === "image") {
          const src = span.node.attrs["src"] as string | undefined;
          if (src) srcs.add(src);
        }
      }
    }
  };

  const collectFromBlocks = (blocks: readonly DocumentLayout["pages"][0]["blocks"][number][]) => {
    for (const block of blocks) {
      collectFromBlock(block);
    }
  };

  // Body content
  for (const page of layout.pages) {
    collectFromBlocks(page.blocks);
  }

  // A header or footer may hold an image of its own, and it is the same walk
  // core's font lane makes — one reader, so the two cannot drift apart again.
  collectFromBlocks(chromeBlocks(layout.chromePayloads));

  const result = new Map<string, PDFImage | null>();

  await Promise.all(
    Array.from(srcs).map(async (src) => {
      const fetched = await resolveImage(src);
      if (!fetched) {
        result.set(src, null);
        return;
      }
      try {
        const image =
          fetched.format === "png"
            ? await pdfDoc.embedPng(fetched.bytes)
            : await pdfDoc.embedJpg(fetched.bytes);
        result.set(src, image);
      } catch {
        result.set(src, null);
      }
    }),
  );

  return result;
}
