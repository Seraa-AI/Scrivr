import { describe, it, expect, vi, afterEach } from "vitest";
import { createTestEditor } from "../test-utils";
import { createImageMenu, type ImageMenuInfo } from "./createImageMenu";
import type { Editor } from "../Editor";

/**
 * Regression guard: the image menu shows for a selected image and hides
 * otherwise. It keys on the descriptor kind "image" (owned by the Image
 * extension) — this test breaks if that coupling drifts, which is exactly how
 * the menu silently stopped showing before.
 */
function rect(top: number, left: number, w: number, h: number): DOMRect {
  return {
    top, left, width: w, height: h, right: left + w, bottom: top + h, x: left, y: top,
    toJSON: () => ({}),
  };
}

function editorWithImage(): Editor {
  return createTestEditor({
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "hi" }] },
        { type: "paragraph", content: [{ type: "image", attrs: { src: "x.png" } }] },
      ],
    },
  });
}

function imagePos(editor: Editor): number {
  let pos = -1;
  editor.getState().doc.descendants((n, p) => {
    if (n.type.name === "image") pos = p;
  });
  return pos;
}

// The menu defers its update through requestAnimationFrame — queue the callbacks
// and flush them explicitly so the assignment `rafId = requestAnimationFrame()`
// completes (setting a live id) before the callback runs and clears it.
function stubRaf(): () => void {
  const queued: FrameRequestCallback[] = [];
  let next = 1;
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
    queued.push(cb);
    return next++;
  });
  return () => queued.splice(0).forEach((cb) => cb(0));
}

describe("createImageMenu", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    cleanup?.();
    cleanup = null;
    vi.restoreAllMocks();
  });

  it("shows the menu for a selected image with the image node", () => {
    const editor = editorWithImage();
    // The container is large; the node rect sits inside it (isAnchorInsideContainer).
    vi.spyOn(editor, "getScrollContainerRect").mockReturnValue(rect(0, 0, 1000, 1000));
    vi.spyOn(editor, "getNodeViewportRect").mockReturnValue(rect(100, 100, 80, 60));
    const flushRaf = stubRaf();

    const onShow = vi.fn<(r: DOMRect, i: ImageMenuInfo) => void>();
    cleanup = createImageMenu(editor, { onShow, onHide: () => {}, onMove: () => {} });

    editor.selectNode(imagePos(editor));
    flushRaf();

    expect(onShow).toHaveBeenCalledTimes(1);
    expect(onShow.mock.calls[0]![1].node.type.name).toBe("image");
  });

  it("hides the menu when the selection leaves the image", () => {
    const editor = editorWithImage();
    vi.spyOn(editor, "getScrollContainerRect").mockReturnValue(rect(0, 0, 1000, 1000));
    vi.spyOn(editor, "getNodeViewportRect").mockReturnValue(rect(100, 100, 80, 60));
    const flushRaf = stubRaf();

    const onHide = vi.fn();
    cleanup = createImageMenu(editor, { onShow: () => {}, onHide, onMove: () => {} });

    editor.selectNode(imagePos(editor));
    flushRaf();
    editor.selection.moveCursorTo(1);
    flushRaf();

    expect(onHide).toHaveBeenCalled();
  });
});
