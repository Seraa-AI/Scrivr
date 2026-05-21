import { describe, expect, it } from "vitest";
import { cssColorToDocxHex, docxHighlightName } from "./docx";

describe("DOCX color helpers", () => {
  it("normalizes common CSS colors to DOCX hex", () => {
    expect(cssColorToDocxHex("#dc2626")).toBe("DC2626");
    expect(cssColorToDocxHex("#abc")).toBe("AABBCC");
    expect(cssColorToDocxHex("rgb(220, 38, 38)")).toBe("DC2626");
    expect(cssColorToDocxHex("rgba(255, 220, 0, 0.4)")).toBe("FFDC00");
  });

  it("returns canonical OOXML highlight names", () => {
    expect(docxHighlightName("yellow")).toBe("yellow");
    expect(docxHighlightName("darkgray")).toBe("darkGray");
    expect(docxHighlightName("#ffdc00")).toBeNull();
  });
});
