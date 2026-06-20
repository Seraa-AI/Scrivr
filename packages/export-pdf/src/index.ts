// Side-effect: augments FormatHandlers with the "pdf" key.
import "./augmentation";

export { PdfExport } from "./PdfExport";
export type { PdfHandlers, PdfNodeHandler, PdfMarkHandler, PdfChromeHandler, PdfSpanStyle } from "./augmentation";
export type { PdfContext, PdfFontRegistry, PdfDrawHelpers } from "./context";

import { PDFDocument, type PDFPage, type PDFImage } from "pdf-lib";
import type {
  IEditor,
  IBaseEditor,
  DocumentLayout,
  AnchoredObjectPlacement,
  ResolvedTheme,
} from "@scrivr/core";
import { compareAnchoredObjectPaintOrder, defaultPdfTheme } from "@scrivr/core";
import type { PdfNodeHandler, PdfChromeHandler } from "./augmentation";
import { PT_PER_PX, createDrawHelpers, parseCssColor } from "./context";
import type { PdfContext } from "./context";
import {
  embedStandardFonts,
  embedCustomFonts,
  createFontRegistry,
} from "./fonts";
import { defaultNodeHandlers, defaultMarkHandlers } from "./defaults";

/** Public types */

export interface PdfExportOptions {
  /**
   * Called once per unique (family, weight, style) combination found in the
   * document. Return the font file bytes to embed it; return null to fall back
   * to the nearest standard font (Helvetica / Times / Courier).
   */
  fontResolver?: (
    family: string,
    weight: "normal" | "bold",
    style: "normal" | "italic",
  ) => Promise<ArrayBuffer | null>;
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
  return buildPdf(editor.layout, editor, options);
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
  // ── Phase 1: Collect handlers ──────────────────────────────────────────
  const nodeHandlers: Record<string, PdfNodeHandler> = { ...defaultNodeHandlers };
  const chromeHandlers: Record<string, PdfChromeHandler<unknown>> = {};
  const lifecycleHooks: {
    before: Array<(ctx: PdfContext) => void | Promise<void>>;
    after: Array<(ctx: PdfContext) => void | Promise<void>>;
  } = { before: [], after: [] };

  for (const contrib of editor.getExportContributions()) {
    const pdfContrib = contrib.pdf;
    if (!pdfContrib) continue;
    if (pdfContrib.nodes) Object.assign(nodeHandlers, pdfContrib.nodes);
    if (pdfContrib.chrome) Object.assign(chromeHandlers, pdfContrib.chrome);
    if (pdfContrib.onBeforeExport) lifecycleHooks.before.push(pdfContrib.onBeforeExport);
    if (pdfContrib.onAfterExport) lifecycleHooks.after.push(pdfContrib.onAfterExport);
  }

  // ── Phase 2: Build PDF document + assets ───────────────────────────────
  const { pageConfig } = layout;
  const pageWidthPt = pageConfig.pageWidth * PT_PER_PX;
  const pageHeightPt = pageConfig.pageHeight * PT_PER_PX;

  const pdfDoc = await PDFDocument.create();

  const standardFonts = await embedStandardFonts(pdfDoc);
  const customFonts = options?.fontResolver
    ? await embedCustomFonts(pdfDoc, layout, options.fontResolver)
    : new Map();

  const fontRegistry = createFontRegistry(standardFonts, customFonts);
  const imageCache = await embedImages(pdfDoc, layout);

  // Mutable page ref — updated per page in the loop. Draw helpers read lazily.
  let currentPage: PDFPage = null!;
  const getPage = () => currentPage;

  const draw = createDrawHelpers(
    getPage,
    pageHeightPt,
    fontRegistry,
    nodeHandlers,
    defaultMarkHandlers,
  );

  // Resolve PDF theme: defaults are always print-ready; caller's `theme`
  // option (literal colors only) shallow-merges over them. We deliberately
  // ignore `editor.theme` so a dark canvas still produces a printable PDF.
  const resolvedTheme: ResolvedTheme = { ...defaultPdfTheme, ...(options?.theme ?? {}) };

  // ── Phase 3: Build context shell ───────────────────────────────────────
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
    editor,
    theme: resolvedTheme,
  };

  // ── Phase 4: Pre-export hooks ──────────────────────────────────────────
  for (const hook of lifecycleHooks.before) {
    await hook(ctx);
  }

  // ── Phase 5: Walk pages, dispatch handlers ─────────────────────────────
  // A block type with no handler is skipped (renders blank). Warn once per type
  // so the gap is loud rather than silent (e.g. an extension that wasn't enabled
  // on the editor).
  const warnedMissing = new Set<string>();
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
    for (const object of pageObjects) {
      if (object.wrapMode === "behind") {
        drawPdfAnchoredObject(currentPage, object, pageHeightPt, imageCache, resolvedTheme);
      }
    }

    // Block dispatch
    for (const block of layoutPage.blocks) {
      const handler = nodeHandlers[block.node.type.name];
      if (handler) {
        ctx.x = block.x;
        ctx.y = block.y;
        ctx.width = block.width;
        handler(block, ctx);
      } else if (!warnedMissing.has(block.node.type.name)) {
        warnedMissing.add(block.node.type.name);
        // eslint-disable-next-line no-console
        console.warn(
          `[exportPdf] no PDF handler for "${block.node.type.name}" — it will not appear in the PDF. ` +
            `Ensure the contributing extension is enabled on the editor passed to exportToPdf/buildPdf.`,
        );
      }
    }

    // Anchored objects in front of (or alongside) blocks
    for (const object of pageObjects) {
      if (object.wrapMode !== "behind") {
        drawPdfAnchoredObject(currentPage, object, pageHeightPt, imageCache, resolvedTheme);
      }
    }

    // Chrome handlers (headers, footers, etc.)
    for (const [chromeName, chromeHandler] of Object.entries(chromeHandlers)) {
      const payload = layout.chromePayloads?.[chromeName];
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

// ── Anchored-object rendering (not dispatched — part of core pipeline) ──────

function drawPdfAnchoredObject(
  page: PDFPage,
  object: AnchoredObjectPlacement,
  pageHeightPt: number,
  imageCache: Map<string, PDFImage | null>,
  theme: ResolvedTheme,
): void {
  const src = object.node.attrs["src"] as string | undefined;
  const x = object.x * PT_PER_PX;
  const y = flipY(object.y + object.height, pageHeightPt);
  const w = object.width * PT_PER_PX;
  const h = object.height * PT_PER_PX;

  if (src) {
    const image = imageCache.get(src);
    if (image) {
      page.drawImage(image, { x, y, width: w, height: h });
      return;
    }
  }

  // Placeholder for missing/failed images — themed to match canvas behaviour.
  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    borderColor: parseCssColor(theme.imagePlaceholderBorder),
    borderWidth: 1,
    color: parseCssColor(theme.imagePlaceholderBg),
  });
}

// ── Image embedding ──────────────────────────────────────────────────────────

async function fetchImageBytes(
  src: string,
): Promise<{ bytes: Uint8Array; format: "png" | "jpeg" } | null> {
  try {
    if (src.startsWith("data:")) {
      const [header, b64] = src.split(",") as [string, string];
      const format: "png" | "jpeg" = header.includes("png") ? "png" : "jpeg";
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return { bytes, format };
    }

    const res = await fetch(src);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const format: "png" | "jpeg" =
      bytes[0] === 0x89 && bytes[1] === 0x50 ? "png" : "jpeg";
    return { bytes, format };
  } catch {
    return null;
  }
}

async function embedImages(
  pdfDoc: PDFDocument,
  layout: DocumentLayout,
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

  const collectFromBlocks = (blocks: DocumentLayout["pages"][0]["blocks"]) => {
    for (const block of blocks) {
      collectFromBlock(block);
    }
  };

  // Body content
  for (const page of layout.pages) {
    collectFromBlocks(page.blocks);
  }

  // Chrome payloads (header/footer mini-layouts may contain inline images)
  if (layout.chromePayloads) {
    for (const payload of Object.values(layout.chromePayloads)) {
      if (typeof payload === "object" && payload !== null && "slots" in payload) {
        const slots = (payload as { slots: Record<string, { layout?: { pages?: Array<{ blocks: DocumentLayout["pages"][0]["blocks"] }> } }> }).slots;
        for (const slot of Object.values(slots)) {
          if (slot?.layout?.pages) {
            for (const page of slot.layout.pages) {
              collectFromBlocks(page.blocks);
            }
          }
        }
      }
    }
  }

  const result = new Map<string, PDFImage | null>();

  await Promise.all(
    Array.from(srcs).map(async (src) => {
      const fetched = await fetchImageBytes(src);
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function flipY(yPx: number, pageHeightPt: number): number {
  return pageHeightPt - yPx * PT_PER_PX;
}
