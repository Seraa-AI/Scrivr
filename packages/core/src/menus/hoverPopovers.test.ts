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
 * Popovers peek on hover and expand on select. Hover is driven through
 * `reportHover`, the same entry the pointer controller uses, so these tests own
 * the timing without a pointer.
 */

const HREF = "https://example.com/a";
const OTHER = "https://example.com/b";

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
                { type: "text", text: " or " },
                { type: "text", text: "here", marks: [{ type: "link", attrs: { href: OTHER } }] },
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
  vi.spyOn(editor, "getRangeViewportRects").mockReturnValue([rect(100, 100, 40, 16)]);
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
  return { kind: "link", surfaceId: "body", pos: 4, end: 9, at: 4 };
}

function cellPositions(editor: Editor): number[] {
  const cells: number[] = [];
  editor.getState().doc.descendants((n, p) => {
    if (n.type.name === "tableCell") cells.push(p);
  });
  return cells;
}

function selectCells(editor: Editor): void {
  const [first, second] = cellPositions(editor);
  const state = editor.getState();
  editor.applyTransaction(
    state.tr.setSelection(new CellSelection(state.doc.resolve(first!), state.doc.resolve(second!))),
  );
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

    it("closes at once when an edit deletes the peeked link, even under the pointer", () => {
      const editor = makeEditor();
      const el = document.createElement("div");
      vi.spyOn(el, "matches").mockReturnValue(true);
      const onMove = vi.fn<(r: DOMRect, i: LinkPopoverInfo) => void>();
      const onHide = vi.fn();
      cleanup = createLinkPopover(editor, {
        onShow: () => {}, onHide, onMove, getPopoverElement: () => el,
      });

      hover(editor, linkTarget());
      vi.advanceTimersByTime(400);
      flushRaf();
      // A collaborator deletes "there or "; the "here" link shifts into its old range.
      editor.applyTransaction(editor.getState().tr.delete(4, 13));
      flushRaf();

      expect(onHide).toHaveBeenCalledTimes(1);
      expect(onMove.mock.calls.map(([, info]) => info.href)).not.toContain(OTHER);
    });

    it("keeps waiting on a link an edit moved, rather than starting the wait again", () => {
      const editor = makeEditor();
      const onShow = vi.fn<(r: DOMRect, i: LinkPopoverInfo) => void>();
      cleanup = createLinkPopover(editor, { onShow, onHide: () => {}, onMove: () => {} });

      hover(editor, linkTarget());
      vi.advanceTimersByTime(200);
      // A collaborator types before the link while the pointer rests on it.
      editor.applyTransaction(editor.getState().tr.insertText("ab", 1));
      vi.advanceTimersByTime(160);
      flushRaf();

      expect(onShow).toHaveBeenCalledTimes(1);
      expect(onShow.mock.calls[0]![1]).toEqual({ href: HREF, from: 6, to: 11, presentation: "peek" });
    });

    describe("crossing another link while a peek is open", () => {
      const otherTarget: HoverTarget = { kind: "link", surfaceId: "body", pos: 13, end: 17, at: 13 };

      it("swaps to it after the grace period, not at once", () => {
        const editor = makeEditor();
        const onShow = vi.fn<(r: DOMRect, i: LinkPopoverInfo) => void>();
        cleanup = createLinkPopover(editor, { onShow, onHide: () => {}, onMove: () => {} });

        hover(editor, linkTarget());
        vi.advanceTimersByTime(400);
        flushRaf();
        hover(editor, otherTarget);
        flushRaf();
        expect(onShow.mock.calls.map(([, i]) => i.href)).toEqual([HREF]);

        vi.advanceTimersByTime(200);
        flushRaf();
        expect(onShow.mock.calls.map(([, i]) => i.href)).toEqual([HREF, OTHER]);
      });

      it("swaps once the pointer leaves the peek for the other link", () => {
        const editor = makeEditor();
        const el = document.createElement("div");
        const overPeek = vi.spyOn(el, "matches").mockReturnValue(false);
        const onShow = vi.fn<(r: DOMRect, i: LinkPopoverInfo) => void>();
        cleanup = createLinkPopover(editor, { onShow, onHide: () => {}, onMove: () => {}, getPopoverElement: () => el });

        hover(editor, linkTarget());
        vi.advanceTimersByTime(400);
        flushRaf();
        hover(editor, otherTarget);
        overPeek.mockReturnValue(true);
        vi.advanceTimersByTime(200);
        // Back onto the other link: the stack never changed, so no event says so.
        overPeek.mockReturnValue(false);
        vi.advanceTimersByTime(200);
        flushRaf();
        expect(onShow.mock.calls.map(([, i]) => i.href)).toEqual([HREF, OTHER]);
      });

      it("waits out the grace period through an edit", () => {
        const editor = makeEditor();
        const el = document.createElement("div");
        const overPeek = vi.spyOn(el, "matches").mockReturnValue(false);
        const onShow = vi.fn<(r: DOMRect, i: LinkPopoverInfo) => void>();
        cleanup = createLinkPopover(editor, { onShow, onHide: () => {}, onMove: () => {}, getPopoverElement: () => el });

        hover(editor, linkTarget());
        vi.advanceTimersByTime(400);
        flushRaf();
        hover(editor, otherTarget);
        editor.applyTransaction(editor.getState().tr.insertText("ab", 1));
        flushRaf();
        overPeek.mockReturnValue(true);
        vi.advanceTimersByTime(200);
        flushRaf();
        expect(onShow.mock.calls.map(([, i]) => i.href)).toEqual([HREF]);
      });

      it("keeps the peek the pointer reaches on the way", () => {
        const editor = makeEditor();
        const el = document.createElement("div");
        const overPeek = vi.spyOn(el, "matches").mockReturnValue(false);
        const onShow = vi.fn<(r: DOMRect, i: LinkPopoverInfo) => void>();
        cleanup = createLinkPopover(editor, { onShow, onHide: () => {}, onMove: () => {}, getPopoverElement: () => el });

        hover(editor, linkTarget());
        vi.advanceTimersByTime(400);
        flushRaf();
        hover(editor, otherTarget);
        overPeek.mockReturnValue(true);
        vi.advanceTimersByTime(200);
        flushRaf();
        expect(onShow.mock.calls.map(([, i]) => i.href)).toEqual([HREF]);
      });
    });

    describe("an edit while the pointer is off the link", () => {
      it("follows the peek the pointer reached across plain text", () => {
        const editor = makeEditor();
        const el = document.createElement("div");
        const overPeek = vi.spyOn(el, "matches").mockReturnValue(false);
        const onMove = vi.fn<(r: DOMRect, i: LinkPopoverInfo) => void>();
        const onHide = vi.fn();
        cleanup = createLinkPopover(editor, { onShow: () => {}, onHide, onMove, getPopoverElement: () => el });

        hover(editor, linkTarget());
        vi.advanceTimersByTime(400);
        flushRaf();
        hover(editor);
        overPeek.mockReturnValue(true);
        editor.applyTransaction(editor.getState().tr.insertText("abc", 1));
        vi.advanceTimersByTime(400);
        flushRaf();

        expect(onHide).not.toHaveBeenCalled();
        expect(onMove.mock.calls.at(-1)![1]).toMatchObject({ href: HREF, from: 7, to: 12 });
      });

      it("does not close the peek at once when the pointer is on another kind", () => {
        const editor = makeEditor();
        const table = find(editor, (n) => n === "table");
        const onHide = vi.fn();
        cleanup = createLinkPopover(editor, { onShow: () => {}, onHide, onMove: () => {} });

        hover(editor, linkTarget());
        vi.advanceTimersByTime(400);
        flushRaf();
        hover(editor, { kind: "table", surfaceId: "body", pos: table.pos, end: table.pos + table.size, at: table.pos });
        editor.applyTransaction(editor.getState().tr.insertText("ab", 1));
        flushRaf();
        expect(onHide).not.toHaveBeenCalled();

        vi.advanceTimersByTime(200);
        flushRaf();
        expect(onHide).toHaveBeenCalledTimes(1);
      });
    });

    it("dismisses at once by keyboard, even under the pointer", () => {
      const editor = makeEditor();
      const el = document.createElement("div");
      vi.spyOn(el, "matches").mockReturnValue(true);
      const onHide = vi.fn();
      cleanup = createLinkPopover(editor, { onShow: () => {}, onHide, onMove: () => {}, getPopoverElement: () => el });

      hover(editor, linkTarget());
      vi.advanceTimersByTime(400);
      flushRaf();
      editor.reportHover({ targets: [], point: null, dismissed: true });
      flushRaf();

      expect(onHide).toHaveBeenCalledTimes(1);
    });

    it("follows the shown link through an edit as the same link: onMove, not onShow", () => {
      const editor = makeEditor();
      const onShow = vi.fn<(r: DOMRect, i: LinkPopoverInfo) => void>();
      const onMove = vi.fn<(r: DOMRect, i: LinkPopoverInfo) => void>();
      cleanup = createLinkPopover(editor, { onShow, onHide: () => {}, onMove });

      editor.selection.moveCursorTo(6);
      flushRaf();
      editor.applyTransaction(editor.getState().tr.insertText("ab", 1));
      flushRaf();

      expect(onShow).toHaveBeenCalledTimes(1);
      expect(onMove.mock.calls.at(-1)![1]).toMatchObject({ href: HREF, from: 6, to: 11, presentation: "full" });
    });

    it("is the same link when a collaborator retypes its first character", () => {
      const editor = makeEditor();
      const onShow = vi.fn<(r: DOMRect, i: LinkPopoverInfo) => void>();
      const onMove = vi.fn<(r: DOMRect, i: LinkPopoverInfo) => void>();
      cleanup = createLinkPopover(editor, { onShow, onHide: () => {}, onMove });

      editor.selection.moveCursorTo(6);
      flushRaf();
      const linkMark = editor.schema.marks["link"]!.create({ href: HREF });
      editor.applyTransaction(editor.getState().tr.replaceWith(4, 5, editor.schema.text("T", [linkMark])));
      flushRaf();

      expect(onShow).toHaveBeenCalledTimes(1);
      expect(onMove).toHaveBeenCalled();
    });

    it("shows a different link as a new one: onShow", () => {
      const editor = makeEditor();
      const onShow = vi.fn<(r: DOMRect, i: LinkPopoverInfo) => void>();
      cleanup = createLinkPopover(editor, { onShow, onHide: () => {}, onMove: () => {} });

      editor.selection.moveCursorTo(6);
      flushRaf();
      editor.selection.moveCursorTo(15);
      flushRaf();

      expect(onShow.mock.calls.map(([, info]) => info.href)).toEqual([HREF, OTHER]);
    });

    describe("a link on two lines", () => {
      const lineOne = rect(100, 300, 200, 16);
      const lineTwo = rect(120, 72, 80, 16);

      /** The link's parts are `lines`; any one character's own rect sits at `charTop`. */
      function twoLineEditor(charTop: number, lines = [lineOne, lineTwo]): Editor {
        const editor = makeEditor();
        const charLeft = lines.find((line) => line.top === charTop)?.left ?? 80;
        vi.spyOn(editor, "getRangeViewportRects").mockImplementation((from, to) =>
          to - from === 1 ? [rect(charTop, charLeft, 8, 16)] : lines);
        return editor;
      }

      it("peeks under the line the pointer rests on", () => {
        const editor = twoLineEditor(lineTwo.top);
        const onShow = vi.fn<(r: DOMRect, i: LinkPopoverInfo) => void>();
        cleanup = createLinkPopover(editor, { onShow, onHide: () => {}, onMove: () => {} });

        hover(editor, { ...linkTarget(), at: 8 });
        vi.advanceTimersByTime(400);
        flushRaf();
        expect(onShow.mock.calls[0]![0].top).toBe(lineTwo.top);
      });

      it("peeks under the line the pointer moved to while it waited", () => {
        const editor = twoLineEditor(lineTwo.top);
        const charAt = vi.spyOn(editor, "getRangeViewportRects");
        const onShow = vi.fn<(r: DOMRect, i: LinkPopoverInfo) => void>();
        cleanup = createLinkPopover(editor, { onShow, onHide: () => {}, onMove: () => {} });

        hover(editor, { ...linkTarget(), at: 5 });
        vi.advanceTimersByTime(200);
        hover(editor, { ...linkTarget(), at: 8 });
        vi.advanceTimersByTime(200);
        flushRaf();
        expect(charAt).toHaveBeenLastCalledWith(8, 9);
        expect(onShow.mock.calls[0]![0].top).toBe(lineTwo.top);
      });

      it("shows full under the line the caret is on", () => {
        const editor = twoLineEditor(lineTwo.top);
        const onShow = vi.fn<(r: DOMRect, i: LinkPopoverInfo) => void>();
        cleanup = createLinkPopover(editor, { onShow, onHide: () => {}, onMove: () => {} });

        editor.selection.moveCursorTo(8);
        flushRaf();
        expect(onShow.mock.calls[0]![0].top).toBe(lineTwo.top);
      });

      it("shows full under the last line when the caret sits just past the link", () => {
        const editor = twoLineEditor(lineTwo.top);
        const charAt = vi.spyOn(editor, "getRangeViewportRects");
        cleanup = createLinkPopover(editor, { onShow: () => {}, onHide: () => {}, onMove: () => {} });

        editor.selection.moveCursorTo(9);
        flushRaf();
        expect(charAt).toHaveBeenLastCalledWith(8, 9);
      });

      describe("with a floating image in the link", () => {
        const image = rect(100, 72, 80, 60);
        const lineBeside = rect(120, 160, 200, 16);

        function withImage(): Editor {
          const editor = makeEditor();
          vi.spyOn(editor, "getRangeViewportRects").mockImplementation((from, to) => {
            if (to - from !== 1) return [image, rect(100, 160, 200, 16), lineBeside];
            return from === 6 ? [image] : [rect(lineBeside.top, 200, 8, 16)];
          });
          return editor;
        }

        it("peeks under the text line the pointer is on, not the image beside it", () => {
          const editor = withImage();
          const onShow = vi.fn<(r: DOMRect, i: LinkPopoverInfo) => void>();
          cleanup = createLinkPopover(editor, { onShow, onHide: () => {}, onMove: () => {} });

          hover(editor, { ...linkTarget(), at: 8 });
          vi.advanceTimersByTime(400);
          flushRaf();
          expect(onShow.mock.calls[0]![0]).toEqual(lineBeside);
        });

        it("peeks under the image when the pointer is on it", () => {
          const editor = withImage();
          const onShow = vi.fn<(r: DOMRect, i: LinkPopoverInfo) => void>();
          cleanup = createLinkPopover(editor, { onShow, onHide: () => {}, onMove: () => {} });

          hover(editor, { ...linkTarget(), at: 6 });
          vi.advanceTimersByTime(400);
          flushRaf();
          expect(onShow.mock.calls[0]![0]).toEqual(image);
        });
      });

      it("shows on the part still on screen when the hovered part scrolled away", () => {
        const offscreen = rect(-200, 300, 200, 16);
        const editor = twoLineEditor(offscreen.top, [offscreen, lineTwo]);
        const onShow = vi.fn<(r: DOMRect, i: LinkPopoverInfo) => void>();
        const onHide = vi.fn();
        cleanup = createLinkPopover(editor, { onShow, onHide, onMove: () => {} });

        hover(editor, { ...linkTarget(), at: 5 });
        vi.advanceTimersByTime(400);
        flushRaf();
        expect(onShow.mock.calls[0]![0].top).toBe(lineTwo.top);
      });
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

    it("peeks the second of two links in a paragraph with its own href", () => {
      const editor = makeEditor();
      const onShow = vi.fn<(r: DOMRect, i: LinkPopoverInfo) => void>();
      cleanup = createLinkPopover(editor, { onShow, onHide: () => {}, onMove: () => {} });

      // "there" ends at 9, " or " runs to 13, "here" is 13–17.
      hover(editor, { kind: "link", surfaceId: "body", pos: 13, end: 17, at: 13 });
      vi.advanceTimersByTime(400);
      flushRaf();
      expect(onShow.mock.calls[0]![1]).toEqual({ href: OTHER, from: 13, to: 17, presentation: "peek" });
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
      cleanup = createImageMenu(editor, { onShow, onHide: () => {}, onMove, hover: true });

      hover(editor, { kind: "image", surfaceId: "body", pos: image.pos, end: image.pos + image.size, at: image.pos });
      vi.advanceTimersByTime(400);
      flushRaf();
      expect(onShow.mock.calls[0]![1]).toMatchObject({ docPos: image.pos, presentation: "peek" });

      editor.selectNode(image.pos);
      flushRaf();
      expect(onShow).toHaveBeenCalledTimes(1);
      expect(onMove.mock.calls.at(-1)![1].presentation).toBe("full");
    });

    it("follows the shown image through an edit as the same image: onMove, not onShow", () => {
      const editor = makeEditor();
      const image = find(editor, (n) => n === "image");
      const onShow = vi.fn<(r: DOMRect, i: ImageMenuInfo) => void>();
      const onMove = vi.fn<(r: DOMRect, i: ImageMenuInfo) => void>();
      cleanup = createImageMenu(editor, { onShow, onHide: () => {}, onMove });

      editor.selectNode(image.pos);
      flushRaf();
      editor.applyTransaction(editor.getState().tr.insertText("ab", 1));
      flushRaf();

      expect(onShow).toHaveBeenCalledTimes(1);
      expect(onMove.mock.calls.at(-1)![1].docPos).toBe(image.pos + 2);
    });

    it("is the same image when a collaborator resizes the one peeked", () => {
      const editor = makeEditor();
      const image = find(editor, (n) => n === "image");
      const onShow = vi.fn<(r: DOMRect, i: ImageMenuInfo) => void>();
      const onMove = vi.fn<(r: DOMRect, i: ImageMenuInfo) => void>();
      cleanup = createImageMenu(editor, { onShow, onHide: () => {}, onMove, hover: true });

      hover(editor, { kind: "image", surfaceId: "body", pos: image.pos, end: image.pos + image.size, at: image.pos });
      vi.advanceTimersByTime(400);
      flushRaf();
      const node = editor.getState().doc.nodeAt(image.pos)!;
      editor.applyTransaction(editor.getState().tr.setNodeMarkup(image.pos, undefined, { ...node.attrs, width: 120 }));
      flushRaf();

      expect(onShow).toHaveBeenCalledTimes(1);
      expect(onMove).toHaveBeenCalled();
    });

    it("does not peek by default", () => {
      const editor = makeEditor();
      const image = find(editor, (n) => n === "image");
      const onShow = vi.fn();
      cleanup = createImageMenu(editor, { onShow, onHide: () => {}, onMove: () => {} });

      hover(editor, { kind: "image", surfaceId: "body", pos: image.pos, end: image.pos + image.size, at: image.pos });
      vi.advanceTimersByTime(1000);
      flushRaf();
      expect(onShow).not.toHaveBeenCalled();
    });

    it("stays hidden for a selection that is not an image", () => {
      const editor = makeEditor();
      const onShow = vi.fn();
      cleanup = createImageMenu(editor, { onShow, onHide: () => {}, onMove: () => {} });

      // Cell selections have node actions too; they are not images.
      selectCells(editor);
      flushRaf();
      expect(onShow).not.toHaveBeenCalled();
    });
  });

  describe("table", () => {
    it("peeks the table's shape on hover", () => {
      const editor = makeEditor();
      const table = find(editor, (n) => n === "table");
      const onShow = vi.fn<(r: DOMRect, i: TableMenuInfo) => void>();
      cleanup = createTableMenu(editor, { onShow, onHide: () => {}, onMove: () => {}, hover: true });

      hover(editor, { kind: "table", surfaceId: "body", pos: table.pos, end: table.pos + table.size, at: table.pos });
      vi.advanceTimersByTime(400);
      flushRaf();

      expect(onShow).toHaveBeenCalledTimes(1);
      const [anchor, info] = onShow.mock.calls[0]!;
      expect(info).toEqual({ docPos: table.pos, rows: 2, columns: 3, headerRow: false, presentation: "peek" });
      expect(anchor.height).toBe(1);
    });

    it("follows the shown table through an edit as the same table: onMove, not onShow", () => {
      const editor = makeEditor();
      const table = find(editor, (n) => n === "table");
      const onShow = vi.fn<(r: DOMRect, i: TableMenuInfo) => void>();
      const onMove = vi.fn<(r: DOMRect, i: TableMenuInfo) => void>();
      cleanup = createTableMenu(editor, { onShow, onHide: () => {}, onMove });

      selectCells(editor);
      flushRaf();
      editor.applyTransaction(editor.getState().tr.insertText("ab", 1));
      flushRaf();

      expect(onShow).toHaveBeenCalledTimes(1);
      expect(onMove.mock.calls.at(-1)![1].docPos).toBe(table.pos + 2);
    });

    it("is the same table when one of its own actions changes its grid", () => {
      const editor = makeEditor();
      const table = find(editor, (n) => n === "table");
      const onShow = vi.fn<(r: DOMRect, i: TableMenuInfo) => void>();
      const onMove = vi.fn<(r: DOMRect, i: TableMenuInfo) => void>();
      cleanup = createTableMenu(editor, { onShow, onHide: () => {}, onMove });

      selectCells(editor);
      flushRaf();
      const node = editor.getState().doc.nodeAt(table.pos)!;
      editor.applyTransaction(editor.getState().tr.setNodeMarkup(table.pos, undefined, { ...node.attrs, grid: [120, 100, 100] }));
      flushRaf();

      expect(onShow).toHaveBeenCalledTimes(1);
      expect(onMove).toHaveBeenCalled();
    });

    it("peeks while the pointer keeps moving between cells", () => {
      const editor = makeEditor();
      const table = find(editor, (n) => n === "table");
      const tableTarget: HoverTarget = { kind: "table", surfaceId: "body", pos: table.pos, end: table.pos + table.size, at: table.pos };
      const onShow = vi.fn();
      cleanup = createTableMenu(editor, { onShow, onHide: () => {}, onMove: () => {}, hover: true });

      // Each cell is a new stack, but the table under it never changes.
      const [a, b] = cellPositions(editor);
      for (const cell of [a!, b!, a!]) {
        hover(editor, { kind: "table-cell", surfaceId: "body", pos: cell, end: cell + 1, at: cell }, tableTarget);
        vi.advanceTimersByTime(200);
      }
      flushRaf();
      expect(onShow).toHaveBeenCalledTimes(1);
    });

    it("anchors to the first fragment on screen, clamped to the container", () => {
      const editor = makeEditor();
      const table = find(editor, (n) => n === "table");
      const onShow = vi.fn<(r: DOMRect, i: TableMenuInfo) => void>();
      // The first page's fragment is scrolled away; the next starts above the container top.
      vi.spyOn(editor, "getNodeViewportRects").mockReturnValue([
        rect(-900, 72, 300, 80),
        rect(-40, 72, 300, 400),
      ]);
      cleanup = createTableMenu(editor, { onShow, onHide: () => {}, onMove: () => {}, hover: true });

      hover(editor, { kind: "table", surfaceId: "body", pos: table.pos, end: table.pos + table.size, at: table.pos });
      vi.advanceTimersByTime(400);
      flushRaf();

      const [anchor] = onShow.mock.calls[0]!;
      expect(anchor.top).toBe(0);
      expect(anchor.left).toBe(72);
    });

    it("shows full for a cell selection, with the Table extension's actions", () => {
      const editor = makeEditor();
      const table = find(editor, (n) => n === "table");
      const onShow = vi.fn<(r: DOMRect, i: TableMenuInfo) => void>();
      cleanup = createTableMenu(editor, { onShow, onHide: () => {}, onMove: () => {} });

      selectCells(editor);
      flushRaf();

      expect(onShow.mock.calls.at(-1)![1]).toMatchObject({ docPos: table.pos, presentation: "full" });
      expect(editor.getNodeActions().map((a) => a.id)).toEqual([
        "table.addRowBefore",
        "table.addRowAfter",
        "table.deleteRow",
        "table.addColumnBefore",
        "table.addColumnAfter",
        "table.deleteColumn",
        "table.delete",
      ]);
    });

    it("peeks a cell selection in a read-only editor, which has no actions", () => {
      const editor = makeEditor();
      const onShow = vi.fn<(r: DOMRect, i: TableMenuInfo) => void>();
      cleanup = createTableMenu(editor, { onShow, onHide: () => {}, onMove: () => {} });

      selectCells(editor);
      editor.setReadOnly(true);
      flushRaf();

      expect(onShow.mock.calls.at(-1)![1].presentation).toBe("peek");
      expect(editor.getNodeActions()).toEqual([]);
    });

    it("runs a table action through the editor", async () => {
      const editor = makeEditor();
      selectCells(editor);
      await editor.runNodeAction("table.addRowAfter");
      const table = editor.getState().doc.nodeAt(find(editor, (n) => n === "table").pos)!;
      expect(table.childCount).toBe(3);
    });
  });
});
