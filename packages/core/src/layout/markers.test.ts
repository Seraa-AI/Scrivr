import { describe, expect, it } from "vitest";
import type { LayoutLine } from "./LineBreaker";
import { markerAnchorOf, markerFaceOf } from "./markers";
import { layoutBlock } from "./BlockLayout";
import { createMeasurer } from "../test-utils";
import { buildStarterKitContext } from "../test-utils";

const { schema } = buildStarterKitContext();

const lineIn = (font: string, resolution?: number): LayoutLine => ({
  spans: [{ kind: "text", text: "x", font, x: 0, width: 5, docPos: 1, ...(resolution !== undefined ? { resolution } : {}) }],
  width: 5, ascent: 10, descent: 3, lineHeight: 16, textAscent: 10, cursorHeight: 16, xHeight: 6,
});

describe("the marker's font", () => {
  it("is the face of the line's first run, with how that face was resolved", () => {
    expect(markerFaceOf([lineIn("bold 18px Georgia", 7)])).toEqual({ font: "bold 18px Georgia", size: 18, resolution: 7 });
  });

  it("skips an image or anchor at the start of the line and takes the first text run", () => {
    const image = schema.nodes["image"]?.create({ src: "data:image/png;base64,AA==", width: 10, height: 10 });
    if (!image) throw new Error("no image");
    const text = lineIn("bold 24px Georgia");
    const line: LayoutLine = {
      ...text,
      spans: [{ kind: "object", node: image, x: 0, width: 0, height: 0, docPos: 1, verticalAlign: "baseline" }, ...text.spans],
    };
    expect(markerFaceOf([line])).toMatchObject({ font: "bold 24px Georgia", size: 24 });
  });

  it("is the face of the item's first text, past a line that holds none", () => {
    const empty: LayoutLine = { ...lineIn("12px Arial"), spans: [] };
    expect(markerFaceOf([empty, lineIn("bold 18px Georgia", 7)])).toEqual({ font: "bold 18px Georgia", size: 18, resolution: 7 });
  });

  it("never has size 0, with no line or a font that names no size", () => {
    expect(markerFaceOf([]).size).toBeGreaterThan(0);
    expect(markerFaceOf([lineIn("Georgia")]).size).toBeGreaterThan(0);
    expect(markerFaceOf([lineIn("0px Georgia")]).size).toBeGreaterThan(0);
  });
});

describe("the line a number is drawn on", () => {
  it("is the first line with text height, past an image's gap and an anchor left alone on an empty line", () => {
    const image = schema.nodes["image"]?.create({ src: "data:image/png;base64,AA==", width: 10, height: 10, wrapMode: "top-bottom" });
    if (!image) throw new Error("no image");
    const gap: LayoutLine = { spans: [], width: 0, ascent: 0, descent: 0, lineHeight: 72, textAscent: 0, cursorHeight: 0, xHeight: 0 };
    const anchorAlone: LayoutLine = {
      spans: [{ kind: "object", node: image, x: 0, width: 0, height: 0, docPos: 1, verticalAlign: "baseline" }],
      width: 0, ascent: 0, descent: 0, lineHeight: 0, textAscent: 0, cursorHeight: 0, xHeight: 0,
    };
    const text = lineIn("16px Georgia");
    const block = {
      ...layoutBlock(schema.node("paragraph"), { nodePos: 0, x: 0, y: 0, availableWidth: 100, page: 1, measurer: createMeasurer() }),
      y: 100, lines: [gap, anchorAlone, text], marker: { painter: "list", data: "1.", x: 0 },
    };
    expect(markerAnchorOf(block)?.baseline).toBe(100 + 72 + text.ascent);
  });
});

