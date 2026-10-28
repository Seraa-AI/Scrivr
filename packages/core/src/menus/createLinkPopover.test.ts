import { describe, it, expect, vi, afterEach } from "vitest";
import { createTestEditor } from "../test-utils";
import { createLinkPopover, type LinkPopoverInfo } from "./createLinkPopover";
import type { Editor } from "../Editor";

function rect(top: number, left: number, w: number, h: number): DOMRect {
  return {
    top, left, width: w, height: h, right: left + w, bottom: top + h, x: left, y: top,
    toJSON: () => ({}),
  };
}

function link(text: string, href: string, dataTracked: unknown[] = []) {
  return { type: "text", text, marks: [{ type: "link", attrs: { href, dataTracked } }] };
}

function editorWithParagraph(content: unknown[]): Editor {
  return createTestEditor({
    content: { type: "doc", content: [{ type: "paragraph", content }] },
  });
}

/** Document range of the first occurrence of `text`. */
function rangeOf(editor: Editor, text: string): { from: number; to: number } {
  const ranges: { from: number; to: number }[] = [];
  editor.getState().doc.descendants((node, pos) => {
    const index = node.isText ? (node.text?.indexOf(text) ?? -1) : -1;
    if (index >= 0) ranges.push({ from: pos + index, to: pos + index + text.length });
  });
  const range = ranges[0];
  if (!range) throw new Error(`no "${text}" in the document`);
  return range;
}

// The popover defers its update through requestAnimationFrame; queue the
// callbacks and flush them explicitly.
function stubRaf(): () => void {
  const queued: FrameRequestCallback[] = [];
  let next = 1;
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
    queued.push(cb);
    return next++;
  });
  return () => queued.splice(0).forEach((cb) => cb(0));
}

describe("createLinkPopover", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    cleanup?.();
    cleanup = null;
    vi.restoreAllMocks();
  });

  function linkUnderCaret(editor: Editor, caret: number): LinkPopoverInfo {
    vi.spyOn(editor, "getScrollContainerRect").mockReturnValue(rect(0, 0, 1000, 1000));
    vi.spyOn(editor, "getViewportRect").mockReturnValue(rect(100, 100, 80, 20));
    const flushRaf = stubRaf();
    const onShow = vi.fn<(r: DOMRect, i: LinkPopoverInfo) => void>();
    cleanup = createLinkPopover(editor, { onShow, onHide: () => {}, onMove: () => {} });

    editor.selection.moveCursorTo(caret);
    flushRaf();

    expect(onShow).toHaveBeenCalledTimes(1);
    return onShow.mock.calls[0]![1];
  }

  it("covers only the link under the caret when the paragraph holds another", () => {
    const editor = editorWithParagraph([
      link("alpha", "https://a.example"),
      { type: "text", text: " middle " },
      link("beta", "https://b.example"),
    ]);
    const beta = rangeOf(editor, "beta");

    const info = linkUnderCaret(editor, beta.from + 2);

    expect(info).toEqual({ href: "https://b.example", ...beta });
  });

  it("finds the link when the caret sits just past its last character", () => {
    const editor = editorWithParagraph([
      link("alpha", "https://a.example"),
      { type: "text", text: " middle " },
      link("beta", "https://b.example"),
    ]);
    const alpha = rangeOf(editor, "alpha");

    const info = linkUnderCaret(editor, alpha.to);

    expect(info).toEqual({ href: "https://a.example", ...alpha });
  });

  it("stops where an adjacent link with a different href begins", () => {
    const editor = editorWithParagraph([
      link("alpha", "https://a.example"),
      link("beta", "https://b.example"),
    ]);
    const alpha = rangeOf(editor, "alpha");

    const info = linkUnderCaret(editor, alpha.from + 2);

    expect(info).toEqual({ href: "https://a.example", ...alpha });
  });

  it("spans a link whose text carries other marks part of the way", () => {
    const editor = editorWithParagraph([
      link("plain ", "https://a.example"),
      { type: "text", text: "bold", marks: [{ type: "bold" }, { type: "link", attrs: { href: "https://a.example" } }] },
      { type: "text", text: " after" },
    ]);
    const whole = rangeOf(editor, "plain ");

    const info = linkUnderCaret(editor, whole.from + 2);

    expect(info).toEqual({ href: "https://a.example", from: whole.from, to: rangeOf(editor, "bold").to });
  });

  it("finds a one-character link when the caret sits just past it", () => {
    const editor = editorWithParagraph([
      { type: "text", text: "x " },
      link("b", "https://b.example"),
      { type: "text", text: " y" },
    ]);
    const b = rangeOf(editor, "b");

    const info = linkUnderCaret(editor, b.to);

    expect(info).toEqual({ href: "https://b.example", ...b });
  });

  it("treats one href split by tracking metadata as one link", () => {
    const editor = editorWithParagraph([
      link("foo ", "https://a.example", [{ id: "t1" }]),
      link("bar", "https://a.example", [{ id: "t2" }]),
    ]);
    const foo = rangeOf(editor, "foo ");

    const info = linkUnderCaret(editor, foo.from + 2);

    expect(info).toEqual({ href: "https://a.example", from: foo.from, to: rangeOf(editor, "bar").to });
  });
});
