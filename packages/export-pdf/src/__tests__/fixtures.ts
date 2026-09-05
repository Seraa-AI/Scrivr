import { ServerEditor, StarterKit } from "@scrivr/core";
import type { DocumentLayout, LayoutBlock, LayoutLine } from "@scrivr/core";

/**
 * Layouts for the op-log baseline — one per rendering behaviour the PDF
 * exporter has today.
 *
 * They are written out rather than produced by the layout engine on purpose:
 * a baseline that depends on real font metrics moves when CI's fonts differ
 * from a laptop's, and a baseline that moves for reasons unrelated to the
 * change under test is one nobody trusts. Everything here is fixed numbers.
 */

export const exportEditor = new ServerEditor({
  extensions: [StarterKit.configure({ table: true })],
});

export const schema = exportEditor.getState().schema;

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 72;
export const AVAIL_W = PAGE_W - MARGIN * 2;

export const PAGE_CONFIG = {
  pageWidth: PAGE_W,
  pageHeight: PAGE_H,
  margins: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
};

export interface SpanMark {
  name: string;
  attrs: Record<string, unknown>;
}

export function textLine(
  text: string,
  opts: { x?: number; marks?: SpanMark[]; font?: string; positioned?: boolean } = {},
): LayoutLine {
  const x = opts.x ?? 0;
  const width = text.length * 9;
  return {
    spans: [
      {
        kind: "text",
        text,
        font: opts.font ?? "16px Helvetica",
        x,
        width,
        docPos: 0,
        ...(opts.marks ? { marks: opts.marks } : {}),
      },
    ],
    width: x + width,
    lineHeight: 24,
    ascent: 18,
    descent: 6,
    cursorHeight: 20,
    textAscent: 18,
    xHeight: 8,
    ...(opts.positioned
      ? { positioned: true, segments: [{ x, width: AVAIL_W - x }] }
      : {}),
  } as unknown as LayoutLine;
}

export function block(
  nodeType: string,
  lines: LayoutLine[],
  opts: { y?: number; align?: LayoutBlock["align"]; listMarker?: string; attrs?: Record<string, unknown> } = {},
): LayoutBlock {
  const type = schema.nodes[nodeType];
  if (!type) throw new Error(`fixture: schema has no \`${nodeType}\``);
  return {
    kind: lines.length > 0 ? "text" : "leaf",
    node: type.createAndFill(opts.attrs ?? null)!,
    nodePos: 0,
    x: MARGIN,
    y: opts.y ?? MARGIN,
    width: AVAIL_W,
    height: lines.reduce((sum, line) => sum + line.lineHeight, 0) || 24,
    lines,
    spaceBefore: 0,
    spaceAfter: 0,
    blockType: nodeType,
    align: opts.align ?? "left",
    availableWidth: AVAIL_W,
    ...(opts.listMarker ? { listMarker: opts.listMarker } : {}),
  } as unknown as LayoutBlock;
}

export function layout(
  pages: LayoutBlock[][],
  anchoredObjects: DocumentLayout["anchoredObjects"] = [],
): DocumentLayout {
  return {
    pages: pages.map((blocks, index) => ({ pageNumber: index + 1, blocks })),
    pageConfig: PAGE_CONFIG,
    version: 1,
    totalContentHeight: PAGE_H * pages.length,
    anchoredObjects,
    fragments: [],
  } as unknown as DocumentLayout;
}

/** One page holding a single block — the common shape. */
export function onePage(blocks: LayoutBlock[]): DocumentLayout {
  return layout([blocks]);
}

/** A table row with a shaded cell and a horizontal merge, for the table lane. */
export function tableRowBlock(): LayoutBlock {
  const cell = (
    x: number,
    width: number,
    opts: { background?: string; vMerge?: string } = {},
  ) => ({
    cellPos: 1,
    x,
    y: 0,
    width,
    height: 40,
    vMerge: opts.vMerge ?? "none",
    background: opts.background ?? null,
    blocks: [block("paragraph", [textLine("Cell")])],
  });

  return {
    ...block("tableRow", []),
    cells: [
      cell(MARGIN, 240, { background: "rgb(238, 238, 238)" }),
      cell(MARGIN + 240, 120, { vMerge: "continue" }),
    ],
    isLastRow: true,
  } as unknown as LayoutBlock;
}
