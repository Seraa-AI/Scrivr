import { describe, it, expect } from "vitest";
import { resolvePointOwner, type PointOwnershipInput } from "./pointOwnership";
import type { AnchoredObjectPlacement } from "./AnchoredObjects";
import type { ObjectRectEntry } from "./CharacterMap";
import { buildStarterKitContext } from "../test-utils";

const { schema } = buildStarterKitContext();
/** Any node will do — ownership reads geometry and wrapMode, never content. */
const NODE = schema.node("paragraph");

/**
 * The ownership rule, tested without a document, a canvas, or a DOM — it is a
 * fact about z-order and geometry, and every surface that routes a pointer
 * reads this one answer.
 */

function float(
  overrides: Partial<AnchoredObjectPlacement> & Pick<AnchoredObjectPlacement, "wrapMode">,
): AnchoredObjectPlacement {
  return {
    docPos: 10,
    page: 1,
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    zIndex: 0,
    globalY: 100,
    anchorGlobalY: 100,
    anchorPage: 1,
    node: NODE,
    ...overrides,
  };
}

function input(
  objects: AnchoredObjectPlacement[],
  opts: { text?: boolean; rect?: ObjectRectEntry } = {},
): PointOwnershipInput {
  return {
    anchoredObjects: objects,
    hasTextAt: () => opts.text ?? false,
    objectRectAt: () => opts.rect,
  };
}

/** A point in the middle of the default float rect. */
const X = 200;
const Y = 150;

describe("who owns a point", () => {
  describe("with text painted there", () => {
    it("behind yields to the text", () => {
      const owner = resolvePointOwner(X, Y, 1, input([float({ wrapMode: "behind" })], { text: true }));
      expect(owner.kind).toBe("text");
    });

    it.each(["front", "square", "top-bottom"] as const)("%s takes the point", (wrapMode) => {
      const owner = resolvePointOwner(X, Y, 1, input([float({ wrapMode })], { text: true }));
      expect(owner.kind).toBe("anchored");
    });
  });

  describe("with no text painted there", () => {
    it("behind takes the point, so it stays grabbable in the gaps", () => {
      const owner = resolvePointOwner(X, Y, 1, input([float({ wrapMode: "behind" })]));
      expect(owner.kind).toBe("anchored");
    });
  });

  it("ignores objects on other pages", () => {
    const owner = resolvePointOwner(X, Y, 2, input([float({ wrapMode: "front" })]));
    expect(owner.kind).toBe("text");
  });

  it("ignores objects whose rect does not contain the point", () => {
    const owner = resolvePointOwner(1000, 1000, 1, input([float({ wrapMode: "front" })]));
    expect(owner.kind).toBe("text");
  });

  it("resolves overlapping floats in hit order — the topmost takes it", () => {
    const below = float({ wrapMode: "front", docPos: 10, zIndex: 0 });
    const above = float({ wrapMode: "front", docPos: 20, zIndex: 5 });
    const owner = resolvePointOwner(X, Y, 1, input([below, above]));
    expect(owner.kind).toBe("anchored");
    if (owner.kind === "anchored") expect(owner.object.docPos).toBe(20);
  });

  it("keeps the front layer above a higher-z behind object", () => {
    const behind = float({ wrapMode: "behind", docPos: 20, zIndex: 100 });
    const front = float({ wrapMode: "front", docPos: 10, zIndex: 0 });
    const owner = resolvePointOwner(X, Y, 1, input([behind, front]));
    expect(owner.kind).toBe("anchored");
    if (owner.kind === "anchored") expect(owner.object.docPos).toBe(10);
  });

  it("lets a lower front float take a point the behind float above it declined", () => {
    const behind = float({ wrapMode: "behind", docPos: 20, zIndex: 5 });
    const front = float({ wrapMode: "front", docPos: 10, zIndex: 0 });
    const owner = resolvePointOwner(X, Y, 1, input([behind, front], { text: true }));
    expect(owner.kind).toBe("anchored");
    if (owner.kind === "anchored") expect(owner.object.docPos).toBe(10);
  });

  describe("the inline object map", () => {
    const rect: ObjectRectEntry = { docPos: 99, x: 100, y: 100, width: 200, height: 100, page: 1 };

    it("an inline object takes the point when no float owns it", () => {
      const owner = resolvePointOwner(X, Y, 1, input([], { rect }));
      expect(owner.kind).toBe("inlineObject");
    });

    it("never re-claims a float that already declined the point", () => {
      // Anchored rects are registered in this map too, for geometry lookups.
      // Reading it without this guard overturns the z-order decision above.
      const behind = float({ wrapMode: "behind", docPos: 42 });
      const behindRect: ObjectRectEntry = { ...rect, docPos: 42 };
      const owner = resolvePointOwner(X, Y, 1, input([behind], { text: true, rect: behindRect }));
      expect(owner.kind).toBe("text");
    });

    // No text here, so the behind float is otherwise grabbable — but an inline
    // object paints with the body, above the behind layer, and takes it first.
    it("keeps inline content above a behind float in a text gap", () => {
      const behind = float({ wrapMode: "behind", docPos: 42, zIndex: 100 });
      const owner = resolvePointOwner(X, Y, 1, input([behind], { rect }));
      expect(owner.kind).toBe("inlineObject");
    });
  });
});
