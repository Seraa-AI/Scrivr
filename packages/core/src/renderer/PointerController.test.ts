/**
 * PointerController **routing** tests.
 *
 * Scope: which Editor API does PointerController dispatch to for a given
 * mousedown? Geometry / hit-testing details belong in `CharacterMap.test.ts`;
 * actual document mutation belongs in Editor mutation tests. Here we drive
 * a real Editor + PointerController, stub the geometry seams owned by
 * CharacterMap, and spy on the Editor methods being routed to.
 *
 *   - click inside an image's object rect → editor.selectNode()
 *   - click outside the rect (even 1px adjacent) → editor.selection.moveCursorTo()
 *
 * Regression guard for the bug where clicking adjacent text snapped to the
 * image's docPos via posAtCoords and was then force-selected via nodeBefore/
 * nodeAfter — making it impossible to place a cursor next to an image.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makePointerControllerSetup } from "../test-utils";
import type { PointerControllerSetup } from "../test-utils";
import type { ObjectRectEntry } from "../layout/CharacterMap";
import type { DocumentLayout } from "../layout/PageLayout";
import type { AnchoredObjectPlacement } from "../layout/AnchoredObjects";

function mousedown(container: HTMLDivElement, x: number, y: number, shiftKey = false): void {
  container.dispatchEvent(
    new MouseEvent("mousedown", {
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
      shiftKey,
    }),
  );
}

function mousemove(x: number, y: number): void {
  document.dispatchEvent(
    new MouseEvent("mousemove", {
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function mouseup(x = 0, y = 0): void {
  document.dispatchEvent(
    new MouseEvent("mouseup", {
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    }),
  );
}

/**
 * Replace the editor's `layout` getter with one that returns the original
 * layout merged with a custom `anchoredObjects` array. Used by drag tests
 * that exercise PointerController's anchored-image branch — they need a
 * specific placement at known coords, which would require careful doc
 * construction to produce via real layout. Single localized seam.
 */
function withAnchoredObjects(
  setup: PointerControllerSetup,
  anchoredObjects: AnchoredObjectPlacement[],
): void {
  const realLayout = setup.editor.layout;
  Object.defineProperty(setup.editor, "layout", {
    get: (): DocumentLayout => ({ ...realLayout, anchoredObjects }),
    configurable: true,
  });
}

/** Stub `charMap.objectRectAtPoint` to report a hit on the given image rect. */
function stubImageHit(setup: PointerControllerSetup, rect: ObjectRectEntry): void {
  vi.spyOn(setup.editor.charMap, "objectRectAtPoint").mockReturnValue(rect);
}

/** Stub `charMap` to report no image hit; `posAtCoords` returns the given pos. */
function stubNoImageHit(setup: PointerControllerSetup, posAtCoords: number): void {
  vi.spyOn(setup.editor.charMap, "objectRectAtPoint").mockReturnValue(undefined);
  vi.spyOn(setup.editor.charMap, "posAtCoords").mockReturnValue(posAtCoords);
}

describe("PointerController — image click routing", () => {
  let setup: PointerControllerSetup;

  const IMAGE_RECT: ObjectRectEntry = {
    docPos: 5,
    x: 100,
    y: 50,
    width: 80,
    height: 60,
    page: 1,
  };

  beforeEach(() => {
    setup = makePointerControllerSetup({ isPageless: true });
  });

  afterEach(() => {
    setup.cleanup();
  });

  it("click inside image rect → selectNode(docPos)", () => {
    const selectNode = vi.spyOn(setup.editor, "selectNode").mockImplementation(() => {});
    const moveCursorTo = vi.spyOn(setup.editor.selection, "moveCursorTo").mockImplementation(() => {});
    stubImageHit(setup, IMAGE_RECT);

    mousedown(setup.container, 140, 80); // center of image

    expect(selectNode).toHaveBeenCalledTimes(1);
    expect(selectNode).toHaveBeenCalledWith(IMAGE_RECT.docPos);
    expect(moveCursorTo).not.toHaveBeenCalled();
  });

  it("click 1px outside image rect → moveCursorTo (no NodeSelection)", () => {
    // Rect hit-test returns undefined even though posAtCoords snaps to the
    // image's docPos — exact scenario the regression guard protects against.
    const selectNode = vi.spyOn(setup.editor, "selectNode").mockImplementation(() => {});
    const moveCursorTo = vi.spyOn(setup.editor.selection, "moveCursorTo").mockImplementation(() => {});
    stubNoImageHit(setup, IMAGE_RECT.docPos);

    mousedown(setup.container, IMAGE_RECT.x - 1, 80);

    expect(moveCursorTo).toHaveBeenCalledTimes(1);
    expect(moveCursorTo).toHaveBeenCalledWith(IMAGE_RECT.docPos);
    expect(selectNode).not.toHaveBeenCalled();
  });

  it("click in plain text (no rect) → moveCursorTo with posAtCoords result", () => {
    const selectNode = vi.spyOn(setup.editor, "selectNode").mockImplementation(() => {});
    const moveCursorTo = vi.spyOn(setup.editor.selection, "moveCursorTo").mockImplementation(() => {});
    stubNoImageHit(setup, 42);

    mousedown(setup.container, 200, 200);

    expect(moveCursorTo).toHaveBeenCalledWith(42);
    expect(selectNode).not.toHaveBeenCalled();
  });

  it("shift+click never triggers selectNode, even on an image rect", () => {
    const selectNode = vi.spyOn(setup.editor, "selectNode").mockImplementation(() => {});
    const setSelection = vi.spyOn(setup.editor.selection, "setSelection").mockImplementation(() => {});
    stubImageHit(setup, IMAGE_RECT);
    vi.spyOn(setup.editor.charMap, "posAtCoords").mockReturnValue(IMAGE_RECT.docPos);

    mousedown(setup.container, 140, 80, /* shiftKey */ true);

    expect(selectNode).not.toHaveBeenCalled();
    expect(setSelection).toHaveBeenCalled();
  });

  it("dragging an inline image moves the image node structurally", () => {
    const selectNode = vi.spyOn(setup.editor, "selectNode").mockImplementation(() => {});
    const moveNode = vi.spyOn(setup.editor, "moveNode").mockReturnValue(true);
    const setNodeAttrs = vi.spyOn(setup.editor, "setNodeAttrs").mockImplementation(() => {});
    const moveAndUpdateNode = vi.spyOn(setup.editor, "moveAndUpdateNode").mockReturnValue(true);
    vi.spyOn(setup.editor.charMap, "objectRectAtPoint").mockReturnValue(IMAGE_RECT);
    vi.spyOn(setup.editor.charMap, "posAtCoords").mockReturnValue(24);

    mousedown(setup.container, 140, 80);
    mousemove(260, 120);
    mouseup(260, 120);

    expect(selectNode).toHaveBeenCalledWith(IMAGE_RECT.docPos);
    expect(moveNode).toHaveBeenCalledWith(IMAGE_RECT.docPos, 24);
    expect(setNodeAttrs).not.toHaveBeenCalled();
    expect(moveAndUpdateNode).not.toHaveBeenCalled();
  });

  it("clicking an inline image without dragging only selects it", () => {
    const selectNode = vi.spyOn(setup.editor, "selectNode").mockImplementation(() => {});
    const moveNode = vi.spyOn(setup.editor, "moveNode").mockReturnValue(true);
    const setNodeAttrs = vi.spyOn(setup.editor, "setNodeAttrs").mockImplementation(() => {});
    const moveAndUpdateNode = vi.spyOn(setup.editor, "moveAndUpdateNode").mockReturnValue(true);
    vi.spyOn(setup.editor.charMap, "objectRectAtPoint").mockReturnValue(IMAGE_RECT);
    vi.spyOn(setup.editor.charMap, "posAtCoords").mockReturnValue(24);

    mousedown(setup.container, 140, 80);
    mouseup(140, 80);

    expect(selectNode).toHaveBeenCalledWith(IMAGE_RECT.docPos);
    expect(moveNode).not.toHaveBeenCalled();
    expect(setNodeAttrs).not.toHaveBeenCalled();
    expect(moveAndUpdateNode).not.toHaveBeenCalled();
  });

  // ── Anchored-image (square wrap) drag tests ─────────────────────────────────
  //
  // PointerController reads `editor.layout.anchoredObjects` to detect the
  // anchored-image branch. We inject a known placement via a layout getter
  // override (see `withAnchoredObjects`) — single localized seam, no editor
  // mocks.

  const makeSquarePlacement = (): AnchoredObjectPlacement => ({
    docPos: 5,
    page: 1,
    x: 100,
    y: 50,
    width: 80,
    height: 60,
    wrapMode: "square",
    node: setup.editor.schema.nodes["image"]!.create({
      src: "x",
      width: 80,
      height: 60,
      wrapMode: "square",
    }),
    anchorGlobalY: 50,
    anchorPage: 1,
    globalY: 50,
    zIndex: 0,
  });

  it("diagonal same-page drag commits setNodeAttrs with x and yOffset (one tx)", () => {
    // Mouse start (140, 80) → end (260, 220). dx=+120, dy=+140.
    // Same-page drag: anchor unchanged, xAlign/x and yOffset commit in one tx.
    withAnchoredObjects(setup, [makeSquarePlacement()]);
    const selectNode = vi.spyOn(setup.editor, "selectNode").mockImplementation(() => {});
    const setNodeAttrs = vi.spyOn(setup.editor, "setNodeAttrs").mockImplementation(() => {});
    const moveNode = vi.spyOn(setup.editor, "moveNode").mockReturnValue(true);
    const moveAndUpdateNode = vi.spyOn(setup.editor, "moveAndUpdateNode").mockReturnValue(true);
    vi.spyOn(setup.editor.charMap, "posAtCoords").mockReturnValue(42);

    mousedown(setup.container, 140, 80);
    mousemove(260, 220);
    mouseup(260, 220);

    expect(selectNode).toHaveBeenCalledWith(5);
    expect(setNodeAttrs).toHaveBeenCalledTimes(1);
    const call = setNodeAttrs.mock.calls[0]!;
    expect(call[0]).toBe(5);
    expect(call[1]).toMatchObject({ xAlign: "custom" });
    expect(typeof (call[1] as { x: number }).x).toBe("number");
    expect((call[1] as { yOffset: number }).yOffset).toBe(140);
    expect(moveNode).not.toHaveBeenCalled();
    expect(moveAndUpdateNode).not.toHaveBeenCalled();
  });

  it("vertical-only same-page drag commits setNodeAttrs({yOffset}) without docPos move", () => {
    // Pure vertical (140, 80) → (140, 200). dx=0, dy=+120.
    withAnchoredObjects(setup, [makeSquarePlacement()]);
    const setNodeAttrs = vi.spyOn(setup.editor, "setNodeAttrs").mockImplementation(() => {});
    const moveNode = vi.spyOn(setup.editor, "moveNode").mockReturnValue(true);
    const moveAndUpdateNode = vi.spyOn(setup.editor, "moveAndUpdateNode").mockReturnValue(true);
    vi.spyOn(setup.editor, "selectNode").mockImplementation(() => {});
    vi.spyOn(setup.editor.charMap, "posAtCoords").mockReturnValue(5);
    vi.spyOn(setup.editor.charMap, "posBelow").mockReturnValue(18);

    mousedown(setup.container, 140, 80);
    mousemove(140, 200);
    mouseup(140, 200);

    expect(setNodeAttrs).toHaveBeenCalledTimes(1);
    const call = setNodeAttrs.mock.calls[0]!;
    expect(call[0]).toBe(5);
    expect(call[1]).toEqual({ yOffset: 120 });
    expect(moveNode).not.toHaveBeenCalled();
    expect(moveAndUpdateNode).not.toHaveBeenCalled();
  });

  it("horizontal-only drag right commits setNodeAttrs(xAlign:'custom', x) only", () => {
    // (140, 80) → (260, 80). dx=+120, dy=0.
    withAnchoredObjects(setup, [makeSquarePlacement()]);
    const setNodeAttrs = vi.spyOn(setup.editor, "setNodeAttrs").mockImplementation(() => {});
    const moveNode = vi.spyOn(setup.editor, "moveNode").mockReturnValue(true);
    const moveAndUpdateNode = vi.spyOn(setup.editor, "moveAndUpdateNode").mockReturnValue(true);
    vi.spyOn(setup.editor, "selectNode").mockImplementation(() => {});
    vi.spyOn(setup.editor.charMap, "posAtCoords").mockReturnValue(5);

    mousedown(setup.container, 140, 80);
    mousemove(260, 80);
    mouseup(260, 80);

    expect(setNodeAttrs).toHaveBeenCalledTimes(1);
    const call = setNodeAttrs.mock.calls[0]!;
    expect(call[0]).toBe(5);
    expect(call[1]).toMatchObject({ xAlign: "custom" });
    expect(typeof (call[1] as { x: number }).x).toBe("number");
    expect(call[1]).not.toHaveProperty("yOffset");
    expect(moveNode).not.toHaveBeenCalled();
    expect(moveAndUpdateNode).not.toHaveBeenCalled();
  });

  it("horizontal-only drag left commits setNodeAttrs only with smaller x", () => {
    // (140, 80) → (40, 80). dx=-100, dy=0.
    withAnchoredObjects(setup, [makeSquarePlacement()]);
    const setNodeAttrs = vi.spyOn(setup.editor, "setNodeAttrs").mockImplementation(() => {});
    const moveNode = vi.spyOn(setup.editor, "moveNode").mockReturnValue(true);
    const moveAndUpdateNode = vi.spyOn(setup.editor, "moveAndUpdateNode").mockReturnValue(true);
    vi.spyOn(setup.editor, "selectNode").mockImplementation(() => {});
    vi.spyOn(setup.editor.charMap, "posAtCoords").mockReturnValue(5);

    mousedown(setup.container, 140, 80);
    mousemove(40, 80);
    mouseup(40, 80);

    expect(setNodeAttrs).toHaveBeenCalledTimes(1);
    const call = setNodeAttrs.mock.calls[0]!;
    expect(call[0]).toBe(5);
    expect(call[1]).toMatchObject({ xAlign: "custom" });
    expect(typeof (call[1] as { x: number }).x).toBe("number");
    expect(call[1]).not.toHaveProperty("yOffset");
    expect((call[1] as { x: number }).x).toBeLessThan(100);
    expect(moveNode).not.toHaveBeenCalled();
    expect(moveAndUpdateNode).not.toHaveBeenCalled();
  });
});
