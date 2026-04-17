/**
 * Integration tests for buildPdf.
 *
 * Uses buildPdf (lower-level API that takes a pre-computed DocumentLayout)
 * so tests run without a real Editor or DOM.
 */

import { describe, it, expect } from "vitest";
import { Schema } from "prosemirror-model";
import zlib from "node:zlib";
import { buildPdf } from "../index";
import type { DocumentLayout, LayoutBlock, LayoutLine } from "@scrivr/core";

// ── Minimal schema ────────────────────────────────────────────────────────────

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    horizontalRule: { group: "block" },
    image: {
      group: "block",
      attrs: { src: { default: "" }, width: { default: 100 }, height: { default: 100 } },
    },
    text: { group: "inline" },
  },
  marks: {},
});

// ── Layout fixture helpers ────────────────────────────────────────────────────

const PAGE_W = 816;
const PAGE_H = 1056;
const MARGIN = 96;
const AVAIL_W = PAGE_W - 2 * MARGIN;

const PAGE_CONFIG = {
  pageWidth: PAGE_W,
  pageHeight: PAGE_H,
  margins: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
};

function textLine(
  text: string,
  opts: { constraintX?: number; effectiveWidth?: number; font?: string } = {},
): LayoutLine {
  const font = opts.font ?? "16px Helvetica";
  return {
    spans: [{ kind: "text", text, font, x: 0, width: text.length * 9, docPos: 0 }],
    width: text.length * 9,
    lineHeight: 24,
    ascent: 18,
    descent: 6,
    cursorHeight: 20,
    textAscent: 18,
    xHeight: 8,
    ...(opts.constraintX !== undefined && { constraintX: opts.constraintX }),
    ...(opts.effectiveWidth !== undefined && { effectiveWidth: opts.effectiveWidth }),
  };
}

function paragraphBlock(lines: LayoutLine[], y = MARGIN, align: LayoutBlock["align"] = "left"): LayoutBlock {
  return {
    node: schema.nodes.paragraph!.create(),
    nodePos: 0,
    x: MARGIN,
    y,
    width: AVAIL_W,
    height: lines.reduce((s, l) => s + l.lineHeight, 0),
    lines,
    spaceBefore: 0,
    spaceAfter: 0,
    blockType: "paragraph",
    align,
    availableWidth: AVAIL_W,
  };
}

function hrBlock(y = MARGIN + 100): LayoutBlock {
  return {
    node: schema.nodes.horizontalRule!.create(),
    nodePos: 0,
    x: MARGIN,
    y,
    width: AVAIL_W,
    height: 24,
    lines: [],
    spaceBefore: 24,
    spaceAfter: 24,
    blockType: "horizontalRule",
    align: "left",
    availableWidth: AVAIL_W,
  };
}

function makeLayout(
  blocks: LayoutBlock[],
  floats: DocumentLayout["floats"] = [],
): DocumentLayout {
  return {
    pages: [{ pageNumber: 1, blocks }],
    pageConfig: PAGE_CONFIG,
    version: 1,
    totalContentHeight: PAGE_H,
    floats,
    fragments: [],
  };
}

// ── PDF inspection helpers ────────────────────────────────────────────────────

/**
 * Decompress all flate-encoded content streams in a PDF and concatenate them.
 * pdf-lib compresses page content streams with zlib deflate.
 */
function decompressStreams(bytes: Uint8Array): string {
  const binary = Buffer.from(bytes).toString("binary");
  const chunks: string[] = [];
  // Match everything between "stream\r?\n" and "\r?\nendstream"
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(binary)) !== null) {
    const buf = Buffer.from(m[1]!, "binary");
    try {
      chunks.push(zlib.inflateSync(buf).toString("latin1"));
    } catch {
      // Not zlib — include raw (e.g. font programs use different compression)
      chunks.push(m[1]!);
    }
  }
  return chunks.join("\n");
}

/**
 * Decode the hex strings that pdf-lib uses for text operators.
 * Content stream text looks like: <48656C6C6F> Tj
 * Returns all decoded strings found in the content.
 */
function decodeHexStrings(content: string): string[] {
  const results: string[] = [];
  const re = /<([0-9A-Fa-f]+)>\s*Tj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const hex = m[1]!;
    let decoded = "";
    for (let i = 0; i < hex.length; i += 2) {
      decoded += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    }
    results.push(decoded);
  }
  return results;
}

/**
 * Get the font family names actually used on pages, extracted from the Tf
 * (set font) operator in the decompressed content streams.
 *
 * pdf-lib builds resource keys as "<BaseFontName>-<hash>" (e.g.
 * "Helvetica-7098480789"), so stripping the trailing "-<digits>" suffix
 * gives back the BaseFont name.
 */
function getUsedFontNames(bytes: Uint8Array): string[] {
  const content = decompressStreams(bytes);
  const names: string[] = [];
  // Tf operator: /ResourceKey FontSize Tf
  const re = /\/([A-Za-z][\w-]*?)-\d+\s+[\d.]+\s+Tf/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    names.push(m[1]!);
  }
  return names;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("buildPdf", () => {
  it("produces a valid PDF header for a simple paragraph", async () => {
    const layout = makeLayout([paragraphBlock([textLine("Hello world")])]);
    const bytes = await buildPdf(layout);
    expect(Buffer.from(bytes.slice(0, 5)).toString("ascii")).toBe("%PDF-");
  });

  it("embeds text as searchable text operators (BT/ET), not paths", async () => {
    const layout = makeLayout([paragraphBlock([textLine("Hello PDF")])]);
    const bytes = await buildPdf(layout);
    const content = decompressStreams(bytes);
    // BT = Begin Text, ET = End Text — present only when text operators are used
    expect(content).toContain("BT");
    expect(content).toContain("ET");
    // Tj = show text operator — proves text is searchable, not rasterized
    expect(content).toContain("Tj");
  });

  it("text content matches the input string", async () => {
    const layout = makeLayout([paragraphBlock([textLine("Hello PDF")])]);
    const bytes = await buildPdf(layout);
    const content = decompressStreams(bytes);
    const decoded = decodeHexStrings(content);
    expect(decoded.join("")).toContain("Hello PDF");
  });

  it("uses Helvetica for default sans-serif font", async () => {
    const layout = makeLayout([paragraphBlock([textLine("Sans text", { font: "16px Helvetica" })])]);
    const bytes = await buildPdf(layout);
    const fontNames = getUsedFontNames(bytes);
    expect(fontNames.some((n) => n.startsWith("Helvetica"))).toBe(true);
  });

  it("uses Times-Roman for serif font", async () => {
    const layout = makeLayout([
      paragraphBlock([textLine("Serif text", { font: "16px Georgia, serif" })]),
    ]);
    const bytes = await buildPdf(layout);
    const fontNames = getUsedFontNames(bytes);
    expect(fontNames.some((n) => n.startsWith("Times"))).toBe(true);
  });

  it("uses Courier for monospace font", async () => {
    const layout = makeLayout([
      paragraphBlock([textLine("Mono text", { font: "14px Courier, monospace" })]),
    ]);
    const bytes = await buildPdf(layout);
    const fontNames = getUsedFontNames(bytes);
    expect(fontNames.some((n) => n.startsWith("Courier"))).toBe(true);
  });

  it("handles multiple text lines without throwing", async () => {
    const lines = [
      textLine("First line of text"),
      textLine("Second line of text"),
      textLine("Third line of text"),
    ];
    const layout = makeLayout([paragraphBlock(lines)]);
    await expect(buildPdf(layout)).resolves.toBeInstanceOf(Uint8Array);
  });

  it("draws a horizontal rule without throwing", async () => {
    const layout = makeLayout([
      paragraphBlock([textLine("Above the rule")]),
      hrBlock(),
      paragraphBlock([textLine("Below the rule")], MARGIN + 150),
    ]);
    await expect(buildPdf(layout)).resolves.toBeInstanceOf(Uint8Array);
  });

  it("handles float-constrained lines (constraintX + effectiveWidth)", async () => {
    const constraintX = 166; // float width + gap
    const effectiveWidth = AVAIL_W - constraintX;
    const lines = [
      textLine("Constrained text line one", { constraintX, effectiveWidth }),
      textLine("Constrained text line two", { constraintX, effectiveWidth }),
      textLine("Full-width line after float"),
    ];
    const layout = makeLayout([paragraphBlock(lines)]);
    await expect(buildPdf(layout)).resolves.toBeInstanceOf(Uint8Array);
  });

  it("float-constrained lines start further right than unconstrained lines", async () => {
    const constraintX = 200;
    const effectiveWidth = AVAIL_W - constraintX;

    const constrained = makeLayout([
      paragraphBlock([textLine("Test line", { constraintX, effectiveWidth })]),
    ]);
    const unconstrained = makeLayout([
      paragraphBlock([textLine("Test line")]),
    ]);

    const [cBytes, uBytes] = await Promise.all([
      buildPdf(constrained),
      buildPdf(unconstrained),
    ]);

    // Extract the Tm (text matrix) operator — "x y Tm" sets the text position.
    // Constrained x should be greater than unconstrained x.
    const extractX = (content: string): number => {
      const m = content.match(/[\d.]+ [\d.]+ [\d.]+ [\d.]+ ([\d.]+) [\d.]+ Tm/);
      return m ? parseFloat(m[1]!) : 0;
    };

    const cx = extractX(decompressStreams(cBytes));
    const ux = extractX(decompressStreams(uBytes));
    expect(cx).toBeGreaterThan(ux);
  });

  it("handles a float image with a data URL", async () => {
    // Minimal 1×1 white PNG as a data URL.
    const png1x1 =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    const float = {
      docPos: 0, page: 1, x: MARGIN, y: MARGIN,
      width: 150, height: 150, mode: "square-right",
      node: schema.nodes.image!.create({ src: png1x1 }),
      anchorBlockY: MARGIN, anchorPage: 1,
    };

    const layout = makeLayout(
      [paragraphBlock([textLine("Text beside the image")])],
      [float],
    );
    await expect(buildPdf(layout)).resolves.toBeInstanceOf(Uint8Array);
  });

  it("handles a float image with an unreachable URL (graceful placeholder)", async () => {
    const float = {
      docPos: 0, page: 1, x: MARGIN, y: MARGIN,
      width: 100, height: 100, mode: "square-left",
      node: schema.nodes.image!.create({ src: "https://unreachable.invalid/img.png" }),
      anchorBlockY: MARGIN, anchorPage: 1,
    };

    const layout = makeLayout(
      [paragraphBlock([textLine("Text beside missing image")])],
      [float],
    );
    await expect(buildPdf(layout)).resolves.toBeInstanceOf(Uint8Array);
  });

  it("renders multiple pages", async () => {
    const layout: DocumentLayout = {
      pages: [
        { pageNumber: 1, blocks: [paragraphBlock([textLine("Page one")])] },
        { pageNumber: 2, blocks: [paragraphBlock([textLine("Page two")])] },
      ],
      pageConfig: PAGE_CONFIG,
      version: 1,
      totalContentHeight: PAGE_H * 2,
      floats: [],
      fragments: [],
    };
    const bytes = await buildPdf(layout);
    const { PDFDocument } = await import("pdf-lib");
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(2);
  });

  it("applies center alignment offset without throwing", async () => {
    const layout = makeLayout([paragraphBlock([textLine("Centered text")], MARGIN, "center")]);
    await expect(buildPdf(layout)).resolves.toBeInstanceOf(Uint8Array);
  });

  it("handles an empty document (no blocks)", async () => {
    const layout = makeLayout([]);
    await expect(buildPdf(layout)).resolves.toBeInstanceOf(Uint8Array);
  });
});
