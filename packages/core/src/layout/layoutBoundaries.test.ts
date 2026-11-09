/**
 * Every place the flow may move to another page or region reaches layout as one
 * typed `boundary`: a node that breaks the page, or a section boundary with the
 * transition into the next section. The region cursor reads this one field.
 */
import { describe, expect, it } from "vitest";
import { collectLayoutItems } from "./layoutItems";
import { doc, pageBreak, paragraph, sectionBreak } from "../test-utils";

const boundariesOf = (...blocks: Parameters<typeof doc>) =>
  collectLayoutItems(doc(...blocks)).flatMap((item) => (item.boundary ? [item.boundary] : []));

describe("layout boundaries", () => {
  it("names a page break as a break", () => {
    expect(boundariesOf(paragraph("a"), pageBreak(), paragraph("b"))).toEqual([{ kind: "break", breaks: "page" }]);
  });

  it("names a section boundary by its transition, a continuous one included", () => {
    expect(boundariesOf(paragraph("a"), sectionBreak({ breakType: "continuous" }), paragraph("b"), sectionBreak({ breakType: "evenPage" })))
      .toEqual([{ kind: "section", transition: "continuous" }, { kind: "section", transition: "evenPage" }]);
  });
});
