/**
 * What the exporter does when a document names a font we cannot embed.
 *
 * The standard PDF fonts encode WinAnsi and nothing else, so text bound for
 * one has to be reduced to that repertoire first. The repertoire is not
 * guessed here: it is read back out of pdf-lib's own encoder, so the
 * allowlist and the encoder can never drift apart silently.
 */

import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { buildPdf as buildPdfWithEditor } from "../index";
import type { PdfExportOptions } from "../index";
import { sanitizeForWinAnsi } from "../context";
import { exportEditor, textLine, block, onePage } from "./fixtures";
import type { DocumentLayout } from "@scrivr/core";

const buildPdf = (layout: DocumentLayout, options?: PdfExportOptions) =>
  buildPdfWithEditor(layout, exportEditor, options);

const doc = (text: string, font = "16px Aptos") =>
  onePage([block("paragraph", [textLine(text, { font })], { y: 100 })]);

/** Every codepoint a standard PDF font can actually encode. */
async function encodableCodepoints(): Promise<number[]> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const out: number[] = [];
  for (let cp = 0x20; cp <= 0x2200; cp++) {
    try {
      font.encodeText(String.fromCodePoint(cp));
      out.push(cp);
    } catch {
      // not in the repertoire
    }
  }
  return out;
}

describe("sanitizeForWinAnsi", () => {
  it("keeps every character the encoder accepts", async () => {
    const encodable = await encodableCodepoints();
    const dropped = encodable
      .map((cp) => String.fromCodePoint(cp))
      // soft hyphen and the zero-width set are removed on purpose: invisible.
      .filter((ch) => !/[­]/.test(ch))
      .filter((ch) => sanitizeForWinAnsi(ch) !== ch);
    expect(dropped).toEqual([]);
  });

  it("emits nothing the encoder would reject", async () => {
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    for (let cp = 0x20; cp <= 0x2200; cp++) {
      const sanitized = sanitizeForWinAnsi(String.fromCodePoint(cp));
      expect(() => font.encodeText(sanitized)).not.toThrow();
    }
  });

  it("keeps the euro sign", () => {
    expect(sanitizeForWinAnsi("€1,000")).toBe("€1,000");
  });

  it("replaces characters outside the repertoire", () => {
    // ó survives (Latin-1); Ł and ź do not — Latin Extended-A is not WinAnsi.
    expect(sanitizeForWinAnsi("Łódź")).toBe("?ód?");
    expect(sanitizeForWinAnsi("你好")).toBe("??");
  });
});

describe("a font the registry cannot supply", () => {
  it("exports Latin Extended text instead of throwing", async () => {
    await expect(buildPdf(doc("Łódź w Polsce"))).resolves.toBeInstanceOf(Uint8Array);
    await expect(buildPdf(doc("Plzeň, čaj, řeka"))).resolves.toBeInstanceOf(Uint8Array);
    await expect(buildPdf(doc("İstanbul şey"))).resolves.toBeInstanceOf(Uint8Array);
  });

  it("exports a list marker outside the repertoire instead of throwing", async () => {
    const layout = onePage([
      block("paragraph", [textLine("item", { font: "16px Aptos" })], {
        y: 100,
        listMarker: "",
      }),
    ]);
    await expect(buildPdf(layout)).resolves.toBeInstanceOf(Uint8Array);
  });

  it("reports the substitution", async () => {
    const seen: unknown[] = [];
    await buildPdf(doc("Hello", "16px Aptos"), {
      onFontSubstitution: (info) => seen.push(info),
    });
    expect(seen).toEqual([
      { family: "Aptos", weight: "normal", style: "normal", substitute: "sans" },
    ]);
  });

  it("does not report a substitution for a generic family", async () => {
    const seen: unknown[] = [];
    await buildPdf(doc("Hello", "16px sans-serif"), {
      onFontSubstitution: (info) => seen.push(info),
    });
    expect(seen).toEqual([]);
  });
});
