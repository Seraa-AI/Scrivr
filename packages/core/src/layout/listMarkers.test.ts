import { describe, expect, it } from "vitest";
import type { LayoutLine } from "./LineBreaker";
import { listMarkerFont } from "./listMarkers";
import { buildStarterKitContext } from "../test-utils";

const { schema } = buildStarterKitContext();

const lineIn = (font: string, resolution?: number): LayoutLine => ({
  spans: [{ kind: "text", text: "x", font, x: 0, width: 5, docPos: 1, ...(resolution !== undefined ? { resolution } : {}) }],
  width: 5, ascent: 10, descent: 3, lineHeight: 16, textAscent: 10, cursorHeight: 16, xHeight: 6,
});

describe("the marker's font", () => {
  it("is the face of the line's first run, with how that face was resolved", () => {
    expect(listMarkerFont(lineIn("bold 18px Georgia", 7))).toEqual({ font: "bold 18px Georgia", size: 18, resolution: 7 });
  });

  it("skips an image or anchor at the start of the line and takes the first text run", () => {
    const image = schema.nodes["image"]?.create({ src: "data:image/png;base64,AA==", width: 10, height: 10 });
    if (!image) throw new Error("no image");
    const text = lineIn("bold 24px Georgia");
    const line: LayoutLine = {
      ...text,
      spans: [{ kind: "object", node: image, x: 0, width: 0, height: 0, docPos: 1, verticalAlign: "baseline" }, ...text.spans],
    };
    expect(listMarkerFont(line)).toMatchObject({ font: "bold 24px Georgia", size: 24 });
  });

  it("never has size 0, with no line or a font that names no size", () => {
    expect(listMarkerFont(undefined).size).toBeGreaterThan(0);
    expect(listMarkerFont(lineIn("Georgia")).size).toBeGreaterThan(0);
    expect(listMarkerFont(lineIn("0px Georgia")).size).toBeGreaterThan(0);
  });
});
