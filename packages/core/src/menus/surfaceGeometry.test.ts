/**
 * Geometry is asked of the document a position belongs to. While a header or
 * footer is being edited, positions are that surface's; the body's layout
 * cannot place them, and must not answer with whatever body node shares the
 * number.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestEditor, registerActiveSurface } from "../test-utils";
import { StarterKit } from "../extensions/StarterKit";
import type { Editor } from "../Editor";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

/** A body that is one table, its pages placed on screen as the tile manager places them. */
function mountedWithTable(): Editor {
  const cell = { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "c" }] }] };
  editor = createTestEditor({
    extensions: [StarterKit.configure({ table: true })],
    content: { type: "doc", content: [{ type: "table", attrs: { grid: [200] }, content: [{ type: "tableRow", content: [cell] }] }] },
  });
  editor.setPageTopLookup(() => ({ screenLeft: 0, screenTop: 0 }));
  editor.ensurePagePopulated(1);
  return editor;
}

describe("node geometry while a surface is edited", () => {
  it("places the body's node when the body is edited", () => {
    expect(mountedWithTable().getNodeViewportRects(0)).not.toEqual([]);
  });

  it("does not answer a surface position with the body node at the same number", () => {
    const e = mountedWithTable();
    registerActiveSurface(e);
    expect(e.getNodeViewportRects(0)).toEqual([]);
  });
});
