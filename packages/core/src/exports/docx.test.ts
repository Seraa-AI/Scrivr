import { describe, expect, it } from "vitest";
import { cssColorToDocxHex, docxHighlightName } from "./docx";

describe("DOCX color helpers", () => {
  it("normalizes common CSS colors to DOCX hex", () => {
    expect(cssColorToDocxHex("#dc2626")).toBe("DC2626");
    expect(cssColorToDocxHex("#abc")).toBe("AABBCC");
    expect(cssColorToDocxHex("rgb(220, 38, 38)")).toBe("DC2626");
  });

  // The colours a document actually carries are not all hex: pasted text keeps
  // whatever its source declared, and a browser hands back `rgb(...)`.
  it("reads every colour spelling a document can carry", () => {
    expect(cssColorToDocxHex("red")).toBe("FF0000");
    expect(cssColorToDocxHex("rebeccapurple")).toBe("663399");
    expect(cssColorToDocxHex("rgb(220 38 38)")).toBe("DC2626");
    expect(cssColorToDocxHex("hsl(0, 100%, 50%)")).toBe("FF0000");
  });

  // DOCX has no alpha, and a document with no background is read on a white
  // page — so a translucent colour is written as what the reader sees.
  it("composites a translucent colour onto the page", () => {
    expect(cssColorToDocxHex("rgba(255, 220, 0, 0.4)")).toBe("FFF199");
    expect(cssColorToDocxHex("rgba(0, 0, 0, 0)")).toBeNull();
  });

  // DOCX writes `w:val="FF0000"`, and the import path reads it back through
  // this same helper.
  it("reads DOCX's own hex spelling, which carries no leading hash", () => {
    expect(cssColorToDocxHex("FF0000")).toBe("FF0000");
    expect(cssColorToDocxHex("dc2626")).toBe("DC2626");
  });

  it("rejects a value that is not a colour", () => {
    expect(cssColorToDocxHex("hotpinkish")).toBeNull();
    expect(cssColorToDocxHex("var(--brand)")).toBeNull();
  });

  it("returns canonical OOXML highlight names", () => {
    expect(docxHighlightName("yellow")).toBe("yellow");
    expect(docxHighlightName("darkgray")).toBe("darkGray");
    expect(docxHighlightName("#ffdc00")).toBeNull();
  });
});
