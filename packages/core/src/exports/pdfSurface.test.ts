import { describe, it, expect } from "vitest";
// Imported through the package barrel on purpose: these are the types an
// extension writes a PDF mark handler against, and `tsc` fails here the moment
// one stops being exported.
import { defaultEditorTheme } from "../model/theme";
import type {
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
});
