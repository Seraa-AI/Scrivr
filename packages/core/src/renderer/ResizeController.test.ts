/**
 * ResizeController tests.
 *
 * computeGhostRect encodes the "opposite edge is pinned" rule for live resize
 * drags. If it regresses, dragging a left/top handle will visually grow the
 * box the wrong way until mouseup commits — exactly the reported bug where
 * "dragging to the left moves the handles to the right".
 */
import { describe, it, expect } from "vitest";
import { computeGhostRect, computeNewSize } from "./ResizeController";

// Starting rect: x=100, y=200, w=80, h=60.
const ORIG = { x: 100, y: 200, w: 80, h: 60 } as const;

function ghost(handle: string, newW: number, newH: number) {
  return computeGhostRect(handle, ORIG.x, ORIG.y, ORIG.w, ORIG.h, newW, newH);
}

describe("computeGhostRect — ghost anchors on the opposite edge", () => {
  it("BR drag grows from the original top-left (no shift)", () => {
    const g = ghost("BR", 120, 100);
    expect(g).toEqual({ x: 100, y: 200, width: 120, height: 100 });
  });

  it("ML drag grows leftward — right edge stays pinned", () => {
    // Width: 80 → 120 (user dragged 40px to the left). Expected: new left
    // edge at 100 + 80 − 120 = 60, right edge still at 180.
    const g = ghost("ML", 120, ORIG.h);
    expect(g).toEqual({ x: 60, y: 200, width: 120, height: 60 });
  });

  it("MR drag grows rightward — left edge stays pinned", () => {
    const g = ghost("MR", 120, ORIG.h);
    expect(g).toEqual({ x: 100, y: 200, width: 120, height: 60 });
  });

  it("TC drag grows upward — bottom edge stays pinned", () => {
    const g = ghost("TC", ORIG.w, 100);
    expect(g).toEqual({ x: 100, y: 160, width: 80, height: 100 });
  });

  it("BC drag grows downward — top edge stays pinned", () => {
    const g = ghost("BC", ORIG.w, 100);
    expect(g).toEqual({ x: 100, y: 200, width: 80, height: 100 });
  });

  it("TL drag grows up-and-left — bottom-right is pinned", () => {
    const g = ghost("TL", 120, 100);
    expect(g).toEqual({ x: 60, y: 160, width: 120, height: 100 });
  });

  it("TR drag grows up-and-right — bottom-left is pinned", () => {
    const g = ghost("TR", 120, 100);
    expect(g).toEqual({ x: 100, y: 160, width: 120, height: 100 });
  });

  it("BL drag grows down-and-left — top-right is pinned", () => {
    const g = ghost("BL", 120, 100);
    expect(g).toEqual({ x: 60, y: 200, width: 120, height: 100 });
  });
});

describe("computeNewSize + computeGhostRect — ML drag to the left", () => {
  // Integration: user drags an ML handle 40px to the left. computeNewSize
  // says width grows to 120. computeGhostRect translates that into a ghost
  // rect that grows leftward rather than rightward.
  it("ghost grows leftward, not rightward", () => {
    const { width, height } = computeNewSize("ML", ORIG.w, ORIG.h, -40, 0);
    expect(width).toBe(120);
    expect(height).toBe(60);
    const g = ghost("ML", width, height);
    // New left edge is LEFT of the original left edge — regression guard
    // for the "handles move the wrong way" bug.
    expect(g.x).toBeLessThan(ORIG.x);
    expect(g.x + g.width).toBe(ORIG.x + ORIG.w); // right edge pinned
  });
});
