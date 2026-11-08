import { describe, expect, it } from "vitest";
import { ExclusionManager } from "./ExclusionManager";
import type { ExclusionRect } from "./ExclusionManager";

describe("ExclusionManager — available segments", () => {
  it("returns full content width when no exclusion overlaps the line", () => {
    const mgr = new ExclusionManager();
    mgr.addRect({
      page: 1,
      x: 200,
      right: 300,
      y: 100,
      bottom: 200,
      side: "left",
      docPos: 1,
    });

    expect(mgr.getAvailableSegments(1, 40, 18, 0, 600)).toEqual({
      segments: [{ x: 0, width: 600 }],
    });
  });

  it("subtracts a centered exclusion into two available segments", () => {
    const mgr = new ExclusionManager();
    mgr.addRect({
      page: 1,
      x: 208,
      right: 412,
      y: 100,
      bottom: 220,
      side: "left",
      docPos: 1,
    });

    expect(mgr.getAvailableSegments(1, 120, 18, 0, 600)).toEqual({
      segments: [
        { x: 0, width: 208 },
        { x: 412, width: 188 },
      ],
    });
  });

  it("subtracts multiple active exclusions from the same line", () => {
    const mgr = new ExclusionManager();
    mgr.addRect({
      page: 1,
      x: 100,
      right: 180,
      y: 100,
      bottom: 220,
      side: "left",
      docPos: 1,
    });
    mgr.addRect({
      page: 1,
      x: 360,
      right: 460,
      y: 90,
      bottom: 180,
      side: "right",
      docPos: 2,
    });

    expect(mgr.getAvailableSegments(1, 120, 18, 0, 600)).toEqual({
      segments: [
        { x: 0, width: 100 },
        { x: 180, width: 180 },
        { x: 460, width: 140 },
      ],
    });
  });

  it("reports skipToY when a full-width exclusion removes all segments", () => {
    const mgr = new ExclusionManager();
    mgr.addRect({
      page: 1,
      x: 0,
      right: 600,
      y: 100,
      bottom: 220,
      side: "full",
      docPos: 1,
    });

    expect(mgr.getAvailableSegments(1, 120, 18, 0, 600)).toEqual({
      segments: [],
      skipToY: 220,
    });
  });
});

describe("ExclusionManager — addFullWidthRect", () => {
  it("adds a side:'full' rect that spans the queried content width", () => {
    const mgr = new ExclusionManager();
    mgr.addFullWidthRect({
      page: 1,
      y: 100,
      bottom: 220,
      contentX: 72,
      contentWidth: 650,
      docPos: 5,
    });
    // Querying with the same content bounds returns skipToY (no side segments).
    expect(mgr.getAvailableSegments(1, 120, 18, 72, 650)).toEqual({
      segments: [],
      skipToY: 220,
    });
    // getNextFreeY also chains.
    expect(mgr.getNextFreeY(1, 120, 18, 72, 650)).toBe(220);
  });

  it("addFullWidthRect produces skipToY where a hand-set side:'full' rect with mismatched bounds would silently fail", () => {
    // Demonstrate the failure mode the helper exists to prevent: a manual
    // addRect with side:'full' but x/right narrower than the content area
    // leaves side segments → segments.length !== 0 → skipToY is dropped.
    const broken = new ExclusionManager();
    broken.addRect({
      page: 1, x: 100, right: 500, // narrower than [72, 722]
      y: 100, bottom: 220,
      side: "full", docPos: 5,
    });
    const brokenResult = broken.getAvailableSegments(1, 120, 18, 72, 650);
    expect(brokenResult.skipToY).toBeUndefined();
    expect(brokenResult.segments.length).toBeGreaterThan(0);

    // The helper makes this impossible — caller passes content bounds, helper
    // sets x/right to span them.
    const correct = new ExclusionManager();
    correct.addFullWidthRect({
      page: 1, y: 100, bottom: 220,
      contentX: 72, contentWidth: 650, docPos: 5,
    });
    expect(correct.getAvailableSegments(1, 120, 18, 72, 650)).toEqual({
      segments: [],
      skipToY: 220,
    });
  });
});

describe("ExclusionManager — getNextFreeY", () => {
  const side = (y: number, bottom: number, x = 100, right = 200): ExclusionRect =>
    ({ page: 1, x, right, y, bottom, side: "left", docPos: 1 });
  const full = (y: number, bottom: number, docPos = 1): ExclusionRect =>
    ({ page: 1, x: 0, right: 600, y, bottom, side: "full", docPos });

  it("returns the input y when no exclusion meets the band", () => {
    const mgr = new ExclusionManager();
    mgr.addRect(side(50, 150));

    expect(mgr.getNextFreeY(1, 160, 40, 0, 600)).toBe(160);
  });

  it("jumps past a full-width exclusion the band meets", () => {
    const mgr = new ExclusionManager();
    mgr.addRect(full(100, 220));

    expect(mgr.getNextFreeY(1, 120, 10, 0, 600)).toBe(220);
  });

  it("jumps past a rect that starts inside the band, not only one containing its top", () => {
    const mgr = new ExclusionManager();
    mgr.addRect(full(100, 220));

    expect(mgr.getNextFreeY(1, 60, 60, 0, 600)).toBe(220);
  });

  it("chains through stacked exclusions", () => {
    const mgr = new ExclusionManager();
    mgr.addRect(full(100, 200, 1));
    mgr.addRect(full(200, 300, 2));

    expect(mgr.getNextFreeY(1, 120, 10, 0, 600)).toBe(300);
  });

  it("counts a side rect: a band that cannot wrap cannot share its rows with one", () => {
    const mgr = new ExclusionManager();
    mgr.addRect(side(50, 150));

    expect(mgr.getNextFreeY(1, 80, 10, 0, 600)).toBe(150);
  });

  it("ignores a rect outside the content width and on other pages", () => {
    const mgr = new ExclusionManager();
    mgr.addRect(side(50, 150, 0, 60));
    mgr.addRect({ ...full(50, 150), page: 2 });

    expect(mgr.getNextFreeY(1, 80, 10, 72, 650)).toBe(80);
  });
});
