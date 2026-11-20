import { describe, it, expect } from "vitest";
import { isHtmlElement } from "./isHtmlElement";

describe("isHtmlElement", () => {
  it("is true of an HTML element", () => {
    expect(isHtmlElement(document.createElement("p"))).toBe(true);
  });

  it("is false of an element with no inline style, such as an XML one", () => {
    const xml = new DOMParser().parseFromString("<root><a/></root>", "application/xml");
    expect(isHtmlElement(xml.documentElement)).toBe(false);
  });

  it("is false of text and of non-nodes", () => {
    expect(isHtmlElement(document.createTextNode("t"))).toBe(false);
    expect(isHtmlElement(null)).toBe(false);
    expect(isHtmlElement({ nodeType: 1 })).toBe(false);
  });
});
