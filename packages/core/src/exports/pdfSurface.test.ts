import { describe, it, expect } from "vitest";
// Imported through the package barrel on purpose: these are the types an
// extension writes a PDF mark handler against, and `tsc` fails here the moment
// one stops being exported.
import { defaultEditorTheme } from "../model/theme";
import type {
  PdfBox,
  PdfDrawSurface,
  PdfFontHandle,
  PdfImageHandle,
  PdfImageOp,
  PdfLineOp,
  PdfPoint,
  PdfRectOp,
  PdfTextOp,
  PdfMarkContext,
  PdfMarkHandler,
  PdfSpanMark,
  PdfSpanStyle,
} from "../index";

describe("the PDF mark contract an extension writes against", () => {
  it("is enough to author a handler", () => {
    // Naming the type is what buys the check: the `pdf` key itself is
    // unconstrained inside core, so an unannotated handler would be accepted
    // whatever shape it had.
    const handler: PdfMarkHandler = (mark: PdfSpanMark, ctx: PdfMarkContext) => {
      const chosen = mark.attrs["color"];
      const style: PdfSpanStyle =
        typeof chosen === "string"
          ? { color: chosen }
          : { defaultColor: ctx.theme.link, underline: true, underlineColor: ctx.theme.link };
      return style;
    };

    const ctx: PdfMarkContext = { theme: defaultEditorTheme };
    expect(handler({ name: "link", attrs: {} }, ctx)).toEqual({
      defaultColor: defaultEditorTheme.link,
      underline: true,
      underlineColor: defaultEditorTheme.link,
    });
  });

  it("is enough to author a node handler that draws", () => {
    // Every op a handler constructs, named through the barrel. Drop one from
    // the export list and this file stops compiling.
    const drawn: string[] = [];
    const surface: PdfDrawSurface = {
      text: (op: PdfTextOp) => drawn.push(`text:${op.text}`),
      line: (op: PdfLineOp) => drawn.push(`line:${op.from.x}->${op.to.x}`),
      rect: (op: PdfRectOp) => drawn.push(`rect:${op.width}`),
      image: (op: PdfImageOp) => drawn.push(`image:${op.image.src}`),
      imagePlaceholder: (box: PdfBox) => drawn.push(`placeholder:${box.width}`),
    };

    const from: PdfPoint = { x: 0, y: 10 };
    const font: PdfFontHandle = { cssFont: "12px sans-serif" };
    const image: PdfImageHandle = { src: "a.png" };

    surface.text({ text: "hi", x: 0, baselineY: 10, sizePx: 12, font, color: { r: 0, g: 0, b: 0 } });
    surface.line({ from, to: { x: 20, y: 10 }, thicknessPx: 1, color: { r: 0, g: 0, b: 0 } });
    surface.rect({ x: 0, y: 0, width: 5, height: 5, color: { r: 1, g: 2, b: 3 } });
    surface.image({ x: 0, y: 0, width: 5, height: 5, image });
    surface.imagePlaceholder({ x: 0, y: 0, width: 5, height: 5 });

    expect(drawn).toEqual(["text:hi", "line:0->20", "rect:5", "image:a.png", "placeholder:5"]);
  });
});
