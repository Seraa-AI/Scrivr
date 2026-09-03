import { describe, it, expect, vi, afterEach } from "vitest";
import { createTestEditor } from "../test-utils";
import { StarterKit } from "../extensions/StarterKit";
import { DefaultContent } from "../extensions/built-in/DefaultContent";
import { defaultPageConfig } from "../layout/PageLayout";
import { PointerController, type PointerControllerDeps } from "./PointerController";
import { CellSelection, selectedCells } from "../table/cellSelection";
import { cellHitTester } from "../table/cellSelectionSeam";
import type { LayoutBlock } from "../layout/BlockLayout";

/**
 * Regressions found after the CellSelection seam landed:
 *  - clicking a cell must place the caret through the *focusing* selection API
 *    (not a raw transaction), or the hidden textarea loses focus and keyboard /
 *    follow-up selections break;
 *  - a cell selection must not "stick" — clicking the body clears it;
 *  - a body text drag past a table still selects body text.
 */

function pointerEvent(type: string, x: number, y: number): Event {
  const Ctor = globalThis.PointerEvent ?? MouseEvent;
  return new Ctor(type, { clientX: x, clientY: y, pointerId: 1, bubbles: true, cancelable: true, detail: 1 });
}

function doc() {
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "before the table" }] },
      {
        type: "table",
        attrs: { layout: "fixed", grid: [120, 120] },
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "c0" }] }] },
              { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "c1" }] }] },
            ],
          },
        ],
      },
      { type: "paragraph", content: [{ type: "text", text: "after the table" }] },
    ],
  };
}

function setup() {
  const editor = createTestEditor({
    pageConfig: defaultPageConfig,
    extensions: [StarterKit.configure({ table: true }), DefaultContent.configure({ json: doc() })],
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

  const blocks = (): LayoutBlock[] => editor.layout.pages.flatMap((p) => p.blocks);
  const rowBlock = (): LayoutBlock => {
    for (const b of blocks()) if (b.kind === "tableRow") return b;
    throw new Error("no row block");
  };
  return {
    editor,
    container,
    blocks,
    rowBlock,
    cleanup: () => { controller.detach(); container.remove(); editor.destroy(); },
  };
}

function cellCenter(row: LayoutBlock, i: number): { x: number; y: number } {
  const c = row.cells![i]!;
  return { x: c.x + c.width / 2, y: row.y + c.y + c.height / 2 };
}

describe("cell-selection regressions", () => {
  let clean: (() => void) | null = null;
  afterEach(() => { clean?.(); clean = null; });

  it("a click in a cell places the caret through the focusing selection API", () => {
    const s = setup();
    clean = s.cleanup;
    const spy = vi.spyOn(s.editor.selection, "moveCursorTo");
    const a = cellCenter(s.rowBlock(), 0);

    s.container.dispatchEvent(pointerEvent("pointerdown", a.x, a.y));
    document.dispatchEvent(pointerEvent("pointerup", a.x, a.y));

    // moveCursorTo focuses the hidden textarea — a raw setSelection transaction
    // would not, breaking keyboard input after the click.
    expect(spy).toHaveBeenCalled();
    expect(s.editor.getState().selection).not.toBeInstanceOf(CellSelection);
  });

  it("after a cell selection, clicking the body clears it to a caret", () => {
    const s = setup();
    clean = s.cleanup;
    const row = s.rowBlock();
    const a = cellCenter(row, 0);
    const b = cellCenter(row, 1);

    s.container.dispatchEvent(pointerEvent("pointerdown", a.x, a.y));
    document.dispatchEvent(pointerEvent("pointermove", b.x, b.y));
    document.dispatchEvent(pointerEvent("pointerup", b.x, b.y));
    expect(s.editor.getState().selection).toBeInstanceOf(CellSelection);

    const after = s.blocks().find((bl) => bl.kind !== "tableRow" && bl.y > row.y)!;
    const y = after.y + after.height / 2;
    s.container.dispatchEvent(pointerEvent("pointerdown", 60, y));
    document.dispatchEvent(pointerEvent("pointerup", 60, y));

    expect(s.editor.getState().selection).not.toBeInstanceOf(CellSelection);
    expect(s.editor.getState().selection.empty).toBe(true);
  });

  it("a body text drag past the table still selects body text", () => {
    const s = setup();
    clean = s.cleanup;
    const row = s.rowBlock();
    const before = s.blocks().find((bl) => bl.kind !== "tableRow" && bl.y < row.y)!;
    const after = s.blocks().find((bl) => bl.kind !== "tableRow" && bl.y > row.y)!;

    const startY = before.y + before.height / 2;
    const endY = after.y + after.height / 2;
    s.container.dispatchEvent(pointerEvent("pointerdown", 40, startY));
    for (let y = startY; y <= endY; y += 20) {
      document.dispatchEvent(pointerEvent("pointermove", 80, y));
    }
    document.dispatchEvent(pointerEvent("pointerup", 80, endY));

    expect(s.editor.getState().selection.empty).toBe(false);
  });

  it("a drag that starts in a cell and leaves the table selects the whole table + body", () => {
    const s = setup();
    clean = s.cleanup;
    const row = s.rowBlock();
    const a = cellCenter(row, 0);
    const after = s.blocks().find((bl) => bl.kind !== "tableRow" && bl.y > row.y)!;
    const endY = after.y + after.height / 2;

    s.container.dispatchEvent(pointerEvent("pointerdown", a.x, a.y));
    document.dispatchEvent(pointerEvent("pointermove", 60, endY)); // out into the body
    document.dispatchEvent(pointerEvent("pointerup", 60, endY));

    const state = s.editor.getState();
    const sel = state.selection;
    expect(sel).not.toBeInstanceOf(CellSelection);
    expect(sel.empty).toBe(false);
    // The range must swallow the whole table (its anchor snapped out of the cell).
    expect(sel.from).toBeLessThanOrEqual(row.nodePos);
    expect(sel.to).toBeGreaterThan(row.nodePos);
  });

  it("the cell hit tester keeps the caret inside the hit cell even if posAtCoords disagrees", () => {
    const s = setup();
    clean = s.cleanup;
    const row = s.rowBlock();
    const over = cellCenter(row, 1); // pointer geometrically over cell 1

    // Cell node positions.
    const cellPositions: number[] = [];
    s.editor.getState().doc.descendants((n, pos) => {
      if (n.type.name === "tableCell") cellPositions.push(pos);
    });
    const cell0 = cellPositions[0]!;
    const cell1 = cellPositions[1]!;
    const cell1Node = s.editor.getState().doc.nodeAt(cell1)!;

    // posAtCoords deliberately reports a caret inside cell 0 (the "wrong" cell,
    // as happens near a cell's padding). The hit tester must clamp it to cell 1.
    const hit = cellHitTester.hitTest(over.x, over.y, 1, {
      editor: s.editor,
      state: s.editor.getState(),
      posAtCoords: () => cell0 + 2,
    });

    expect(hit).not.toBeNull();
    expect(hit!.pos).toBeGreaterThanOrEqual(cell1 + 1);
    expect(hit!.pos).toBeLessThanOrEqual(cell1 + cell1Node.nodeSize - 1);
  });

  it("a text selection spanning the table paints no text bands over the table interior", () => {
    const s = setup();
    clean = s.cleanup;
    const row = s.rowBlock();

    // Select from the "before" paragraph to the "after" paragraph (spans table).
    const doc = s.editor.getState().doc;
    let beforePos = -1;
    let afterPos = -1;
    doc.descendants((n, pos) => {
      if (n.isText && n.text?.startsWith("before")) beforePos = pos + 1;
      if (n.isText && n.text?.startsWith("after")) afterPos = pos + 1;
    });
    s.editor.selection.setSelection(beforePos, afterPos);

    const sel = s.editor.getState().selection;
    const prims = s.editor.selectionRegistry.resolve(sel).geometry(sel, {
      state: s.editor.getState(),
      layout: s.editor.layout,
      charMap: s.editor.charMap,
      page: 1,
      nodeRectAt: (p) => s.editor.getNodeRect(p),
    });
    const fillRects = prims.flatMap((p) => (p.type === "fill" ? p.rects : []));
    expect(fillRects.length).toBeGreaterThan(0); // the body text is still banded

    // The table's interior (its row y-band) is deferred to the table wash, so no
    // text band should overlap it.
    const rowTop = row.y;
    const rowBottom = row.y + row.height;
    for (const r of fillRects) {
      const overlapsTable = r.y < rowBottom && r.y + r.height > rowTop;
      expect(overlapsTable).toBe(false);
    }
  });

  it("double-click in a cell selects the word, not the cell", () => {
    const s = setup();
    clean = s.cleanup;
    const a = cellCenter(s.rowBlock(), 0);

    // Two clicks at the same spot = double-click (clickCount tracked by timing +
    // position, not event.detail).
    s.container.dispatchEvent(pointerEvent("pointerdown", a.x, a.y));
    document.dispatchEvent(pointerEvent("pointerup", a.x, a.y));
    s.container.dispatchEvent(pointerEvent("pointerdown", a.x, a.y));
    document.dispatchEvent(pointerEvent("pointerup", a.x, a.y));

    const state = s.editor.getState();
    expect(state.selection).not.toBeInstanceOf(CellSelection);
    expect(state.selection.empty).toBe(false);
    expect(state.doc.textBetween(state.selection.from, state.selection.to)).toBe("c0");
  });

  it("triple-click in a cell selects the cell's text, not the cell", () => {
    const s = setup();
    clean = s.cleanup;
    const a = cellCenter(s.rowBlock(), 0);

    for (let i = 0; i < 3; i++) {
      s.container.dispatchEvent(pointerEvent("pointerdown", a.x, a.y));
      document.dispatchEvent(pointerEvent("pointerup", a.x, a.y));
    }

    const state = s.editor.getState();
    expect(state.selection).not.toBeInstanceOf(CellSelection);
    expect(state.doc.textBetween(state.selection.from, state.selection.to)).toBe("c0");
  });

  it("shift-click extends a caret in a cell into a rectangular CellSelection", () => {
    const s = setup();
    clean = s.cleanup;
    const row = s.rowBlock();
    const a = cellCenter(row, 0);
    const b = cellCenter(row, 1);

    // Place a caret in cell 0.
    s.container.dispatchEvent(pointerEvent("pointerdown", a.x, a.y));
    document.dispatchEvent(pointerEvent("pointerup", a.x, a.y));
    expect(s.editor.getState().selection).not.toBeInstanceOf(CellSelection);

    // Shift-click cell 1 → a two-cell CellSelection (not a text selection).
    const Ctor = globalThis.PointerEvent ?? MouseEvent;
    s.container.dispatchEvent(
      new Ctor("pointerdown", {
        clientX: b.x, clientY: b.y, pointerId: 1, bubbles: true, cancelable: true, detail: 1, shiftKey: true,
      }),
    );
    document.dispatchEvent(pointerEvent("pointerup", b.x, b.y));

    expect(s.editor.getState().selection).toBeInstanceOf(CellSelection);
    expect(selectedCells(s.editor.getState())?.cellPositions).toHaveLength(2);
  });

  it("shift-click inside the same cell remains a text selection", () => {
    const s = setup();
    clean = s.cleanup;
    const a = cellCenter(s.rowBlock(), 0);

    s.container.dispatchEvent(pointerEvent("pointerdown", a.x, a.y));
    document.dispatchEvent(pointerEvent("pointerup", a.x, a.y));

    const Ctor = globalThis.PointerEvent ?? MouseEvent;
    s.container.dispatchEvent(
      new Ctor("pointerdown", {
        clientX: a.x + 2, clientY: a.y, pointerId: 1, bubbles: true,
        cancelable: true, detail: 1, shiftKey: true,
      }),
    );
    document.dispatchEvent(pointerEvent("pointerup", a.x + 2, a.y));

    expect(s.editor.getState().selection).not.toBeInstanceOf(CellSelection);
  });

  it("pointercancel restores the selection from before a shift-cell gesture", () => {
    const s = setup();
    clean = s.cleanup;
    const row = s.rowBlock();
    const a = cellCenter(row, 0);
    const b = cellCenter(row, 1);

    s.container.dispatchEvent(pointerEvent("pointerdown", a.x, a.y));
    document.dispatchEvent(pointerEvent("pointerup", a.x, a.y));
    const before = s.editor.getState().selection.toJSON();

    const Ctor = globalThis.PointerEvent ?? MouseEvent;
    s.container.dispatchEvent(
      new Ctor("pointerdown", {
        clientX: b.x, clientY: b.y, pointerId: 1, bubbles: true,
        cancelable: true, detail: 1, shiftKey: true,
      }),
    );
    expect(s.editor.getState().selection).toBeInstanceOf(CellSelection);
    document.dispatchEvent(pointerEvent("pointercancel", b.x, b.y));

    expect(s.editor.getState().selection.toJSON()).toEqual(before);
  });

  it("a body drag whose head lands inside a cell includes the whole table (not stuck)", () => {
    const s = setup();
    clean = s.cleanup;
    const row = s.rowBlock();
    const before = s.blocks().find((bl) => bl.kind !== "tableRow" && bl.y < row.y)!;
    const startY = before.y + before.height / 2;
    const cell = cellCenter(row, 1);

    s.container.dispatchEvent(pointerEvent("pointerdown", 40, startY));
    document.dispatchEvent(pointerEvent("pointermove", cell.x, cell.y)); // head over a cell
    document.dispatchEvent(pointerEvent("pointerup", cell.x, cell.y));

    const state = s.editor.getState();
    const sel = state.selection;
    expect(sel.empty).toBe(false);
    // The head snapped out of the isolating cell — it never sits inside a cell,
    // so the drag isn't stuck at the table edge; the whole table is in range.
    const $head = state.doc.resolve(sel.head);
    for (let d = 1; d <= $head.depth; d++) {
      expect($head.node(d).type.name).not.toBe("tableCell");
    }
  });
});
