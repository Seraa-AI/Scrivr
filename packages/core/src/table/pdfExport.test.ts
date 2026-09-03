import { describe, it, expect } from "vitest";
import type { Node } from "prosemirror-model";
import { ServerEditor } from "../ServerEditor";
import { StarterKit } from "../extensions/StarterKit";
import { renderTableRowPdf } from "./pdfExport";
import type { LayoutBlock, CellSubBlock } from "../layout/BlockLayout";

// A structural stand-in for the PDF context — records draw calls so we can
// assert borders and cell text without pdf-lib or the export pipeline.
interface DrawnLine {
  start: { x: number; y: number };
  end: { x: number; y: number };
}
function fakeCtx() {
  const lines: DrawnLine[] = [];
  const textBlocks: Array<{ y: number }> = [];
  const ctx = {
    layout: { pageConfig: { pageHeight: 1000 } },
    page: {
      drawLine(opts: { start: { x: number; y: number }; end: { x: number; y: number } }) {
        lines.push({ start: opts.start, end: opts.end });
      },
    },
    draw: {
      lines(block: LayoutBlock) {
        textBlocks.push({ y: block.y });
      },
    },
  };
  return { ctx, lines, textBlocks };
}

const schema = new ServerEditor({ extensions: [StarterKit.configure({ table: true })] }).getState().schema;

function childTextBlock(y: number): LayoutBlock {
  return {
    kind: "text",
    node: schema.nodes["paragraph"]!.create(),
    nodePos: 0,
    x: 10,
    y,
    width: 100,
    height: 20,
    lines: [],
    spaceBefore: 0,
    spaceAfter: 0,
    blockType: "paragraph",
    align: "left",
    availableWidth: 100,
  };
}

/** Build a one-row table and return its row node (real schema → real attrs). */
function rowNode(cells: Array<{ vMerge?: "none" | "restart" | "continue" }>): Node {
  const editor = new ServerEditor({
    extensions: [StarterKit.configure({ table: true })],
    content: {
      type: "doc",
      content: [
        {
          type: "table",
          attrs: { layout: "fixed", grid: cells.map(() => 120) },
          content: [
            {
              type: "tableRow",
              content: cells.map((c) => ({
                type: "tableCell",
                attrs: { gridSpan: 1, vMerge: c.vMerge ?? "none", hMerge: "none", hAlign: "left", vAlign: "top", background: null, margins: null, borders: null },
                content: [{ type: "paragraph" }],
              })),
            },
          ],
        },
      ],
    },
  });
  let row: Node | null = null;
  editor.getState().doc.descendants((n) => {
    if (n.type.name === "tableRow") {
      row = n;
      return false;
    }
    return true;
  });
  if (!row) throw new Error("no row");
  return row;
}

/** Second row of a single-column vertical merge — a real `vMerge: "continue"`. */
function continuationRowNode(): Node {
  const editor = new ServerEditor({
    extensions: [StarterKit.configure({ table: true })],
    content: {
      type: "doc",
      content: [
        {
          type: "table",
          attrs: { layout: "fixed", grid: [120] },
          content: [
            { type: "tableRow", content: [{ type: "tableCell", attrs: { gridSpan: 1, vMerge: "restart", hMerge: "none", hAlign: "left", vAlign: "top", background: null, margins: null, borders: null }, content: [{ type: "paragraph" }] }] },
            { type: "tableRow", content: [{ type: "tableCell", attrs: { gridSpan: 1, vMerge: "continue", hMerge: "none", hAlign: "left", vAlign: "top", background: null, margins: null, borders: null }, content: [{ type: "paragraph" }] }] },
          ],
        },
      ],
    },
  });
  const table = editor.getState().doc.firstChild;
  const row = table?.child(1);
  if (!row) throw new Error("no continuation row");
  return row;
}

function tableRowBlock(node: Node, cells: CellSubBlock[], isLastRow = true): LayoutBlock {
  return {
    kind: "tableRow",
    node,
    nodePos: 0,
    x: 50,
    y: 200,
    width: 240,
    height: 40,
    lines: [],
    cells,
    isLastRow,
    spaceBefore: 0,
    spaceAfter: 0,
    blockType: "tableRow",
    align: "left",
    availableWidth: 600,
  };
}

describe("renderTableRowPdf", () => {
  it("a last-row cell draws all four grid lines (left, top, bottom, right) and renders its child", () => {
    const node = rowNode([{}]);
    const cell: CellSubBlock = { cellPos: 1, x: 50, y: 0, width: 120, height: 40, vMerge: "none", background: null, blocks: [childTextBlock(4)] };
    const { ctx, lines, textBlocks } = fakeCtx();

    renderTableRowPdf(tableRowBlock(node, [cell], true), ctx);

    expect(lines).toHaveLength(4); // left, top, bottom (last row), right (row edge)
    // child text rendered at absolute y (row y 200 + relative 4)
    expect(textBlocks).toEqual([{ y: 204 }]);
  });

  it("a non-last row omits the bottom — the row below owns that line (3 lines)", () => {
    const node = rowNode([{}]);
    const cell: CellSubBlock = { cellPos: 1, x: 50, y: 0, width: 120, height: 40, vMerge: "none", background: null, blocks: [] };
    const { ctx, lines } = fakeCtx();

    renderTableRowPdf(tableRowBlock(node, [cell], false), ctx);

    expect(lines).toHaveLength(3); // left, top, right — no bottom
  });

  it("suppresses the top border for a vMerge continuation cell", () => {
    // A lone "continue" gets normalized away, so build a real 2-row vertical
    // merge (restart over continue) and take the continuation row.
    const node = continuationRowNode();
    const cell: CellSubBlock = { cellPos: 1, x: 50, y: 0, width: 120, height: 40, vMerge: "continue", background: null, blocks: [] };
    const { ctx, lines } = fakeCtx();

    renderTableRowPdf(tableRowBlock(node, [cell]), ctx);

    expect(lines).toHaveLength(3); // top suppressed
  });

  it("does nothing for a non-PDF context (structural guard)", () => {
    const node = rowNode([{}]);
    const cell: CellSubBlock = { cellPos: 1, x: 50, y: 0, width: 120, height: 40, vMerge: "none", background: null, blocks: [childTextBlock(4)] };
    expect(() => renderTableRowPdf(tableRowBlock(node, [cell]), { not: "a ctx" })).not.toThrow();
  });
});

// `ExportContributionMap` is deliberately loose in core (format keys like
// `pdf` are augmented by the format packages), so read it structurally — the
// same `Record<string, unknown>` narrowing StarterKit.addExports uses.
function pdfNodeHandler(contribs: ReadonlyArray<unknown>, nodeType: string): unknown {
  for (const c of contribs) {
    if (typeof c !== "object" || c === null) continue;
    const pdf = (c as Record<string, unknown>)["pdf"];
    if (typeof pdf !== "object" || pdf === null) continue;
    const nodes = (pdf as Record<string, unknown>)["nodes"];
    if (typeof nodes !== "object" || nodes === null) continue;
    const handler = (nodes as Record<string, unknown>)[nodeType];
    if (typeof handler === "function") return handler;
  }
  return undefined;
}

describe("Table extension — PDF export contribution", () => {
  it("contributes a tableRow PDF node handler via addExports", () => {
    const editor = new ServerEditor({ extensions: [StarterKit.configure({ table: true })] });
    expect(typeof pdfNodeHandler(editor.getExportContributions(), "tableRow")).toBe("function");
  });

  it("does not contribute the handler when tables are disabled", () => {
    const editor = new ServerEditor({ extensions: [StarterKit] });
    expect(pdfNodeHandler(editor.getExportContributions(), "tableRow")).toBeUndefined();
  });
});
