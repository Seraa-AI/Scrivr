import { describe, it, expect } from "vitest";
import { rangeScrollTarget } from "./InputBridge";

/**
 * rangeScrollTarget is the pure math behind Editor.scrollRangeIntoView:
 * given a range's absolute band inside the scroll container, decide the
 * new scrollTop — or null when no scroll is needed.
 */
describe("rangeScrollTarget", () => {
  const viewportHeight = 800;

  it("returns null when the range is already fully visible", () => {
    expect(rangeScrollTarget(1200, 1250, 1000, viewportHeight)).toBeNull();
    // Exactly at the edges still counts as visible.
    expect(rangeScrollTarget(1000, 1800, 1000, viewportHeight)).toBeNull();
  });

  it("centers a range that lies below the viewport", () => {
    // Range 5000..5050 (height 50) → centered: top - (800-50)/2 = 4625
    expect(rangeScrollTarget(5000, 5050, 1000, viewportHeight)).toBe(4625);
  });

  it("centers a range that lies above the viewport", () => {
    // Range 200..250 while scrolled to 5000 → centered at 200 - 375 = -175 → clamped later? No: -175 → 0
    expect(rangeScrollTarget(575, 625, 5000, viewportHeight)).toBe(200);
  });

  it("pins the top of a range taller than the viewport", () => {
    // Range 5000..6200 (height 1200 > 800) → top minus 40px breathing room.
    expect(rangeScrollTarget(5000, 6200, 1000, viewportHeight)).toBe(4960);
  });

  it("never scrolls above the document top", () => {
    // Centering would want a negative scrollTop → clamp to 0.
    expect(rangeScrollTarget(100, 150, 5000, viewportHeight)).toBe(0);
  });

  it("scrolls when the range is only partially visible", () => {
    // Bottom pokes past the viewport → recenter.
    expect(rangeScrollTarget(1700, 1900, 1000, viewportHeight)).toBe(1400);
  });
});
