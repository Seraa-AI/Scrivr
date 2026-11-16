import { describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import { drawingSize } from "./drawingSize";

const drawn = (width: number, height: number, format: "image/png" | "image/jpeg") => {
  const canvas = createCanvas(width, height);
  const bytes = format === "image/png" ? canvas.toBuffer("image/png") : canvas.toBuffer("image/jpeg");
  return `data:${format};base64,${bytes.toString("base64")}`;
};

describe("drawingSize", () => {
  it("reads a PNG drawing's size from its header", () => {
    expect(drawingSize(drawn(240, 80, "image/png"))).toEqual({ width: 240, height: 80 });
  });

  it("reads a JPEG drawing's size from its frame header", () => {
    expect(drawingSize(drawn(300, 120, "image/jpeg"))).toEqual({ width: 300, height: 120 });
  });

  it("reads no size from what is not a drawing", () => {
    expect(drawingSize("data:image/png;base64,iVBORw0KGgo=")).toBeNull();
    expect(drawingSize("https://example.com/sig.png")).toBeNull();
    expect(drawingSize("data:image/jpeg;base64,/9j/AAAA")).toBeNull();
  });
});
