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
    objectRectAtPoint: ReturnType<typeof vi.fn>;
    getObjectRect: ReturnType<typeof vi.fn>;
  };
  layout: { floats?: unknown[] };
  getState: ReturnType<typeof vi.fn>;
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
      objectRectAtPoint: vi.fn(() => undefined),
      getObjectRect: vi.fn(() => undefined),
    },
    layout: {},
    getState: vi.fn(() => ({
      selection: { head: 0, anchor: 0, from: 0, to: 0, empty: true },
    })),
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
});
