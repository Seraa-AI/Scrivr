import { describe, it, expect } from "vitest";
// Imported through the package barrel on purpose: an extension author reaches
// for these here, and `tsc` fails the moment one stops being re-exported.
import { defaultPdfTheme } from "@scrivr/core";
import type {
  PdfBox,
  PdfDrawHelpers,
  PdfDrawSurface,
  PdfFontHandle,
  PdfImageHandle,
  PdfImageOp,
  PdfLineOp,
  PdfMarkHandler,
  PdfPoint,
  PdfRectOp,
  PdfSpanStyle,
  PdfTextOp,
  Rgb,
} from "../index";

describe("the drawing contract an extension writes against", () => {
  it("is enough to author a node handler that draws", () => {
    const drawn: string[] = [];
    const grey: Rgb = { r: 156, g: 163, b: 175 };
    const from: PdfPoint = { x: 0, y: 10 };
    const font: PdfFontHandle = { cssFont: "12px sans-serif" };
    const image: PdfImageHandle = { src: "a.png" };

    const surface: PdfDrawSurface = {
      text: (op: PdfTextOp) => drawn.push(`text:${op.text}`),
      line: (op: PdfLineOp) => drawn.push(`line:${op.to.x}`),
      rect: (op: PdfRectOp) => drawn.push(`rect:${op.border ? "bordered" : "plain"}`),
      image: (op: PdfImageOp) => drawn.push(`image:${op.image.src}`),
      imagePlaceholder: (box: PdfBox) => drawn.push(`placeholder:${box.width}`),
    };

    surface.text({ text: "hi", x: 0, baselineY: 10, sizePx: 12, font, color: grey });
    surface.line({ from, to: { x: 20, y: 10 }, thicknessPx: 1, color: grey });
    surface.rect({ x: 0, y: 0, width: 5, height: 5, border: { color: grey, widthPx: 1 } });
    surface.image({ x: 0, y: 0, width: 5, height: 5, image });
    surface.imagePlaceholder({ x: 0, y: 0, width: 5, height: 5 });

    expect(drawn).toEqual([
      "text:hi",
      "line:20",
      "rect:bordered",
      "image:a.png",
      "placeholder:5",
    ]);
  });

  it("hands a handler a surface it can satisfy", () => {
    // The helpers a handler actually receives are the surface plus `lines`.
    const satisfies = (helpers: PdfDrawHelpers): PdfDrawSurface => helpers;
    expect(typeof satisfies).toBe("function");
  });

  it("still re-exports the mark lane beside the draw lane", () => {
    const style: PdfSpanStyle = { color: "#000" };
    const handler: PdfMarkHandler = () => style;
    expect(handler({ name: "x", attrs: {} }, { theme: defaultPdfTheme })).toBe(style);
  });
});
