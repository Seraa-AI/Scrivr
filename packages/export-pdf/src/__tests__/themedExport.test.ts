/**
 * PDF theming — verifies the print-default-vs-override contract:
 *
 * 1. exportToPdf() with no theme uses the print-ready `defaultPdfTheme`
 *    regardless of `editor.theme` (REGRESSION CRITICAL).
 * 2. exportToPdf({ theme }) shallow-merges over `defaultPdfTheme`.
 * 3. ServerEditor + literal-only theme works server-side (no DOM, no resolver).
 */
import { describe, it, expect, vi } from "vitest";
import { Schema } from "prosemirror-model";
import { ServerEditor, StarterKit, defaultPdfTheme } from "@scrivr/core";
import type { DocumentLayout, LayoutBlock, LayoutLine } from "@scrivr/core";
import { buildPdf as buildPdfWithEditor, type PdfExportOptions } from "../index";

// buildPdf requires an editor (collects PDF handlers via getExportContributions).
const exportEditor = new ServerEditor({ extensions: [StarterKit] });
const buildPdf = (layout: DocumentLayout, options?: PdfExportOptions) =>
  buildPdfWithEditor(layout, exportEditor, options);

// ── Layout fixture helpers ────────────────────────────────────────────────────

const PAGE_W = 794;
const PAGE_H = 1123;
const MARGIN = 72;
const AVAIL_W = PAGE_W - 2 * MARGIN;

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    text: { group: "inline" },
  },
  marks: {},
});

const PAGE_CONFIG = {
  pageWidth: PAGE_W,
  pageHeight: PAGE_H,
  margins: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
};

function textLine(text: string): LayoutLine {
  return {
    spans: [{ kind: "text", text, font: "16px Helvetica", x: 0, width: text.length * 9, docPos: 0 }],
    width: text.length * 9,
    lineHeight: 24,
    ascent: 18,
    descent: 6,
    cursorHeight: 20,
    textAscent: 18,
    xHeight: 8,
  };
}

function paragraphBlock(lines: LayoutLine[]): LayoutBlock {
  return {
    kind: "text",
    node: schema.nodes.paragraph!.create(),
    nodePos: 0,
    x: MARGIN,
    y: MARGIN,
    width: AVAIL_W,
    height: lines.reduce((s, l) => s + l.lineHeight, 0),
    lines,
    spaceBefore: 0,
    spaceAfter: 0,
    blockType: "paragraph",
    align: "left",
    availableWidth: AVAIL_W,
  };
}

function buildLayout(blocks: LayoutBlock[] = []): DocumentLayout {
  return {
    pages: [{ pageNumber: 1, blocks }],
    pageConfig: PAGE_CONFIG,
    version: 1,
    totalContentHeight: PAGE_H,
    anchoredObjects: [],
    fragments: [],
  };
}

function byteEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("buildPdf — theme defaults", () => {
  it("produces a non-empty PDF binary with the default print theme", async () => {
    const bytes = await buildPdf(buildLayout());
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("default path produces different bytes than a dark-theme override (proves default ≠ override)", async () => {
    // The point of this test: default path uses defaultPdfTheme; override
    // path uses caller-provided colors. If the bytes are identical, the
    // override isn't reaching the PDF — REGRESSION CRITICAL.
    const layout = buildLayout([paragraphBlock([textLine("Hello world")])]);
    const defaultBytes = await buildPdf(layout);
    const darkBytes = await buildPdf(layout, {
      theme: { pageBg: "#1e1e1e", defaultText: "#e0e0e0", link: "#60a5fa" },
    });
    expect(defaultBytes).toBeInstanceOf(Uint8Array);
    expect(darkBytes).toBeInstanceOf(Uint8Array);
    // Override paints different colors → at least one byte differs in the
    // content stream. If this passes equality, the theme isn't reaching paint.
    expect(byteEquals(defaultBytes, darkBytes)).toBe(false);
  });
});

describe("buildPdf — theme override", () => {
  it("accepts a Partial<ResolvedTheme> override", async () => {
    const bytes = await buildPdf(
      buildLayout(),
      { theme: { pageBg: "#1e1e1e", defaultText: "#e0e0e0" } },
    );
    expect(bytes.length).toBeGreaterThan(0);
  });

  // Functional regression guard: the pageBg token must actually reach paint.
  // Two exports that differ ONLY in pageBg should produce different bytes —
  // earlier the bg rect was never drawn so this would have passed equality.
  it("pageBg-only override changes the PDF output (proves the token reaches paint)", async () => {
    const layout = buildLayout([paragraphBlock([textLine("Hi")])]);
    const a = await buildPdf(layout, { theme: { pageBg: "#1e1e1e" } });
    const b = await buildPdf(layout, { theme: { pageBg: "#abc123" } });
    expect(byteEquals(a, b)).toBe(false);
  });
});

describe("ServerEditor — theme + var() warning", () => {
  it("does not warn for literal-only themes", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    new ServerEditor({
      extensions: [StarterKit],
      theme: { pageBg: "#1e1e1e", defaultText: "#fff" },
    });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("warns when theme contains var(...) values (no DOM to resolve)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    new ServerEditor({
      extensions: [StarterKit],
      theme: { pageBg: "var(--scrivr-page-bg)" },
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("var");
    warn.mockRestore();
  });

  it("defaultPdfTheme is exported from @scrivr/core", () => {
    expect(defaultPdfTheme).toBeDefined();
    expect(defaultPdfTheme.pageBg).toBe("#ffffff");
    expect(defaultPdfTheme.defaultText).toBe("#000000");
  });

  it("getResolvedTheme returns defaults merged with literal overrides (var() entries dropped)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const editor = new ServerEditor({
      extensions: [StarterKit],
      theme: { pageBg: "#1e1e1e", defaultText: "var(--scrivr-text)" },
    });
    const resolved = editor.getResolvedTheme();
    expect(resolved.pageBg).toBe("#1e1e1e");
    // var() entry was dropped; default fills in.
    expect(resolved.defaultText).toBe("#1e293b");
    warn.mockRestore();
  });
});
