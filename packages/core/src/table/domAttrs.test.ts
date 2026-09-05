import { describe, it, expect } from "vitest";
import {
  readGridSpan,
  readRowSpan,
  readCellHAlign,
  readCellVAlign,
  readCellBackground,
  readTableGrid,
  readCellVMerge,
  cellColspanAttrs,
  cellVMergeAttrs,
  cellPresentationAttrs,
  tableColgroupSpec,
} from "./domAttrs";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parses one element out of an HTML string. Cells are wrapped in a table first:
 * the HTML fragment parser drops a `<td>` that has no table around it.
 */
function el(html: string): HTMLElement {
  const holder = document.createElement("div");
  const isCell = /^\s*<(?:td|th)\b/i.test(html);
  holder.innerHTML = isCell ? `<table><tbody><tr>${html}</tr></tbody></table>` : html;
  const found = isCell ? holder.querySelector("td, th") : holder.firstElementChild;
  if (!(found instanceof HTMLElement)) throw new Error(`no element in ${html}`);
  return found;
}

// ── Spans ─────────────────────────────────────────────────────────────────────

describe("readGridSpan", () => {
  it("reads colspan", () => {
    expect(readGridSpan(el(`<td colspan="3">x</td>`))).toBe(3);
  });

  it("defaults to 1 when absent", () => {
    expect(readGridSpan(el(`<td>x</td>`))).toBe(1);
  });

  it("floors a fractional span", () => {
    expect(readGridSpan(el(`<td colspan="2.7">x</td>`))).toBe(2);
  });

  it.each(["0", "-2", "abc", "", " "])("falls back to 1 for %o", (value) => {
    expect(readGridSpan(el(`<td colspan="${value}">x</td>`))).toBe(1);
  });

  it("caps an absurd span so one cell cannot allocate an unbounded grid", () => {
    expect(readGridSpan(el(`<td colspan="100000">x</td>`))).toBe(64);
  });
});

describe("readRowSpan", () => {
  it.each(["0", "65", "100000"])("bounds rowspan=%s by existing rows, not columns", (value) => {
    expect(readRowSpan(el(`<td rowspan="${value}">x</td>`), 65)).toBe(65);
  });
  it("reads rowspan", () => {
    expect(readRowSpan(el(`<td rowspan="4">x</td>`), 10)).toBe(4);
  });

  it("defaults to 1 when absent", () => {
    expect(readRowSpan(el(`<td>x</td>`), 10)).toBe(1);
  });

  it.each(["-1", "nope"])("falls back to 1 for %o", (value) => {
    expect(readRowSpan(el(`<td rowspan="${value}">x</td>`), 10)).toBe(1);
  });
});

// ── Vertical merge ────────────────────────────────────────────────────────────

describe("readCellVMerge", () => {
  it.each(["restart", "continue", "none"])("reads the %o marker", (value) => {
    expect(readCellVMerge(el(`<td data-vmerge="${value}">x</td>`))).toBe(value);
  });

  it("treats an unmarked cell as unmerged", () => {
    expect(readCellVMerge(el(`<td>x</td>`))).toBe("none");
  });

  it.each(["merged", "", "1"])("treats the unrecognised marker %o as unmerged", (value) => {
    expect(readCellVMerge(el(`<td data-vmerge="${value}">x</td>`))).toBe("none");
  });

  it("round-trips a continuation cell", () => {
    const attrs = cellVMergeAttrs("continue");
    expect(attrs).toEqual({ "data-vmerge": "continue" });
    expect(readCellVMerge(el(`<td data-vmerge="${attrs["data-vmerge"]}">x</td>`))).toBe("continue");
  });

  it("marks nothing on an unmerged cell", () => {
    expect(cellVMergeAttrs("none")).toEqual({});
  });
});

// ── Alignment ─────────────────────────────────────────────────────────────────

describe("readCellHAlign", () => {
  it("reads the align attribute", () => {
    expect(readCellHAlign(el(`<td align="center">x</td>`))).toBe("center");
  });

  it("reads text-align from the style", () => {
    expect(readCellHAlign(el(`<td style="text-align: right">x</td>`))).toBe("right");
  });

  it("prefers the style over the attribute, as CSS does", () => {
    expect(readCellHAlign(el(`<td align="left" style="text-align: justify">x</td>`))).toBe("justify");
  });

  it("returns null when absent, so the node keeps its default", () => {
    expect(readCellHAlign(el(`<td>x</td>`))).toBeNull();
  });

  it.each(["middle", "start", "somewhere"])("rejects the unrepresentable value %o", (value) => {
    expect(readCellHAlign(el(`<td align="${value}">x</td>`))).toBeNull();
  });
});

describe("readCellVAlign", () => {
  it("reads the valign attribute", () => {
    expect(readCellVAlign(el(`<td valign="bottom">x</td>`))).toBe("bottom");
  });

  it("maps HTML's middle onto center", () => {
    expect(readCellVAlign(el(`<td valign="middle">x</td>`))).toBe("center");
  });

  it("reads vertical-align from the style", () => {
    expect(readCellVAlign(el(`<td style="vertical-align: top">x</td>`))).toBe("top");
  });

  it("returns null when absent", () => {
    expect(readCellVAlign(el(`<td>x</td>`))).toBeNull();
  });

  it.each(["baseline", "sub", "super"])("rejects the unrepresentable value %o", (value) => {
    expect(readCellVAlign(el(`<td valign="${value}">x</td>`))).toBeNull();
  });
});

// ── Background ────────────────────────────────────────────────────────────────

describe("readCellBackground", () => {
  it("reads the bgcolor attribute", () => {
    expect(readCellBackground(el(`<td bgcolor="#eeeeee">x</td>`))).toBe("#eeeeee");
  });

  it("reads background-color from the style", () => {
    expect(readCellBackground(el(`<td style="background-color: #ff0000">x</td>`))).toBe("#ff0000");
  });

  it("reads a color out of the background shorthand", () => {
    expect(readCellBackground(el(`<td style="background: rgb(1, 2, 3)">x</td>`))).toBe("rgb(1, 2, 3)");
  });

  it("keeps a named colour", () => {
    expect(readCellBackground(el(`<td bgcolor="rebeccapurple">x</td>`))).toBe("rebeccapurple");
  });

  // An unpaintable value is worse than none: assigning it to `fillStyle` is a
  // silent no-op, so the cell would be painted in whatever colour was set last
  // — its neighbour's.
  it.each(["hotpinkish", "notacolour", "fixed", "reddish"])(
    "rejects the colour-shaped non-colour %o",
    (value) => {
      expect(readCellBackground(el(`<td bgcolor="${value}">x</td>`))).toBeNull();
    },
  );

  it.each(["rgb(1, 2, 3)", "hsl(200, 50%, 40%)", "#abc", "#aabbcc", "rebeccapurple"])(
    "accepts the colour %o",
    (value) => {
      expect(readCellBackground(el(`<td bgcolor="${value}">x</td>`))).not.toBeNull();
    },
  );

  it("returns null when absent", () => {
    expect(readCellBackground(el(`<td>x</td>`))).toBeNull();
  });

  it("drops transparent, which is the same as unset", () => {
    expect(readCellBackground(el(`<td style="background-color: transparent">x</td>`))).toBeNull();
  });

  // A cell's fill is painted, never fetched: only a colour survives the gate,
  // so pasted markup cannot make the canvas load a remote asset.
  it.each([
    `<td style="background: url(https://evil.example/pixel.png)">x</td>`,
    `<td style="background-color: url(data:image/png;base64,AAAA)">x</td>`,
    // Via the attribute, which no CSS parser gets to sanitise first.
    `<td bgcolor="url(https://evil.example/pixel.png)">x</td>`,
    `<td bgcolor="var(--leak)">x</td>`,
    `<td bgcolor="expression(alert(1))">x</td>`,
    `<td style="background-color: var(--leak)">x</td>`,
    `<td style="background-color: expression(alert(1))">x</td>`,
  ])("keeps a non-colour value out of the model: %o", (html) => {
    expect(readCellBackground(el(html))).toBeNull();
  });
});

// ── Column widths ─────────────────────────────────────────────────────────────

describe("readTableGrid", () => {
  it("reads column widths from colgroup width attributes", () => {
    expect(
      readTableGrid(el(`<table><colgroup><col width="320"><col width="160"></colgroup></table>`)),
    ).toEqual([320, 160]);
  });

  it("reads column widths from col styles", () => {
    expect(
      readTableGrid(el(`<table><colgroup><col style="width: 240px"><col style="width: 80px"></colgroup></table>`)),
    ).toEqual([240, 80]);
  });

  it("returns an empty grid when nothing states a width", () => {
    expect(readTableGrid(el(`<table><tbody><tr><td>x</td></tr></tbody></table>`))).toEqual([]);
  });

  // Word writes the widths on the cells of every row instead of a colgroup.
  it("reads column widths off the first row when there is no colgroup", () => {
    expect(
      readTableGrid(el(`<table><tbody>
        <tr><td width="320">A</td><td width="160">B</td></tr>
        <tr><td width="320">C</td><td width="160">D</td></tr>
      </tbody></table>`)),
    ).toEqual([320, 160]);
  });

  it("prefers the colgroup over the first row's cells", () => {
    expect(
      readTableGrid(el(`<table>
        <colgroup><col width="300"><col width="180"></colgroup>
        <tbody><tr><td width="320">A</td><td width="160">B</td></tr></tbody>
      </table>`)),
    ).toEqual([300, 180]);
  });

  // One width covering two columns cannot be divided between them.
  it("returns an empty grid when the first row has a merged cell", () => {
    expect(
      readTableGrid(el(`<table><tbody>
        <tr><td colspan="2" width="480">A</td></tr>
        <tr><td width="320">C</td><td width="160">D</td></tr>
      </tbody></table>`)),
    ).toEqual([]);
  });

  // A partial grid is worse than none: the layout engine would pair widths with
  // the wrong columns. Uniform default columns are the honest fallback.
  it("returns an empty grid when any column width is unreadable", () => {
    expect(
      readTableGrid(el(`<table><colgroup><col width="320"><col></colgroup></table>`)),
    ).toEqual([]);
  });

  // Word writes points; 240pt is exactly the 320px it also puts in the attr.
  it("converts absolute CSS units to px", () => {
    expect(
      readTableGrid(el(`<table><colgroup><col style="width: 240pt"><col style="width: 1.25in"></colgroup></table>`)),
    ).toEqual([320, 120]);
  });

  // `<col span="2">` describes two columns, not one.
  it("repeats a width across the columns its col spans", () => {
    expect(
      readTableGrid(el(`<table><colgroup><col span="2" width="80"><col width="160"></colgroup></table>`)),
    ).toEqual([80, 80, 160]);
  });

  it("reads a span of zero as the single column it describes", () => {
    expect(
      readTableGrid(el(`<table><colgroup><col span="0" width="80"><col width="160"></colgroup></table>`)),
    ).toEqual([80, 160]);
  });

  it("returns an empty grid for a font-relative width", () => {
    expect(
      readTableGrid(el(`<table><colgroup><col style="width: 20em"><col style="width: 10em"></colgroup></table>`)),
    ).toEqual([]);
  });

  it("returns an empty grid for relative widths it cannot resolve", () => {
    expect(
      readTableGrid(el(`<table><colgroup><col width="50%"><col width="50%"></colgroup></table>`)),
    ).toEqual([]);
  });
});

// A nested table is a cell's content, not a description of the table around it.
describe("readTableGrid — nested tables", () => {
  function outer(html: string): HTMLElement {
    const holder = document.createElement("div");
    holder.innerHTML = html;
    const table = holder.querySelector("table");
    if (!(table instanceof HTMLElement)) throw new Error("no table");
    return table;
  }

  it("ignores a nested table's colgroup", () => {
    expect(
      readTableGrid(outer(`<table><tbody><tr><td width="300">
        <table><colgroup><col width="50"><col width="60"></colgroup>
        <tbody><tr><td>a</td><td>b</td></tr></tbody></table>
      </td></tr></tbody></table>`)),
    ).toEqual([300]);
  });

  it("ignores a nested table's first row", () => {
    expect(
      readTableGrid(outer(`<table><tbody><tr><td>
        <table><tbody><tr><td width="50">a</td><td width="60">b</td></tr></tbody></table>
      </td></tr></tbody></table>`)),
    ).toEqual([]);
  });

  it("still reads the outer table's own colgroup", () => {
    expect(
      readTableGrid(outer(`<table><colgroup><col width="300"></colgroup><tbody><tr><td>
        <table><colgroup><col width="50"><col width="60"></colgroup>
        <tbody><tr><td>a</td><td>b</td></tr></tbody></table>
      </td></tr></tbody></table>`)),
    ).toEqual([300]);
  });
});

// ── Emitting ──────────────────────────────────────────────────────────────────

describe("cellColspanAttrs", () => {
  it("emits the span", () => {
    expect(cellColspanAttrs(2)).toEqual({ colspan: "2" });
  });

  it("omits a span of one, which is the HTML default", () => {
    expect(cellColspanAttrs(1)).toEqual({});
  });
});

describe("cellPresentationAttrs", () => {
  it("emits alignment and fill as a style", () => {
    expect(cellPresentationAttrs({ hAlign: "center", vAlign: "bottom", background: "#eee" })).toEqual({
      style: "text-align: center; vertical-align: bottom; background-color: #eee",
    });
  });

  it("emits HTML's middle for a centre-aligned cell", () => {
    expect(cellPresentationAttrs({ hAlign: null, vAlign: "center", background: null })).toEqual({
      style: "vertical-align: middle",
    });
  });

  it("emits nothing when the cell carries no presentation", () => {
    expect(cellPresentationAttrs({ hAlign: null, vAlign: null, background: null })).toEqual({});
  });
});

describe("tableColgroupSpec", () => {
  it("emits one col per column width", () => {
    expect(tableColgroupSpec([320, 160])).toEqual([
      "colgroup",
      ["col", { width: "320" }],
      ["col", { width: "160" }],
    ]);
  });

  it("emits nothing for an unset grid", () => {
    expect(tableColgroupSpec([])).toBeNull();
  });

  it("round-trips through readTableGrid", () => {
    expect(
      readTableGrid(el(`<table><colgroup><col width="320"><col width="160"></colgroup></table>`)),
    ).toEqual([320, 160]);
  });
});
