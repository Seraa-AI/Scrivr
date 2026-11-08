/**
 * List markers in the PDF. Bullets are drawn as the same shapes the canvas
 * draws, so a bullet never depends on whether the face can encode its glyph —
 * a standard PDF font cannot encode `◦` or `▪`. Numbers are text.
 */

import { describe, expect, it } from "vitest";
import { buildPdf as buildPdfWithEditor } from "../index";
import { PT_PER_PX } from "../context";
import { listMarkerFont, type LayoutLine } from "@scrivr/core";
import { exportEditor, textLine, block, onePage, schema } from "./fixtures";
import { recordDrawOps, type DrawOp } from "./opLog";

const MARKER_X = 60;

async function markerOps(marker: string): Promise<DrawOp[]> {
  const layout = onePage([
    block("paragraph", [textLine("item", { font: "16px Helvetica" })], {
      y: 100,
      listMarker: marker,
      listMarkerX: MARKER_X,
    }),
  ]);
  const ops = await recordDrawOps(() => buildPdfWithEditor(layout, exportEditor));
  return ops.filter((op) => op.op !== "state" && !(op.op === "text" && op["value"] === "item"));
}

const shapes = (ops: DrawOp[]) => ops.filter((op) => op.op === "ellipse" || (op.op === "rect" && op["x"] !== 0));
const texts = (ops: DrawOp[]) => ops.filter((op) => op.op === "text");

describe("list markers in the PDF", () => {
  it("draws a level-1 bullet as a filled disc", async () => {
    const ops = await markerOps("•");
    expect(texts(ops)).toEqual([]);
    expect(shapes(ops)).toEqual([expect.objectContaining({ op: "ellipse", color: expect.any(String) })]);
  });

  it("draws a level-2 bullet as a ring, not a `?`", async () => {
    const ops = await markerOps("◦");
    expect(texts(ops)).toEqual([]);
    const [ring] = shapes(ops);
    expect(ring).toMatchObject({ op: "ellipse", borderColor: expect.any(String) });
    expect(ring?.["color"]).toBeUndefined();
  });

  it("draws a level-3 bullet as a square, not a `?`", async () => {
    const ops = await markerOps("▪");
    expect(texts(ops)).toEqual([]);
    expect(shapes(ops)).toEqual([expect.objectContaining({ op: "rect" })]);
  });

  it("starts each shape at the marker's left edge", async () => {
    const [disc] = shapes(await markerOps("•"));
    const [square] = shapes(await markerOps("▪"));
    const radius = Number(disc?.["xScale"]);
    expect(Number(disc?.["x"]) - radius).toBeCloseTo(MARKER_X * PT_PER_PX, 3);
    expect(Number(square?.["x"])).toBeCloseTo(MARKER_X * PT_PER_PX, 3);
  });

  it("draws a number as text at the marker's left edge", async () => {
    const ops = await markerOps("1.");
    expect(texts(ops)).toEqual([expect.objectContaining({ value: "1.", x: MARKER_X * PT_PER_PX })]);
    expect(shapes(ops)).toEqual([]);
  });
});

describe("the marker's size", () => {
  it("is core's size when the line opens with an inline image, not a separate fallback", async () => {
    const image = schema.nodes["image"]?.create({ src: "data:image/png;base64,AA==", width: 10, height: 10 });
    if (!image) throw new Error("no image node");
    const line: LayoutLine = {
      spans: [{ kind: "object", node: image, x: 0, width: 10, height: 10, docPos: 1, verticalAlign: "baseline" }],
      width: 10, ascent: 10, descent: 2, lineHeight: 14, textAscent: 10, cursorHeight: 14, xHeight: 6,
    };
    const ops = await recordDrawOps(() => buildPdfWithEditor(
      onePage([block("paragraph", [line], { y: 100, listMarker: "1.", listMarkerX: MARKER_X })]),
      exportEditor,
    ));
    const marker = ops.find((op) => op.op === "text" && op["value"] === "1.");
    expect(marker?.["size"]).toBeCloseTo(listMarkerFont(line).size * PT_PER_PX, 3);
  });
});

describe("the marker's face", () => {
  it("is the face of the text after an image that opens the line", async () => {
    const image = schema.nodes["image"]?.create({ src: "data:image/png;base64,AA==", width: 10, height: 10 });
    if (!image) throw new Error("no image node");
    const text = textLine("clause", { font: "16px Courier" });
    const line: LayoutLine = {
      ...text,
      spans: [{ kind: "object", node: image, x: 0, width: 10, height: 10, docPos: 1, verticalAlign: "baseline" }, ...text.spans],
    };
    const ops = await recordDrawOps(() => buildPdfWithEditor(
      onePage([block("paragraph", [line], { y: 100, listMarker: "1.", listMarkerX: MARKER_X })]),
      exportEditor,
    ));
    const faceOf = (value: string) => ops.find((op) => op.op === "text" && op["value"] === value)?.["font"];
    expect(faceOf("clause")).not.toBe("font(Helvetica)");
    expect(faceOf("1.")).toBe(faceOf("clause"));
  });
});
