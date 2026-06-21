import { describe, it, expect } from "vitest";
import type { Node } from "prosemirror-model";
import { createTestEditor } from "../test-utils";
import { StarterKit } from "../extensions/StarterKit";
import { DefaultContent } from "../extensions/built-in/DefaultContent";
import type { Editor } from "../Editor";
import type { LayoutBlock } from "./BlockLayout";

/**
 * Regression: clicking a cell must land the caret inside THAT cell.
 *
 * All cells in a row share the same Y, so the pre-cell-rect `posAtCoords`
 * (nearest-line-by-Y, then resolve X) could not tell adjacent cells apart and
 * resolved a click into the next cell — to reach cell N you had to click cell
 * N-1. `posAtCoords` now narrows to the clicked cell's registered rect first.
 *
 * This drives the real registration path (`ensurePagePopulated` →
 * `populateCharMap`) rather than synthetic rects, which is what the unit tests
 * missed.
 */

function cell(text?: string) {
  return {
    type: "tableCell",
    content: [text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" }],
  };
}

function tableDoc(cells: ReturnType<typeof cell>[]) {
  return {
    type: "doc",
    content: [
      {
        type: "table",
        attrs: { layout: "fixed", grid: cells.map(() => 120) },
        content: [{ type: "tableRow", content: cells }],
      },
    ],
  };
}

function rowBlock(editor: Editor): LayoutBlock {
  for (const page of editor.layout.pages) {
    for (const b of page.blocks) if (b.kind === "tableRow") return b;
  }
  throw new Error("no row block");
}

function enclosingCellPos(editor: Editor, pos: number): number {
  const $p = editor.getState().doc.resolve(pos);
  for (let d = $p.depth; d > 0; d--) {
    const name = $p.node(d).type.name;
    if (name === "tableCell" || name === "tableHeader") return $p.before(d);
  }
  return -1;
}

function mount(doc: Record<string, unknown>): { editor: Editor; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const editor = createTestEditor({
    extensions: [StarterKit.configure({ table: true }), DefaultContent.configure({ json: doc })],
  });
  editor.mount(container);
  editor.ensurePagePopulated(1);
  return {
    editor,
    cleanup: () => {
      editor.destroy();
      container.remove();
    },
  };
}

function assertClicksLandInOwnCell(editor: Editor) {
  const row = rowBlock(editor);
  const cells = row.cells ?? [];
  expect(cells.length).toBeGreaterThan(1);

  const doc = editor.getState().doc;
  for (const c of cells) {
    const cy = row.y + c.y + c.height / 2;
    for (const cx of [c.x + 8, c.x + c.width / 2, c.x + c.width - 8]) {
      const pos = editor.charMap.posAtCoords(cx, cy, 1);
      // Must be a valid caret position (a structural cell boundary like the
      // empty-cell end would snap the selection into the next cell)...
      expect(doc.resolve(pos).parent.isTextblock, `click x=${cx} → pos ${pos} is not a caret position`).toBe(true);
      // ...and it must resolve inside the cell that was clicked.
      expect(enclosingCellPos(editor, pos), `click x=${cx} → pos ${pos} landed in the wrong cell`).toBe(c.cellPos);
    }
  }
}

describe("table cell hit-testing — click lands in the clicked cell", () => {
  it("empty cells (freshly inserted table)", () => {
    const { editor, cleanup } = mount(tableDoc([cell(), cell(), cell()]));
    assertClicksLandInOwnCell(editor);
    cleanup();
  });

  it("cells with text", () => {
    const { editor, cleanup } = mount(tableDoc([cell("AAA"), cell("BBB"), cell("CCC")]));
    assertClicksLandInOwnCell(editor);
    cleanup();
  });
});

describe("table rows stack flush — one contiguous grid, not stacked boxes", () => {
  it("each row's top meets the previous row's bottom (no inter-row gap)", () => {
    const row = () => ({ type: "tableRow", content: [cell(), cell()] });
    const doc = {
      type: "doc",
      content: [{ type: "table", attrs: { layout: "fixed", grid: [120, 120] }, content: [row(), row(), row()] }],
    };
    const { editor, cleanup } = mount(doc);

    const rows: LayoutBlock[] = [];
    for (const page of editor.layout.pages) {
      for (const b of page.blocks) if (b.kind === "tableRow") rows.push(b);
    }
    expect(rows).toHaveLength(3);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.y).toBeCloseTo(rows[i - 1]!.y + rows[i - 1]!.height, 1);
    }
    cleanup();
  });
});
