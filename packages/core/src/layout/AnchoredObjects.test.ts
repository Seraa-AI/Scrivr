/**
 * normalizeImageAttrs / resolveImageX tests.
 *
 * The legacy `wrappingMode` attr is preserved on PM nodes for round-trip;
 * read-side normalization maps it to the new `wrapMode` + `xAlign` model.
 * The mapping must respect a hard precedence: explicit non-default xAlign
 * (set by drag, toolbar, or external code) always wins over the legacy
 * fallback. Without this, drag commits look like they succeed but the
 * legacy mapping shadows the new value and the image never moves.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeImageAttrs,
  resolveImageX,
  compareAnchoredObjectPaintOrder,
  compareAnchoredObjectHitOrder,
} from "./AnchoredObjects";
import type { Node } from "prosemirror-model";

interface FakeAttrs {
  width?: number;
  height?: number;
  wrapMode?: string;
  positionMode?: string;
  xAlign?: string;
  x?: number | null;
  yOffset?: number;
  margin?: number;
  wrappingMode?: string;
  floatOffset?: unknown;
}

function makeImageNode(attrs: FakeAttrs): Node {
  return { attrs } as unknown as Node;
}

describe("normalizeImageAttrs — legacy → new model", () => {
  describe("untouched legacy attrs", () => {
    it("legacy square-right with no explicit xAlign → xAlign:right", () => {
      const node = makeImageNode({
        width: 300,
        height: 200,
        wrappingMode: "square-right",
      });
      const out = normalizeImageAttrs(node);
      expect(out.wrapMode).toBe("square");
      expect(out.xAlign).toBe("right");
      expect(out.x).toBeNull();
    });

    it("legacy square-left with no explicit xAlign → xAlign:left", () => {
      const node = makeImageNode({
        width: 300,
        height: 200,
        wrappingMode: "square-left",
      });
      const out = normalizeImageAttrs(node);
      expect(out.wrapMode).toBe("square");
      expect(out.xAlign).toBe("left");
    });
  });

  describe("explicit xAlign overrides legacy", () => {
    // The bug fix: drag commits xAlign:"custom" (and `x`) on a previously
    // square-right image. Before the fix, resolveXAlign's legacy branch
    // returned "right" unconditionally and the image stayed pinned at the
    // page's right edge.
    it("legacy square-right + xAlign:custom + x set → xAlign:custom (drag commit)", () => {
      const node = makeImageNode({
        width: 300,
        height: 200,
        wrappingMode: "square-right",
        xAlign: "custom",
        x: 120,
      });
      const out = normalizeImageAttrs(node);
      expect(out.wrapMode).toBe("square");
      expect(out.xAlign).toBe("custom");
      expect(out.x).toBe(120);
    });

    it("legacy square-right + xAlign:center → xAlign:center (toolbar commit)", () => {
      const node = makeImageNode({
        width: 300,
        height: 200,
        wrappingMode: "square-right",
        xAlign: "center",
      });
      expect(normalizeImageAttrs(node).xAlign).toBe("center");
    });

    it("legacy square-left + xAlign:custom → xAlign:custom", () => {
      const node = makeImageNode({
        width: 300,
        height: 200,
        wrappingMode: "square-left",
        xAlign: "custom",
        x: 80,
      });
      const out = normalizeImageAttrs(node);
      expect(out.xAlign).toBe("custom");
      expect(out.x).toBe(80);
    });
  });

  describe("new-model nodes (no legacy)", () => {
    it("wrapMode:square + xAlign:right → xAlign:right", () => {
      const node = makeImageNode({
        width: 300,
        height: 200,
        wrapMode: "square",
        xAlign: "right",
      });
      const out = normalizeImageAttrs(node);
      expect(out.wrapMode).toBe("square");
      expect(out.xAlign).toBe("right");
    });

    it("wrapMode:square + xAlign:custom + x → xAlign:custom", () => {
      const node = makeImageNode({
        width: 300,
        height: 200,
        wrapMode: "square",
        xAlign: "custom",
        x: 200,
      });
      const out = normalizeImageAttrs(node);
      expect(out.xAlign).toBe("custom");
      expect(out.x).toBe(200);
    });
  });
});

describe("normalizeImageAttrs — yOffset migration (Phase 1)", () => {
  it("default yOffset is 0", () => {
    const node = makeImageNode({ width: 100, height: 100, wrapMode: "square" });
    expect(normalizeImageAttrs(node).yOffset).toBe(0);
  });

  it("explicit yOffset wins", () => {
    const node = makeImageNode({
      width: 100, height: 100, wrapMode: "square", yOffset: 42,
    });
    expect(normalizeImageAttrs(node).yOffset).toBe(42);
  });

  it("legacy floatOffset.y migrates to yOffset when yOffset absent", () => {
    const node = makeImageNode({
      width: 100, height: 100, wrapMode: "square",
      floatOffset: { x: 0, y: 60 },
    });
    expect(normalizeImageAttrs(node).yOffset).toBe(60);
  });

  it("explicit yOffset overrides legacy floatOffset.y", () => {
    const node = makeImageNode({
      width: 100, height: 100, wrapMode: "square",
      yOffset: 10,
      floatOffset: { x: 0, y: 60 },
    });
    expect(normalizeImageAttrs(node).yOffset).toBe(10);
  });

  it("malformed floatOffset (string) → 0", () => {
    const node = makeImageNode({
      width: 100, height: 100, wrapMode: "square",
      floatOffset: "not an object",
    });
    expect(normalizeImageAttrs(node).yOffset).toBe(0);
  });

  it("malformed floatOffset (null) → 0", () => {
    const node = makeImageNode({
      width: 100, height: 100, wrapMode: "square",
      floatOffset: null,
    });
    expect(normalizeImageAttrs(node).yOffset).toBe(0);
  });

  it("floatOffset without .y → 0", () => {
    const node = makeImageNode({
      width: 100, height: 100, wrapMode: "square",
      floatOffset: { x: 5 },
    });
    expect(normalizeImageAttrs(node).yOffset).toBe(0);
  });

  it("floatOffset.y non-numeric → 0", () => {
    const node = makeImageNode({
      width: 100, height: 100, wrapMode: "square",
      floatOffset: { x: 0, y: "twenty" },
    });
    expect(normalizeImageAttrs(node).yOffset).toBe(0);
  });
});

describe("resolveImageX", () => {
  const contentX = 40;
  const contentWidth = 720; // page 800, margins 40
  const width = 300;

  it("xAlign:left → flush at contentX", () => {
    expect(
      resolveImageX({ width, xAlign: "left", x: null }, contentX, contentWidth),
    ).toBe(contentX);
  });

  it("xAlign:right → flush at contentX + contentWidth - width", () => {
    expect(
      resolveImageX({ width, xAlign: "right", x: null }, contentX, contentWidth),
    ).toBe(contentX + contentWidth - width);
  });

  it("xAlign:center → centered within content area", () => {
    expect(
      resolveImageX({ width, xAlign: "center", x: null }, contentX, contentWidth),
    ).toBe(contentX + (contentWidth - width) / 2);
  });

  it("xAlign:custom + x → returns x clamped to content area", () => {
    expect(
      resolveImageX({ width, xAlign: "custom", x: 100 }, contentX, contentWidth),
    ).toBe(100);
  });

  it("xAlign:custom + x past right edge → clamped to maxX", () => {
    expect(
      resolveImageX({ width, xAlign: "custom", x: 9999 }, contentX, contentWidth),
    ).toBe(contentX + contentWidth - width);
  });

  it("xAlign:custom + x past left edge → clamped to contentX", () => {
    expect(
      resolveImageX({ width, xAlign: "custom", x: -100 }, contentX, contentWidth),
    ).toBe(contentX);
  });
});

describe("compareAnchoredObjectPaintOrder / HitOrder", () => {
  // Paint order paints lower zIndex first (behind), then docPos as a stable
  // tiebreaker so two objects with the same z don't visually flicker between
  // re-layouts. Hit-test reverses paint order so the topmost object catches
  // pointer events first.
  const items = [
    { zIndex: 1, docPos: 5 },
    { zIndex: 0, docPos: 10 },
    { zIndex: 0, docPos: 3 },
    { zIndex: 1, docPos: 1 },
  ];

  it("paint order: ascending zIndex, then ascending docPos", () => {
    const sorted = [...items].sort(compareAnchoredObjectPaintOrder);
    expect(sorted.map((i) => i.docPos)).toEqual([3, 10, 1, 5]);
  });

  it("hit order: descending zIndex, then descending docPos (paint order reversed)", () => {
    const sorted = [...items].sort(compareAnchoredObjectHitOrder);
    expect(sorted.map((i) => i.docPos)).toEqual([5, 1, 10, 3]);
  });

  it("equal zIndex + docPos → 0 (stable comparator)", () => {
    const a = { zIndex: 0, docPos: 0 };
    const b = { zIndex: 0, docPos: 0 };
    expect(compareAnchoredObjectPaintOrder(a, b)).toBe(0);
    expect(compareAnchoredObjectHitOrder(a, b)).toBe(0);
  });
});
