import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createTestEditor } from "../test-utils";
import { StarterKit } from "../extensions/StarterKit";
import { DefaultContent } from "../extensions/built-in/DefaultContent";
import { createLinkPopover, type LinkPopoverInfo } from "./createLinkPopover";
import { createImageMenu, type ImageMenuInfo } from "./createImageMenu";
import { createTableMenu, type TableMenuInfo } from "./createTableMenu";
import { CellSelection } from "../table/cellSelection";
import type { Editor } from "../Editor";
import type { HoverTarget } from "../hover/types";

/**
 * Popovers peek on hover and expand on select (docs/hover-popovers-rfc.md §5).
 * Hover is driven through `reportHover`, the same entry the pointer controller
 * uses, so these tests own the timing without a pointer.
 */

const HREF = "https://example.com/a";

function rect(top: number, left: number, w: number, h: number): DOMRect {
  return {
    top, left, width: w, height: h, right: left + w, bottom: top + h, x: left, y: top,
    toJSON: () => ({}),
  };
}

function makeEditor(): Editor {
  const editor = createTestEditor({
    extensions: [
      StarterKit.configure({ table: true }),
      DefaultContent.configure({
        json: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "go " },
                { type: "text", text: "there", marks: [{ type: "link", attrs: { href: HREF } }] },
              ],
            },
            { type: "paragraph", content: [{ type: "image", attrs: { src: "x.png", width: 80, height: 60 } }] },
            {
              type: "table",
              attrs: { layout: "fixed", grid: [100, 100, 100] },
              content: [0, 1].map(() => ({
                type: "tableRow",
                content: [0, 1, 2].map(() => ({
                  type: "tableCell",
                  content: [{ type: "paragraph", content: [{ type: "text", text: "c" }] }],
                })),
              })),
            },
          ],
        },
      }),
    ],
  });
  vi.spyOn(editor, "getScrollContainerRect").mockReturnValue(rect(0, 0, 1000, 1000));
  vi.spyOn(editor, "getViewportRect").mockReturnValue(rect(100, 100, 40, 16));
  vi.spyOn(editor, "getNodeViewportRect").mockReturnValue(rect(200, 100, 80, 60));
  vi.spyOn(editor, "getNodeViewportRects").mockReturnValue([rect(300, 72, 300, 80)]);
  return editor;
}

function find(editor: Editor, pred: (name: string) => boolean): { pos: number; size: number } {
  let out: { pos: number; size: number } | null = null;
  editor.getState().doc.descendants((n, p) => {
    if (!out && pred(n.type.name)) out = { pos: p, size: n.nodeSize };
  });
  if (!out) throw new Error("node not found");
  return out;
}

function linkTarget(): HoverTarget {
  // "go " is 3 chars, the paragraph opens at 0 → text starts at 1.
  return { kind: "link", surfaceId: "body", pos: 4, end: 9, payload: { href: HREF } };
}

function hover(editor: Editor, ...targets: HoverTarget[]): void {
  editor.reportHover({ targets, point: null });
}

describe("hover popovers", () => {
  let cleanup: (() => void) | null = null;
  let flushRaf: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    const queued: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      queued.push(cb);
      return queued.length;
    });
    flushRaf = () => queued.splice(0).forEach((cb) => cb(0));
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("link", () => {
    it("peeks after the show delay, not before", () => {
      const editor = makeEditor();
      const onShow = vi.fn<(r: DOMRect, i: LinkPopoverInfo) => void>();
      cleanup = createLinkPopover(editor, { onShow, onHide: () => {}, onMove: () => {} });

      hover(editor, linkTarget());
      vi.advanceTimersByTime(300);
      flushRaf();
      expect(onShow).not.toHaveBeenCalled();

      vi.advanceTimersByTime(60);
      flushRaf();
      expect(onShow).toHaveBeenCalledTimes(1);
      expect(onShow.mock.calls[0]![1]).toEqual({ href: HREF, from: 4, to: 9, presentation: "peek" });
    });

    it("hides after the grace period once the pointer leaves", () => {
      const editor = makeEditor();
      const onHide = vi.fn();
      cleanup = createLinkPopover(editor, { onShow: () => {}, onHide, onMove: () => {} });

      hover(editor, linkTarget());
      vi.advanceTimersByTime(400);
      flushRaf();
      hover(editor);
      vi.advanceTimersByTime(100);
      flushRaf();
      expect(onHide).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);
      flushRaf();
      expect(onHide).toHaveBeenCalledTimes(1);
    });

    it("stays open while the pointer is over the popover", () => {
      const editor = makeEditor();
      const el = document.createElement("div");
      const hovered = vi.spyOn(el, "matches").mockReturnValue(true);
      const onHide = vi.fn();
      cleanup = createLinkPopover(editor, {
        onShow: () => {}, onHide, onMove: () => {}, getPopoverElement: () => el,
      });

      hover(editor, linkTarget());
      vi.advanceTimersByTime(400);
      flushRaf();
      hover(editor);
      vi.advanceTimersByTime(1000);
      flushRaf();
      expect(onHide).not.toHaveBeenCalled();

      hovered.mockReturnValue(false);
      vi.advanceTimersByTime(200);
      flushRaf();
      expect(onHide).toHaveBeenCalledTimes(1);
    });

    it("expands peek → full in place when the selection enters the link", () => {
      const editor = makeEditor();
      const onShow = vi.fn<(r: DOMRect, i: LinkPopoverInfo) => void>();
      const onMove = vi.fn<(r: DOMRect, i: LinkPopoverInfo) => void>();
      cleanup = createLinkPopover(editor, { onShow, onHide: () => {}, onMove });

      hover(editor, linkTarget());
      vi.advanceTimersByTime(400);
      flushRaf();
      editor.selection.moveCursorTo(6);
      flushRaf();

      expect(onShow).toHaveBeenCalledTimes(1);
      expect(onMove.mock.calls.at(-1)![1].presentation).toBe("full");
    });

    it("selection wins: a selected link ignores hover", () => {
      const editor = makeEditor();
      const onShow = vi.fn<(r: DOMRect, i: LinkPopoverInfo) => void>();
      const onHide = vi.fn();
      cleanup = createLinkPopover(editor, { onShow, onHide, onMove: () => {} });

      editor.selection.moveCursorTo(6);
      flushRaf();
      hover(editor, linkTarget());
      vi.advanceTimersByTime(400);
      hover(editor);
      vi.advanceTimersByTime(400);
      flushRaf();

      expect(onShow).toHaveBeenCalledTimes(1);
      expect(onShow.mock.calls[0]![1].presentation).toBe("full");
      expect(onHide).not.toHaveBeenCalled();
    });

    it("does not peek when hover is disabled", () => {
      const editor = makeEditor();
      const onShow = vi.fn();
      cleanup = createLinkPopover(editor, { onShow, onHide: () => {}, onMove: () => {}, hover: false });
      hover(editor, linkTarget());
      vi.advanceTimersByTime(1000);
      flushRaf();
      expect(onShow).not.toHaveBeenCalled();
    });
  });

  describe("image", () => {
    it("peeks a hovered image and goes full when it is selected", () => {
      const editor = makeEditor();
      const image = find(editor, (n) => n === "image");
      const onShow = vi.fn<(r: DOMRect, i: ImageMenuInfo) => void>();
      const onMove = vi.fn<(r: DOMRect, i: ImageMenuInfo) => void>();
      cleanup = createImageMenu(editor, { onShow, onHide: () => {}, onMove });

      hover(editor, { kind: "image", surfaceId: "body", pos: image.pos, end: image.pos + image.size });
      vi.advanceTimersByTime(400);
      flushRaf();
      expect(onShow.mock.calls[0]![1]).toMatchObject({ docPos: image.pos, presentation: "peek" });

      editor.selectNode(image.pos);
      flushRaf();
      expect(onShow).toHaveBeenCalledTimes(1);
      expect(onMove.mock.calls.at(-1)![1].presentation).toBe("full");
    });
  });

  describe("table", () => {
    it("peeks the table's shape on hover", () => {
      const editor = makeEditor();
      const table = find(editor, (n) => n === "table");
      const onShow = vi.fn<(r: DOMRect, i: TableMenuInfo) => void>();
      cleanup = createTableMenu(editor, { onShow, onHide: () => {}, onMove: () => {} });

      hover(editor, { kind: "table", surfaceId: "body", pos: table.pos, end: table.pos + table.size });
      vi.advanceTimersByTime(400);
      flushRaf();

      expect(onShow).toHaveBeenCalledTimes(1);
      const [anchor, info] = onShow.mock.calls[0]!;
      expect(info).toEqual({ docPos: table.pos, rows: 2, columns: 3, headerRow: false, presentation: "peek" });
      // Anchored to the table's top edge.
      expect(anchor.top).toBe(300);
      expect(anchor.height).toBe(1);
    });

    it("shows full for a cell selection", () => {
      const editor = makeEditor();
      const table = find(editor, (n) => n === "table");
      const onShow = vi.fn<(r: DOMRect, i: TableMenuInfo) => void>();
      cleanup = createTableMenu(editor, { onShow, onHide: () => {}, onMove: () => {} });

      const cells: number[] = [];
      editor.getState().doc.descendants((n, p) => {
        if (n.type.name === "tableCell") cells.push(p);
      });
      const state = editor.getState();
      editor.applyTransaction(state.tr.setSelection(new CellSelection(state.doc.resolve(cells[0]!), state.doc.resolve(cells[1]!))));
      flushRaf();

      expect(onShow.mock.calls.at(-1)![1]).toMatchObject({ docPos: table.pos, presentation: "full" });
    });
  });
});
