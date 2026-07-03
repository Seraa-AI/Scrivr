import { describe, it, expect, vi, afterEach } from "vitest";
import { createTestEditor } from "../test-utils";
import { StarterKit } from "../extensions/StarterKit";
import { DefaultContent } from "../extensions/built-in/DefaultContent";
import { defaultPageConfig } from "../layout/PageLayout";
import { PointerController, type PointerControllerDeps } from "./PointerController";
import { selectedCells } from "../table/cellSelection";
import type { Editor } from "../Editor";
import type { LayoutBlock } from "../layout/BlockLayout";

/**
 * Cell drag-select through the real PointerController: pointerdown in one cell,
 * pointermove into another cell, sets the persisted CellRange (cells are
 * `isolating`, so a spanning text selection is impossible).
 *
 * Coordinates map 1:1 to doc coords via the pinned container rect (happy-dom
 * has no real layout), so a pointer at a cell's laid-out center hit-tests to
 * that cell.
 */

function pointerEvent(type: string, x: number, y: number): Event {
  const Ctor = globalThis.PointerEvent ?? MouseEvent;
  return new Ctor(type, { clientX: x, clientY: y, pointerId: 1, bubbles: true, cancelable: true });
}

function tableDoc(cols: number) {
  return {
    type: "doc",
    content: [
      {
        type: "table",
        attrs: { layout: "fixed", grid: Array.from({ length: cols }, () => 120) },
        content: [
          {
            type: "tableRow",
            content: Array.from({ length: cols }, (_, i) => ({
              type: "tableCell",
              content: [{ type: "paragraph", content: [{ type: "text", text: `c${i}` }] }],
            })),
          },
        ],
      },
    ],
  };
}

function setup(cols: number) {
  const editor = createTestEditor({
    pageConfig: defaultPageConfig,
    extensions: [StarterKit.configure({ table: true }), DefaultContent.configure({ json: tableDoc(cols) })],
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 1200, width: 800, height: 1200, toJSON: () => ({}),
  });
  const deps: PointerControllerDeps = {
    editor,
    tilesContainer: container,
    pool: [],
    slotHeight: () => 1224,
    tileHeight: () => 1200,
    isPageless: () => false,
    visualYToDocY: (y) => ({ page: Math.floor(y / 1224) + 1, docY: y - Math.floor(y / 1224) * 1224 }),
    scheduleUpdate: () => {},
  };
  const controller = new PointerController(deps);
  controller.attach();
  editor.ensurePagePopulated(1);

  const rowBlock = (): LayoutBlock => {
    for (const p of editor.layout.pages) for (const b of p.blocks) if (b.kind === "tableRow") return b;
    throw new Error("no row block");
  };
  return {
    editor,
    container,
    rowBlock,
    cleanup: () => {
      controller.detach();
      container.remove();
      editor.destroy();
    },
  };
}

function center(row: LayoutBlock, i: number): { x: number; y: number } {
  const c = row.cells![i]!;
  return { x: c.x + c.width / 2, y: row.y + c.y + c.height / 2 };
}

describe("PointerController — cell drag-select", () => {
  let clean: (() => void) | null = null;
  afterEach(() => {
    clean?.();
    clean = null;
  });

  it("dragging from one cell into another sets a 2-cell persisted range", () => {
    const s = setup(3);
    clean = s.cleanup;
    const row = s.rowBlock();
    const a = center(row, 0);
    const b = center(row, 1);

    s.container.dispatchEvent(pointerEvent("pointerdown", a.x, a.y));
    document.dispatchEvent(pointerEvent("pointermove", b.x, b.y));
    document.dispatchEvent(pointerEvent("pointerup", b.x, b.y));

    const sel = selectedCells(s.editor.getState());
    expect(sel?.cellPositions).toHaveLength(2);
    expect(sel?.rect).toEqual({ left: 0, top: 0, right: 2, bottom: 1 });
  });

  it("a click that stays in one cell leaves no cell selection (text caret only)", () => {
    const s = setup(3);
    clean = s.cleanup;
    const row = s.rowBlock();
    const a = center(row, 0);

    s.container.dispatchEvent(pointerEvent("pointerdown", a.x, a.y));
    document.dispatchEvent(pointerEvent("pointermove", a.x + 2, a.y));
    document.dispatchEvent(pointerEvent("pointerup", a.x + 2, a.y));

    expect(selectedCells(s.editor.getState())).toBeNull();
  });

  it("dragging back into the anchor cell drops the range", () => {
    const s = setup(3);
    clean = s.cleanup;
    const row = s.rowBlock();
    const a = center(row, 0);
    const b = center(row, 1);

    s.container.dispatchEvent(pointerEvent("pointerdown", a.x, a.y));
    document.dispatchEvent(pointerEvent("pointermove", b.x, b.y));
    expect(selectedCells(s.editor.getState())?.cellPositions).toHaveLength(2);
    document.dispatchEvent(pointerEvent("pointermove", a.x, a.y)); // back into anchor
    document.dispatchEvent(pointerEvent("pointerup", a.x, a.y));

    expect(selectedCells(s.editor.getState())).toBeNull();
  });
});
