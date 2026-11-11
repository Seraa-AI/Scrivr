/**
 * Every place the flow may move to another page or region reaches layout as one
 * typed `boundary`: a node that breaks the page, or a section boundary with the
 * transition into the next section. The region cursor reads this one field.
 */
import { describe, expect, it } from "vitest";
import { collectLayoutItems } from "./layoutItems";
import { buildStarterKitContext, doc, pageBreak, paragraph, sectionBreak } from "../test-utils";

const { schema } = buildStarterKitContext();

const boundariesOf = (...blocks: Parameters<typeof doc>) =>
  collectLayoutItems(doc(...blocks)).flatMap((item) => (item.boundary ? [item.boundary] : []));

describe("layout boundaries", () => {
  it("names a page break as a break", () => {
    expect(boundariesOf(paragraph("a"), pageBreak(), paragraph("b"))).toEqual([{ kind: "break", breaks: "page" }]);
  });

  it("takes a section boundary only between the document's own blocks, where the sections model reads it", () => {
    const nested = schema.nodeFromJSON({ type: "doc", content: [
      { type: "bulletList", content: [{ type: "listItem", content: [
        { type: "paragraph", content: [{ type: "text", text: "a" }] },
        { type: "sectionBreak", attrs: { settings: { breakType: "nextPage" } } },
      ] }] },
      { type: "paragraph", content: [{ type: "text", text: "b" }] },
    ] });
    expect(collectLayoutItems(nested).flatMap((item) => (item.boundary ? [item.boundary] : []))).toEqual([]);
  });

  it("names a section boundary by its transition, a continuous one included", () => {
    expect(boundariesOf(paragraph("a"), sectionBreak({ breakType: "continuous" }), paragraph("b"), sectionBreak({ breakType: "evenPage" })))
      .toEqual([{ kind: "section", transition: "continuous" }, { kind: "section", transition: "evenPage" }]);
  });
});
