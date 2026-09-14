/**
 * Which face the PDF paints with.
 *
 * The exporter used to derive a font from the family name in the span's CSS
 * string — a second, independent answer to a question layout had already
 * settled. A document measured in one face and painted in another puts every
 * glyph at coordinates computed for different metrics, which is what made
 * spans overlap and swallow the spaces between them.
 *
 * So the thing worth asserting is precedence: the layout's own resolution is
 * consulted first, and the name-based guess only survives where nothing
 * resolved anything.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PDFDocument } from "pdf-lib";
import type { DocumentLayout, FontResource, IEditor } from "@scrivr/core";
import { DefaultFontProvider, ServerEditor, StarterKit } from "@scrivr/core";
import { exportToPdf } from "../index";
import { block, onePage, textLine } from "./fixtures";
import { embedStandardFonts, resolveFont, embedResolvedFonts } from "../fonts";

const standard = await embedStandardFonts(await PDFDocument.create());

/**
 * A real typeface, resolved through node_modules rather than an OS path: these
 * assertions are about embedding actual font bytes, and a path that only
 * exists on one developer's platform makes them pass there and nowhere else.
 */
const fontPath = createRequire(import.meta.url).resolve(
  "@fontsource/inter/files/inter-latin-400-normal.woff2",
);
const realFontBytes = (): ArrayBuffer => {
  const b = readFileSync(fontPath);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

const resource = (
  id: string,
  overrides: Partial<FontResource> = {},
): FontResource => ({
  id,
  family: id,
  weight: 400,
  style: "normal",
  bytes: vi.fn(() => Promise.resolve(realFontBytes())),
  ...overrides,
});

/** A layout that resolved its spans to the given resources, one id each. */
const layoutWith = (...resources: FontResource[]): DocumentLayout =>
  ({
    fontResolutions: new Map(
      resources.map((res, id) => [
        id,
        {
          request: { family: "Aptos", weight: 400, style: "normal", size: 14 },
          resolved: { family: res.family, source: "default", portable: true },
          resource: res,
        },
      ]),
    ),
  }) as unknown as DocumentLayout;

describe("choosing the face a span is painted in", () => {
  it("uses the face the layout measured, not the one the name suggests", () => {
    const measured = standard["mono_normal"]!;
    // The CSS string says Georgia, which the name-based guess maps to Times.
    const font = resolveFont("14px Georgia", standard, new Map([[0, measured]]), 0);
    expect(font).toBe(measured);
    expect(font).not.toBe(standard["serif_normal"]);
  });

  it("falls back to the name when the span carries no resolution", () => {
    expect(resolveFont("14px Georgia", standard, new Map(), undefined))
      .toBe(standard["serif_normal"]);
  });

  it("falls back to the name when the resolution could not be embedded", () => {
    // An id with no entry in the map is a face whose bytes never made it in.
    expect(resolveFont("14px Georgia", standard, new Map(), 7))
      .toBe(standard["serif_normal"]);
  });
});

describe("embedding the faces a layout measured", () => {
  it("never reads the bytes of a face whose licence forbids embedding", async () => {
    const denied = resource("Restricted", {
      embedding: { allowed: false, source: "font-metadata" },
    });
    const embedded = await embedResolvedFonts(await PDFDocument.create(), layoutWith(denied));

    expect(denied.bytes).not.toHaveBeenCalled();
    expect(embedded.size).toBe(0);
  });

  it("reads a face once however many resolutions name it", async () => {
    // Two requests can resolve to one set of bytes — a weight nobody supplied
    // answered by the one that exists.
    const shared = resource("App Sans");
    await embedResolvedFonts(await PDFDocument.create(), layoutWith(shared, shared));

    expect(shared.bytes).toHaveBeenCalledTimes(1);
  });

  it("claims nothing when the layout resolved nothing", async () => {
    const embedded = await embedResolvedFonts(
      await PDFDocument.create(),
      {} as unknown as DocumentLayout,
    );
    expect(embedded.size).toBe(0);
  });

  it("rejects bytes that will not embed", async () => {
    const junk = resource("Corrupt", { bytes: vi.fn(() => Promise.resolve(new ArrayBuffer(8))) });
    await expect(embedResolvedFonts(await PDFDocument.create(), layoutWith(junk))).rejects.toThrow("Cannot embed font Corrupt");
    expect(junk.bytes).toHaveBeenCalled();
  });
});

describe("what an export asks the provider for", () => {
  /** A real editor, with only the layout a headless one cannot produce supplied. */
  const exportable = (editor: ServerEditor, layout: DocumentLayout, family = "Aptos"): IEditor =>
    new Proxy(editor, {
      get: (target, prop) =>
        prop === "layout"
          ? layout
          : prop === "ensureFullLayout"
            ? () => {}
            : prop === "layoutForExport"
              ? (_doc: unknown, fonts: { resolve: (css: string) => unknown }) => { fonts.resolve(`14px ${family}`); return layout; }
            : Reflect.get(target, prop),
    }) as unknown as IEditor;

  const editorAskingFor = (family: string) => {
    const provider = new DefaultFontProvider({ default: resource("App Sans") });
    const editor = new ServerEditor({
      extensions: [StarterKit.configure({ table: true })],
      fonts: provider,
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", marks: [{ type: "fontFamily", attrs: { family } }], text: "Fees" },
            ],
          },
        ],
      },
    });
    return { editor, provider };
  };

  it("asks for faces it can both carry and embed", async () => {
    const { editor, provider } = editorAskingFor("Aptos");
    const prepare = vi.spyOn(provider, "prepare");

    await exportToPdf(exportable(editor, onePage([block("paragraph", [textLine("Fees")])])));

    // A face this machine merely has is no use inside the file, and one whose
    // licence forbids embedding must not go in it.
    expect(prepare).toHaveBeenCalledWith(expect.anything(), {
      portable: true,
      embeddable: true,
    });
  });

  it("reports the faces it could not honour", async () => {
    const { editor } = editorAskingFor("Aptos");
    const onFontShortfall = vi.fn();

    await exportToPdf(
      exportable(editor, onePage([block("paragraph", [textLine("Fees")])])),
      { onFontShortfall },
    );

    expect(onFontShortfall).toHaveBeenCalledWith([
      expect.objectContaining({
        request: expect.objectContaining({ family: "Aptos" }),
        resolved: expect.objectContaining({ family: "App Sans" }),
        source: "default",
      }),
    ]);
  });

  it("says nothing when every face was honoured", async () => {
    const { editor } = editorAskingFor("App Sans");
    const onFontShortfall = vi.fn();

    await exportToPdf(
      exportable(editor, onePage([block("paragraph", [textLine("Fees")])]), "App Sans"),
      { onFontShortfall },
    );

    expect(onFontShortfall).not.toHaveBeenCalled();
  });
});
