import { describe, it, expect } from "vitest";
import { xml, serializeXml } from "./xml";

describe("xml builder", () => {
  it("produces an empty node", () => {
    expect(xml("w:br")).toEqual({ name: "w:br" });
  });

  it("attaches attributes when provided", () => {
    expect(xml("w:t", { "xml:space": "preserve" })).toEqual({
      name: "w:t",
      attributes: { "xml:space": "preserve" },
    });
  });

  it("attaches children when provided", () => {
    const child = xml("w:r");
    expect(xml("w:p", undefined, [child])).toEqual({
      name: "w:p",
      children: [child],
    });
  });

  it("omits empty attribute / child containers", () => {
    expect(xml("w:p", {}, [])).toEqual({ name: "w:p" });
  });
});

describe("serializeXml", () => {
  it("self-closes empty elements", () => {
    expect(serializeXml(xml("w:br"))).toBe("<w:br/>");
  });

  it("renders attributes in alphabetical order", () => {
    const node = xml("w:t", { "w:val": "1", "xml:space": "preserve", "w:id": "2" });
    expect(serializeXml(node)).toBe(
      '<w:t w:id="2" w:val="1" xml:space="preserve"/>',
    );
  });

  it("renders text children with proper escaping", () => {
    const node = xml("w:t", undefined, ["foo & <bar>"]);
    expect(serializeXml(node)).toBe("<w:t>foo &amp; &lt;bar&gt;</w:t>");
  });

  it("escapes attribute values", () => {
    const node = xml("w:t", { "w:val": 'a "b" & <c>' });
    expect(serializeXml(node)).toBe(
      '<w:t w:val="a &quot;b&quot; &amp; &lt;c&gt;"/>',
    );
  });

  it("renders nested elements in document order", () => {
    const node = xml("w:p", undefined, [
      xml("w:r", undefined, [xml("w:t", undefined, ["hi"])]),
      xml("w:r", undefined, [xml("w:br")]),
    ]);
    expect(serializeXml(node)).toBe(
      "<w:p><w:r><w:t>hi</w:t></w:r><w:r><w:br/></w:r></w:p>",
    );
  });

  it("prepends the XML declaration when requested", () => {
    const result = serializeXml(xml("w:document"), { declaration: true });
    expect(result).toBe(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document/>',
    );
  });

  it("preserves an explicit xml:space='preserve' attribute on text runs", () => {
    const node = xml("w:t", { "xml:space": "preserve" }, [" hello "]);
    expect(serializeXml(node)).toBe(
      '<w:t xml:space="preserve"> hello </w:t>',
    );
  });

  it("emits deterministic output across calls with same input", () => {
    const tree = xml("w:p", { c: "3", a: "1", b: "2" }, [
      xml("w:r", undefined, ["x"]),
    ]);
    expect(serializeXml(tree)).toBe(serializeXml(tree));
    expect(serializeXml(tree)).toBe(
      '<w:p a="1" b="2" c="3"><w:r>x</w:r></w:p>',
    );
  });
});
