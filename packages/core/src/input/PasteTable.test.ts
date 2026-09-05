import { describe, it, expect } from "vitest";
import { EditorState } from "prosemirror-state";
import { DOMSerializer } from "prosemirror-model";
import type { Node } from "prosemirror-model";
import { ExtensionManager } from "../extensions/ExtensionManager";
import { StarterKit } from "../extensions/StarterKit";
import { PasteTransformer } from "./PasteTransformer";

// ── Helpers ───────────────────────────────────────────────────────────────────

const manager = new ExtensionManager([StarterKit.configure({ table: true })]);
const schema = manager.schema;

function pasteHtml(html: string): Node {
  const state = EditorState.create({ schema, plugins: manager.buildPlugins() });
  const clipboardData = {
    getData: (type: string) => (type === "text/html" ? html : ""),
  } as DataTransfer;
  const transformer = new PasteTransformer(schema, [], {}, {
    pasteHtmlTransforms: manager.buildPasteHtmlTransforms(),
    pasteTransforms: manager.buildPasteTransforms(),
  });
  const tr = transformer.transform(clipboardData, state);
  if (!tr) throw new Error("paste produced no transaction");
  return tr.doc;
}

function findTable(doc: Node): Node {
  let found: Node | null = null;
  doc.descendants((node) => {
    if (found) return false;
    if (node.type.name === "table") found = node;
    return true;
  });
  if (!found) throw new Error(`no table in ${doc.toString()}`);
  return found;
}

/** One row per entry: each cell as text plus the attrs a paste should keep. */
function cells(table: Node): Array<Array<Record<string, unknown>>> {
  const rows: Array<Array<Record<string, unknown>>> = [];
  table.forEach((row) => {
    const cellsInRow: Array<Record<string, unknown>> = [];
    row.forEach((cell) => {
      cellsInRow.push({
        text: cell.textContent,
        gridSpan: cell.attrs["gridSpan"],
        vMerge: cell.attrs["vMerge"],
        hAlign: cell.attrs["hAlign"],
        vAlign: cell.attrs["vAlign"],
        background: cell.attrs["background"],
        type: cell.type.name,
      });
    });
    rows.push(cellsInRow);
  });
  return rows;
}

function cellShape(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    text: "",
    gridSpan: 1,
    vMerge: "none",
    hAlign: "left",
    vAlign: "top",
    background: null,
    type: "tableCell",
    ...over,
  };
}

// ── Structure ─────────────────────────────────────────────────────────────────

describe("pasting a table", () => {
  it("keeps the grid of a plain table", () => {
    const table = findTable(
      pasteHtml(`<table><tbody>
        <tr><td>A</td><td>B</td></tr>
        <tr><td>C</td><td>D</td></tr>
      </tbody></table>`),
    );
    expect(cells(table)).toEqual([
      [cellShape({ text: "A" }), cellShape({ text: "B" })],
      [cellShape({ text: "C" }), cellShape({ text: "D" })],
    ]);
  });

  it("keeps a horizontally merged cell merged", () => {
    const table = findTable(
      pasteHtml(`<table><tbody>
        <tr><td colspan="2">Merged</td></tr>
        <tr><td>C</td><td>D</td></tr>
      </tbody></table>`),
    );
    expect(cells(table)[0]).toEqual([cellShape({ text: "Merged", gridSpan: 2 })]);
  });

  it("keeps a vertically merged cell merged", () => {
    const table = findTable(
      pasteHtml(`<table><tbody>
        <tr><td rowspan="2">Tall</td><td>X</td></tr>
        <tr><td>Y</td></tr>
      </tbody></table>`),
    );
    expect(cells(table)).toEqual([
      [cellShape({ text: "Tall", vMerge: "restart" }), cellShape({ text: "X" })],
      [cellShape({ vMerge: "continue" }), cellShape({ text: "Y" })],
    ]);
  });

  it("reads column widths off the colgroup", () => {
    const table = findTable(
      pasteHtml(`<table>
        <colgroup><col width="320"><col width="160"></colgroup>
        <tbody><tr><td>A</td><td>B</td></tr></tbody>
      </table>`),
    );
    expect(table.attrs["grid"]).toEqual([320, 160]);
  });

  it("falls back to no grid when the widths are relative", () => {
    const table = findTable(
      pasteHtml(`<table>
        <colgroup><col width="50%"><col width="50%"></colgroup>
        <tbody><tr><td>A</td><td>B</td></tr></tbody>
      </table>`),
    );
    expect(table.attrs["grid"]).toEqual([]);
  });
});

// ── Presentation ──────────────────────────────────────────────────────────────

describe("pasting a table's presentation", () => {
  it("keeps alignment and fill", () => {
    const table = findTable(
      pasteHtml(`<table><tbody><tr>
        <th style="text-align: center; background: #eeeeee">Head</th>
        <td style="text-align: right; vertical-align: bottom">1</td>
      </tr></tbody></table>`),
    );
    expect(cells(table)[0]).toEqual([
      cellShape({ text: "Head", type: "tableHeader", hAlign: "center", background: "#eeeeee" }),
      cellShape({ text: "1", hAlign: "right", vAlign: "bottom" }),
    ]);
  });

  // A cell's fill is painted, never fetched — so an image reference in the
  // pasted markup is dropped rather than carried into the document.
  it("does not carry a background image into the document", () => {
    const table = findTable(
      pasteHtml(`<table><tbody><tr>
        <td style="background: url(https://evil.example/pixel.png)">A</td>
      </tr></tbody></table>`),
    );
    expect(cells(table)[0]).toEqual([cellShape({ text: "A" })]);
  });
});

// ── Round trip ────────────────────────────────────────────────────────────────

describe("copying a table and pasting it back", () => {
  it("returns the table it started from", () => {
    const cell = (text: string, attrs: Record<string, unknown> = {}) =>
      schema.nodes["tableCell"]!.create(attrs, schema.node("paragraph", null, [schema.text(text)]));
    const row = (kids: Node[]) => schema.nodes["tableRow"]!.create(null, kids);
    const original = schema.nodes["table"]!.create({ grid: [320, 160] }, [
      row([cell("A", { gridSpan: 2, hAlign: "center", background: "#eeeeee" })]),
      row([cell("C"), cell("D", { vAlign: "bottom" })]),
    ]);

    const holder = document.createElement("div");
    holder.appendChild(
      DOMSerializer.fromSchema(schema).serializeFragment(
        schema.node("doc", null, [original]).content,
      ),
    );

    const pasted = findTable(pasteHtml(holder.innerHTML));
    expect(pasted.attrs["grid"]).toEqual([320, 160]);
    expect(cells(pasted)).toEqual(cells(original));
  });
});

// ── Real sources ──────────────────────────────────────────────────────────────

describe("pasting a table from another editor", () => {
  // Word wraps each cell's text in a styled <p>, states widths on the cells,
  // and leaves `mso-` properties and <o:p> markers behind.
  it("reads a Word table", () => {
    const doc = pasteHtml(`
      <table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0
             style='border-collapse:collapse;mso-table-layout-alt:fixed'>
        <tr style='mso-yfti-irow:0;mso-yfti-firstrow:yes'>
          <td width=320 valign=top style='width:240.0pt;background:#EEEEEE;padding:0in 5.4pt 0in 5.4pt'>
            <p class=MsoNormal align=center style='text-align:center'><span style='font-size:10.0pt'>Head<o:p></o:p></span></p>
          </td>
          <td width=160 valign=bottom style='width:120.0pt;padding:0in 5.4pt 0in 5.4pt'>
            <p class=MsoNormal><span style='font-size:10.0pt'>1<o:p></o:p></span></p>
          </td>
        </tr>
        <tr style='mso-yfti-irow:1'>
          <td width=320 rowspan=1 style='width:240.0pt'><p class=MsoNormal>A</p></td>
          <td width=160 style='width:120.0pt'><p class=MsoNormal>B</p></td>
        </tr>
      </table>`);
    const table = findTable(doc);

    expect(table.attrs["grid"]).toEqual([320, 160]);
    expect(cells(table)).toEqual([
      [
        cellShape({ text: "Head", background: "#EEEEEE" }),
        cellShape({ text: "1", vAlign: "bottom" }),
      ],
      [cellShape({ text: "A" }), cellShape({ text: "B" })],
    ]);
  });

  // Google Docs states widths in a colgroup and wraps cell text in spans.
  it("reads a Google Docs table", () => {
    const doc = pasteHtml(`
      <meta charset="utf-8">
      <b style="font-weight:normal" id="docs-internal-guid-1a2b">
        <div dir="ltr" style="margin-left:0pt">
          <table style="border:none;border-collapse:collapse">
            <colgroup><col width="320"><col width="160"></colgroup>
            <tbody>
              <tr style="height:0pt">
                <td style="background-color:#efefef;vertical-align:top;padding:5pt">
                  <p dir="ltr" style="line-height:1.2;margin-top:0pt"><span style="font-size:11pt">Head</span></p>
                </td>
                <td style="vertical-align:middle;padding:5pt;text-align:right">
                  <p dir="ltr" style="line-height:1.2"><span style="font-size:11pt">1</span></p>
                </td>
              </tr>
              <tr>
                <td rowspan="2" style="padding:5pt"><p dir="ltr"><span>Tall</span></p></td>
                <td style="padding:5pt"><p dir="ltr"><span>X</span></p></td>
              </tr>
              <tr><td style="padding:5pt"><p dir="ltr"><span>Y</span></p></td></tr>
            </tbody>
          </table>
        </div>
      </b>`);
    const table = findTable(doc);

    expect(table.attrs["grid"]).toEqual([320, 160]);
    expect(cells(table)).toEqual([
      [
        cellShape({ text: "Head", background: "#efefef" }),
        cellShape({ text: "1", hAlign: "right", vAlign: "center" }),
      ],
      [cellShape({ text: "Tall", vMerge: "restart" }), cellShape({ text: "X" })],
      [cellShape({ vMerge: "continue" }), cellShape({ text: "Y" })],
    ]);
  });
});
