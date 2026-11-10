import { describe, expect, it } from "vitest";
// Through the package barrel on purpose: these are what a host reads an image
// unit with, and `tsc` fails here the moment one stops being exported.
import { IMAGE_ALIGNS, IMAGE_NODE_ATTRS, IMAGE_WRAPS } from "../index";
import type { ImageAlign, ImageWrap, SemanticImage } from "../index";

describe("the image an agent reads", () => {
  it("names its values and the node attrs behind them", () => {
    const wrap: ImageWrap = "square";
    const align: ImageAlign = "center";
    const image: SemanticImage = { src: "https://example.com/a.png", alt: "", width: 1, height: 1, wrap, align: "custom" };

    expect(IMAGE_WRAPS).toContain(wrap);
    expect(IMAGE_ALIGNS).toEqual(["left", "center", "right"]);
    expect(IMAGE_ALIGNS).toContain(align);
    expect(Object.keys(IMAGE_NODE_ATTRS).sort()).toEqual(Object.keys(image).sort());
  });
});
