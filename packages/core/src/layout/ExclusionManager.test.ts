import { describe, expect, it } from "vitest";
import { ExclusionManager } from "./ExclusionManager";

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

describe("ExclusionManager — getNextFreeY", () => {
  it("returns the input y when no full-width exclusion overlaps", () => {
    const mgr = new ExclusionManager();
    mgr.addRect({
      page: 1,
      x: 100,
      right: 200,
      y: 50,
      bottom: 150,
      side: "left",
      docPos: 1,
    });

    expect(mgr.getNextFreeY(1, 80)).toBe(80);
  });

  it("jumps past a full-width exclusion that contains y", () => {
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

    expect(mgr.getNextFreeY(1, 120)).toBe(220);
  });

  it("chains through stacked full-width exclusions", () => {
    const mgr = new ExclusionManager();
    mgr.addRect({
      page: 1,
      x: 0,
      right: 600,
      y: 100,
      bottom: 200,
      side: "full",
      docPos: 1,
    });
    mgr.addRect({
      page: 1,
      x: 0,
      right: 600,
      y: 200,
      bottom: 300,
      side: "full",
      docPos: 2,
    });

    expect(mgr.getNextFreeY(1, 120)).toBe(300);
  });

  it("ignores side='left' exclusions even when they overlap y", () => {
    const mgr = new ExclusionManager();
    mgr.addRect({
      page: 1,
      x: 100,
      right: 200,
      y: 50,
      bottom: 150,
      side: "left",
      docPos: 1,
    });

    expect(mgr.getNextFreeY(1, 80)).toBe(80);
  });
});
