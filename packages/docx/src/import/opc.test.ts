import { describe, it, expect } from "vitest";
import { resolveOpcTarget } from "./opc";

describe("resolveOpcTarget", () => {
  it("resolves a target relative to the source part's directory", () => {
    // Same media referenced from the body and from a header both land in word/.
    expect(resolveOpcTarget("word/document.xml", "media/image1.png")).toBe("word/media/image1.png");
    expect(resolveOpcTarget("word/header1.xml", "media/image1.png")).toBe("word/media/image1.png");
  });

  it("resolves header/footer part references under word/", () => {
    expect(resolveOpcTarget("word/document.xml", "header1.xml")).toBe("word/header1.xml");
  });

  it("walks ../ segments out of the source directory", () => {
    expect(resolveOpcTarget("word/document.xml", "../customXml/item1.xml")).toBe("customXml/item1.xml");
    expect(resolveOpcTarget("word/embeddings/o.bin", "../media/image1.png")).toBe("word/media/image1.png");
  });

  it("treats a leading slash as package-absolute", () => {
    expect(resolveOpcTarget("word/header1.xml", "/word/media/image1.png")).toBe("word/media/image1.png");
  });
});
