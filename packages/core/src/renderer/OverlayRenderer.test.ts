import { describe, it, expect, beforeEach } from "vitest";
import { snapRect, setActiveDpr, renderTrackedFormatting, renderTrackedInsert, renderTrackedMove, renderTrackedObject, renderTrackedRow } from "./OverlayRenderer";
import type { GlyphEntry, LineEntry } from "../layout/CharacterMap";

describe("snapRect — pixel-grid snapping", () => {
  beforeEach(() => {
    setActiveDpr(2); // simulate a 2x retina display
  });

  it("snaps fractional coordinates to whole device pixels", () => {
    // 10.3 * 2 = 20.6 → rounded to 21 → 21/2 = 10.5
    const r = snapRect(10.3, 20.7, 50.1, 25.3);
    // Each value should be a multiple of 0.5 (1/dpr)
    expect(r.x * 2).toBe(Math.round(r.x * 2));
    expect(r.y * 2).toBe(Math.round(r.y * 2));
    expect((r.x + r.w) * 2).toBe(Math.round((r.x + r.w) * 2));
    expect((r.y + r.h) * 2).toBe(Math.round((r.y + r.h) * 2));
  });

  it("adjacent rects share the same pixel boundary (no seam)", () => {
    // Two rects side by side: first ends at x=50.3, second starts at x=50.3
    const r1 = snapRect(10, 20, 40.3, 25);
    const r2 = snapRect(50.3, 20, 30, 25);
    // The right edge of r1 should exactly equal the left edge of r2
    expect(r1.x + r1.w).toBe(r2.x);
  });

  it("vertically adjacent rects share the same boundary (no seam)", () => {
    const r1 = snapRect(10, 20, 50, 18.7);
    const r2 = snapRect(10, 38.7, 50, 18.7);
    // Bottom of r1 should equal top of r2
    expect(r1.y + r1.h).toBe(r2.y);
  });

  it("works with dpr=1 (no sub-pixel snapping needed)", () => {
    setActiveDpr(1);
    const r = snapRect(10.3, 20.7, 50.1, 25.3);
    expect(r.x).toBe(10);
    expect(r.y).toBe(21);
    expect(r.x + r.w).toBe(60);
    expect(r.y + r.h).toBe(46);
  });

  it("works with dpr=3 (3x displays)", () => {
    setActiveDpr(3);
    const r = snapRect(10.1, 20.2, 50.3, 25.4);
    // All edges should be multiples of 1/3
    const eps = 1e-10;
    expect(Math.abs(r.x * 3 - Math.round(r.x * 3))).toBeLessThan(eps);
    expect(Math.abs(r.y * 3 - Math.round(r.y * 3))).toBeLessThan(eps);
    expect(Math.abs((r.x + r.w) * 3 - Math.round((r.x + r.w) * 3))).toBeLessThan(eps);
    expect(Math.abs((r.y + r.h) * 3 - Math.round((r.y + r.h) * 3))).toBeLessThan(eps);
  });
});

function context(): CanvasRenderingContext2D {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  return ctx;
}

describe("a formatting change", () => {
  it("is washed, never underlined, so it is not mistaken for underlining", () => {
    const calls: string[] = [];
    const ctx = context();
    ctx.fillRect = () => calls.push("fillRect");
    ctx.stroke = () => calls.push("stroke");
    const glyph = (docPos: number): GlyphEntry => ({ docPos, x: docPos * 8, y: 0, lineY: 0, width: 8, height: 16, page: 1, lineIndex: 0 });

    renderTrackedFormatting(ctx, [glyph(1), glyph(2)], "#d97706");

    expect(calls).toEqual(["fillRect", "fillRect"]);
  });
});

describe("an inserted empty line", () => {
  it("is marked, though the caret's zero-width glyph sits on it", () => {
    const fills: number[][] = [];
    const ctx = context();
    ctx.fillRect = (x, y, w, h) => fills.push([x, y, w, h]);
    const caret: GlyphEntry = { docPos: 5, x: 40, y: 0, lineY: 0, width: 0, height: 16, page: 1, lineIndex: 3 };
    const line: LineEntry = { page: 1, lineIndex: 3, y: 0, height: 16, x: 40, contentWidth: 400, startDocPos: 5, endDocPos: 5 };

    renderTrackedInsert(ctx, [caret], [line], "#16a34a");

    expect(fills.some(([, , w]) => (w ?? 0) > 0)).toBe(true);
  });
});

describe("a changed object", () => {
  const painted = (removed: boolean) => {
    const calls: string[] = [];
    const ctx = context();
    ctx.fillRect = () => calls.push("fill");
    ctx.strokeRect = () => calls.push("frame");
    ctx.stroke = () => calls.push("strike");
    renderTrackedObject(ctx, { x: 10, y: 10, width: 120, height: 80 }, "#16a34a", removed);
    return calls;
  };

  it("is framed where it is drawn", () => {
    expect(painted(false)).toEqual(["fill", "frame"]);
  });

  it("is also struck through when removed, as Word marks a deleted object", () => {
    expect(painted(true)).toEqual(["fill", "frame", "strike"]);
  });
});

describe("moved content", () => {
  const strokes = (removed: boolean) => {
    const ys: number[] = [];
    const ctx = context();
    ctx.fillRect = () => undefined;
    ctx.moveTo = (_x: number, y: number) => { ys.push(y); };
    ctx.stroke = () => undefined;
    const glyph: GlyphEntry = { docPos: 1, x: 0, y: 0, lineY: 0, width: 8, height: 16, page: 1, lineIndex: 0 };
    renderTrackedMove(ctx, [glyph], [], "#15803d", removed);
    return ys;
  };

  it("is double-underlined where it moved to, as Word marks it", () => {
    const ys = strokes(false);
    expect(ys).toHaveLength(2);
    expect(Math.min(...ys)).toBeGreaterThan(8);
  });

  it("is double-struck where it moved from", () => {
    const ys = strokes(true);
    expect(ys).toHaveLength(2);
    expect(Math.max(...ys)).toBeLessThan(12);
  });
});

describe("a table row added or removed", () => {
  const painted = (removed: boolean) => {
    const calls: string[] = [];
    let dashed = false;
    const ctx = context();
    ctx.fillRect = () => { calls.push("wash"); };
    ctx.strokeRect = () => { calls.push(dashed ? "dashed frame" : "frame"); };
    ctx.setLineDash = (segments: number[]) => { dashed = segments.length > 0; };
    renderTrackedRow(ctx, { x: 10, y: 10, width: 400, height: 38 }, "#16a34a", removed);
    return calls;
  };

  it("is washed and framed across the whole row", () => {
    expect(painted(false)).toEqual(["wash", "frame"]);
  });

  it("is framed with a dashed line when removed", () => {
    expect(painted(true)).toEqual(["wash", "dashed frame"]);
  });
});
