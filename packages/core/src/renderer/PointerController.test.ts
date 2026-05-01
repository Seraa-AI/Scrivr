/**
 * PointerController tests.
 *
 * Focus: mousedown routing for inline images. The layout / hit-testing
 * details are covered in CharacterMap.test.ts; here we verify that the
 * controller dispatches clicks to the right editor API:
 *
 *   - click inside an image's object rect → editor.selectNode()
 *   - click outside the rect (even 1px adjacent) → editor.selection.moveCursorTo()
 *
 * Regression guard for the bug where clicking adjacent text snapped to the
 * image's docPos via posAtCoords and was then force-selected via nodeBefore/
 * nodeAfter — making it impossible to place a cursor next to an image.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PointerController } from "./PointerController";
import type { PointerControllerDeps } from "./PointerController";
import type { Editor } from "../Editor";
import type { ObjectRectEntry } from "../layout/CharacterMap";

interface MockEditor {
  readOnly: boolean;
  selectNode: ReturnType<typeof vi.fn>;
  selection: {
    moveCursorTo: ReturnType<typeof vi.fn>;
    setSelection: ReturnType<typeof vi.fn>;
    selectWordAt: ReturnType<typeof vi.fn>;
    selectBlockAt: ReturnType<typeof vi.fn>;
  };
  charMap: {
    posAtCoords: ReturnType<typeof vi.fn>;
    coordsAtPos: ReturnType<typeof vi.fn>;
    objectRectAtPoint: ReturnType<typeof vi.fn>;
    getObjectRect: ReturnType<typeof vi.fn>;
    posBelow: ReturnType<typeof vi.fn>;
    posAbove: ReturnType<typeof vi.fn>;
  };
  layout: {
    anchoredObjects?: unknown[];
    pageConfig?: { pageWidth: number; margins: { top: number; right: number; bottom: number; left: number } };
  };
  getState: ReturnType<typeof vi.fn>;
  getSelectionSnapshot: ReturnType<typeof vi.fn>;
  setNodeAttrs: ReturnType<typeof vi.fn>;
  moveNode: ReturnType<typeof vi.fn>;
  moveAndUpdateNode: ReturnType<typeof vi.fn>;
  ensurePagePopulated: ReturnType<typeof vi.fn>;
}

function makeMockEditor(overrides: Partial<MockEditor> = {}): MockEditor {
  return {
    readOnly: false,
    selectNode: vi.fn(),
    selection: {
      moveCursorTo: vi.fn(),
      setSelection: vi.fn(),
      selectWordAt: vi.fn(() => ({ from: 0, to: 0 })),
      selectBlockAt: vi.fn(),
    },
    charMap: {
      posAtCoords: vi.fn(() => 10),
      coordsAtPos: vi.fn(() => ({ x: 0, y: 0, height: 16, page: 1 })),
      objectRectAtPoint: vi.fn(() => undefined),
      getObjectRect: vi.fn(() => undefined),
      posBelow: vi.fn(() => null),
      posAbove: vi.fn(() => null),
    },
    layout: {
      pageConfig: {
        pageWidth: 800,
        margins: { top: 40, right: 40, bottom: 40, left: 40 },
      },
    },
    getState: vi.fn(() => ({
      doc: {
        resolve: vi.fn(() => ({
          depth: 1,
          start: vi.fn(() => 1),
          end: vi.fn(() => 30),
        })),
        nodeAt: vi.fn(() => ({ attrs: { width: 80, height: 60, wrappingMode: "square-left" } })),
        content: { size: 40 },
      },
      selection: { head: 0, anchor: 0, from: 0, to: 0, empty: true },
    })),
    getSelectionSnapshot: vi.fn(() => ({
      head: 0, anchor: 0, from: 0, to: 0, empty: true,
    })),
    setNodeAttrs: vi.fn(),
    moveNode: vi.fn(),
    moveAndUpdateNode: vi.fn(),
    ensurePagePopulated: vi.fn(),
    ...overrides,
  };
}

function makeController(editor: MockEditor): {
  controller: PointerController;
  container: HTMLDivElement;
} {
  const container = document.createElement("div");
  // Container at origin so clientX/Y === visualX/Y === docX/Y.
  container.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
  document.body.appendChild(container);

  const deps: PointerControllerDeps = {
    editor: editor as unknown as Editor,
    tilesContainer: container,
    pool: [],
    slotHeight: () => 1200,
    tileHeight: () => 1200,
    isPageless: () => true, // skip inter-page gap check
    visualYToDocY: (y) => ({ page: 1, docY: y }),
    scheduleUpdate: vi.fn(),
  };

  const controller = new PointerController(deps);
  controller.attach();
  return { controller, container };
}

function mousedown(container: HTMLDivElement, x: number, y: number): void {
  container.dispatchEvent(
    new MouseEvent("mousedown", {
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
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

describe("PointerController — image click routing", () => {
  let editor: MockEditor;
  let container: HTMLDivElement;
  let controller: PointerController;

  const IMAGE_RECT: ObjectRectEntry = {
    docPos: 5,
    x: 100,
    y: 50,
    width: 80,
    height: 60,
    page: 1,
  };

  beforeEach(() => {
    editor = makeMockEditor();
    ({ controller, container } = makeController(editor));
  });

  afterEach(() => {
    controller.detach();
    container.remove();
  });

  it("click inside image rect → selectNode(docPos)", () => {
    // Simulate charMap saying "yes, this click is inside image #5".
    editor.charMap.objectRectAtPoint.mockImplementation(
      (x: number, y: number, page: number) => {
        if (
          page === 1 &&
          x >= IMAGE_RECT.x &&
          x <= IMAGE_RECT.x + IMAGE_RECT.width &&
          y >= IMAGE_RECT.y &&
          y <= IMAGE_RECT.y + IMAGE_RECT.height
        ) {
          return IMAGE_RECT;
        }
        return undefined;
      },
    );

    mousedown(container, 140, 80); // center of image

    expect(editor.selectNode).toHaveBeenCalledTimes(1);
    expect(editor.selectNode).toHaveBeenCalledWith(IMAGE_RECT.docPos);
    expect(editor.selection.moveCursorTo).not.toHaveBeenCalled();
  });

  it("click 1px outside image rect → moveCursorTo (no NodeSelection)", () => {
    // Rect hit-test returns undefined even though posAtCoords snaps to the
    // image's docPos — this is the exact scenario the bug produced before
    // the fix (nodeAfter=image forced selectNode).
    editor.charMap.objectRectAtPoint.mockReturnValue(undefined);
    editor.charMap.posAtCoords.mockReturnValue(IMAGE_RECT.docPos);

    mousedown(container, IMAGE_RECT.x - 1, 80); // 1px left of image

    expect(editor.selection.moveCursorTo).toHaveBeenCalledTimes(1);
    expect(editor.selection.moveCursorTo).toHaveBeenCalledWith(
      IMAGE_RECT.docPos,
    );
    expect(editor.selectNode).not.toHaveBeenCalled();
  });

  it("click in plain text (no rect) → moveCursorTo with posAtCoords result", () => {
    editor.charMap.objectRectAtPoint.mockReturnValue(undefined);
    editor.charMap.posAtCoords.mockReturnValue(42);

    mousedown(container, 200, 200);

    expect(editor.selection.moveCursorTo).toHaveBeenCalledWith(42);
    expect(editor.selectNode).not.toHaveBeenCalled();
  });

  it("shift+click never triggers selectNode, even on an image rect", () => {
    editor.charMap.objectRectAtPoint.mockReturnValue(IMAGE_RECT);
    editor.charMap.posAtCoords.mockReturnValue(IMAGE_RECT.docPos);

    container.dispatchEvent(
      new MouseEvent("mousedown", {
        clientX: 140,
        clientY: 80,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(editor.selectNode).not.toHaveBeenCalled();
    expect(editor.selection.setSelection).toHaveBeenCalled();
  });

  // Placement record used by the four drag tests. Fields match the
  // current AnchoredObjectPlacement shape (wrapMode, not legacy mode).
  const makeSquarePlacement = () => ({
    docPos: 5,
    page: 1,
    x: 100,
    y: 50,
    width: 80,
    height: 60,
    wrapMode: "square" as const,
    node: {
      nodeSize: 1,
      type: { create: vi.fn() },
      attrs: { width: 80, height: 60, wrappingMode: "square-left" },
    },
    anchorGlobalY: 50,
    anchorPage: 1,
  });

  it("diagonal drag of anchored image commits moveAndUpdateNode (one tx)", () => {
    // Mouse start (140, 80) → end (260, 220). dx=+120 (substantial X) and
    // dy=+140 (cross-paragraph Y). New model: a single atomic transaction
    // that moves the docPos AND updates xAlign/x.
    editor = makeMockEditor({
      layout: {
        ...makeMockEditor().layout,
        anchoredObjects: [makeSquarePlacement()],
      },
    });
    controller.detach();
    container.remove();
    ({ controller, container } = makeController(editor));

    editor.charMap.posAtCoords.mockReturnValue(42);

    mousedown(container, 140, 80);
    mousemove(260, 220);
    mouseup(260, 220);

    expect(editor.selectNode).toHaveBeenCalledWith(5);
    expect(editor.moveAndUpdateNode).toHaveBeenCalledTimes(1);
    const call = editor.moveAndUpdateNode.mock.calls[0]!;
    expect(call[0]).toBe(5);                     // source docPos
    expect(call[1]).toBe(42);                    // target docPos
    expect(call[2]).toMatchObject({ xAlign: "custom" });
    expect(typeof call[2].x).toBe("number");
    expect(editor.moveNode).not.toHaveBeenCalled();
    expect(editor.setNodeAttrs).not.toHaveBeenCalled();
  });

  it("vertical-only drag commits moveNode without touching attrs", () => {
    // Pure vertical drag (140, 80) → (140, 200). dx=0, dy=+120.
    // Cursor lands back on the source node; posBelow falls back to
    // the next paragraph's docPos (18). New model: moveNode only,
    // no attrs update because horizontal didn't move.
    editor = makeMockEditor({
      layout: {
        ...makeMockEditor().layout,
        anchoredObjects: [makeSquarePlacement()],
      },
    });
    controller.detach();
    container.remove();
    ({ controller, container } = makeController(editor));

    editor.charMap.posAtCoords.mockReturnValue(5);
    editor.charMap.posBelow.mockReturnValue(18);

    mousedown(container, 140, 80);
    mousemove(140, 200);
    mouseup(140, 200);

    expect(editor.moveNode).toHaveBeenCalledWith(5, 18);
    expect(editor.moveAndUpdateNode).not.toHaveBeenCalled();
    expect(editor.setNodeAttrs).not.toHaveBeenCalled();
  });

  it("horizontal-only drag right commits setNodeAttrs(xAlign:'custom', x) only", () => {
    // Mouse (140, 80) → (260, 84). dx=+120, dy=+4 (within
    // posAtCoords lands on the source node, so docPos stays put.
    // New model: setNodeAttrs with xAlign:"custom" + new x.
    editor = makeMockEditor({
      layout: {
        ...makeMockEditor().layout,
        anchoredObjects: [makeSquarePlacement()],
      },
    });
    controller.detach();
    container.remove();
    ({ controller, container } = makeController(editor));

    editor.charMap.posAtCoords.mockReturnValue(5);

    mousedown(container, 140, 80);
    mousemove(260, 84);
    mouseup(260, 84);

    expect(editor.setNodeAttrs).toHaveBeenCalledTimes(1);
    const call = editor.setNodeAttrs.mock.calls[0]!;
    expect(call[0]).toBe(5);
    expect(call[1]).toMatchObject({ xAlign: "custom" });
    expect(typeof call[1].x).toBe("number");
    expect(editor.moveNode).not.toHaveBeenCalled();
    expect(editor.moveAndUpdateNode).not.toHaveBeenCalled();
  });

  it("horizontal-only drag left commits setNodeAttrs only with smaller x", () => {
    // Mouse (140, 80) → (40, 84). dx=-100, dy=+4 (sub-threshold).
    editor = makeMockEditor({
      layout: {
        ...makeMockEditor().layout,
        anchoredObjects: [makeSquarePlacement()],
      },
    });
    controller.detach();
    container.remove();
    ({ controller, container } = makeController(editor));

    editor.charMap.posAtCoords.mockReturnValue(5);

    mousedown(container, 140, 80);
    mousemove(40, 84);
    mouseup(40, 84);

    expect(editor.setNodeAttrs).toHaveBeenCalledTimes(1);
    const call = editor.setNodeAttrs.mock.calls[0]!;
    expect(call[0]).toBe(5);
    expect(call[1]).toMatchObject({ xAlign: "custom" });
    expect(typeof call[1].x).toBe("number");
    // Dragging left should produce a smaller x than the start (clamped to
    // contentX = 40 in this fixture, since margins.left = 40).
    expect(call[1].x).toBeLessThan(100);
    expect(editor.moveNode).not.toHaveBeenCalled();
    expect(editor.moveAndUpdateNode).not.toHaveBeenCalled();
  });
});
