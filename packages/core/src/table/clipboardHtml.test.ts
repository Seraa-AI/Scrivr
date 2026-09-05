import { describe, it, expect } from "vitest";
import { collapseRowSpans, expandRowSpans } from "./clipboardHtml";

/** Parses a table fragment and hands back the root the transform runs on. */
function root(html: string): HTMLElement {
  const holder = document.createElement("div");
  holder.innerHTML = html;
  return holder;
}

/** One row per line, one cell per entry — the shape a reader cares about. */
function grid(el: HTMLElement): string[][] {
  return Array.from(el.querySelectorAll("tr")).map((tr) =>
    Array.from(tr.children).map((cell) => {
      const merge = cell.getAttribute("data-vmerge");
      const span = cell.getAttribute("colspan");
      const text = cell.textContent?.trim() ?? "";
      return [text || "·", merge ?? "", span ? `x${span}` : ""].filter(Boolean).join(":");
    }),
  );
}

describe("expandRowSpans", () => {
  it("leaves a table without merges alone", () => {
    const el = root(`<table><tbody>
      <tr><td>A</td><td>B</td></tr>
      <tr><td>C</td><td>D</td></tr>
    </tbody></table>`);
    expandRowSpans(el);
    expect(grid(el)).toEqual([
      ["A", "B"],
      ["C", "D"],
    ]);
  });

  it("gives a rowspan cell a real cell in each row it covers", () => {
    const el = root(`<table><tbody>
      <tr><td rowspan="2">Tall</td><td>X</td></tr>
      <tr><td>Y</td></tr>
    </tbody></table>`);
    expandRowSpans(el);
    expect(grid(el)).toEqual([
      ["Tall:restart", "X"],
      ["·:continue", "Y"],
    ]);
  });

  it("drops the rowspan attribute it has expanded", () => {
    const el = root(`<table><tbody>
      <tr><td rowspan="2">Tall</td><td>X</td></tr>
      <tr><td>Y</td></tr>
    </tbody></table>`);
    expandRowSpans(el);
    expect(el.querySelector("td")?.hasAttribute("rowspan")).toBe(false);
  });

  it("keeps a continuation cell in the column its master occupies", () => {
    const el = root(`<table><tbody>
      <tr><td>A</td><td rowspan="2">Tall</td><td>C</td></tr>
      <tr><td>D</td><td>F</td></tr>
    </tbody></table>`);
    expandRowSpans(el);
    expect(grid(el)).toEqual([
      ["A", "Tall:restart", "C"],
      ["D", "·:continue", "F"],
    ]);
  });

  it("carries the master's colspan onto its continuation cells", () => {
    const el = root(`<table><tbody>
      <tr><td rowspan="2" colspan="2">Wide and tall</td><td>C</td></tr>
      <tr><td>F</td></tr>
    </tbody></table>`);
    expandRowSpans(el);
    expect(grid(el)).toEqual([
      ["Wide and tall:restart:x2", "C"],
      ["·:continue:x2", "F"],
    ]);
  });

  it("expands a cell that spans more than two rows", () => {
    const el = root(`<table><tbody>
      <tr><td rowspan="3">Tall</td><td>X</td></tr>
      <tr><td>Y</td></tr>
      <tr><td>Z</td></tr>
    </tbody></table>`);
    expandRowSpans(el);
    expect(grid(el)).toEqual([
      ["Tall:restart", "X"],
      ["·:continue", "Y"],
      ["·:continue", "Z"],
    ]);
  });

  it("expands two merges that overlap in the same rows", () => {
    const el = root(`<table><tbody>
      <tr><td rowspan="2">L</td><td>M</td><td rowspan="2">R</td></tr>
      <tr><td>N</td></tr>
    </tbody></table>`);
    expandRowSpans(el);
    expect(grid(el)).toEqual([
      ["L:restart", "M", "R:restart"],
      ["·:continue", "N", "·:continue"],
    ]);
  });

  it("matches the master's cell type, so a merged header stays a header", () => {
    const el = root(`<table><tbody>
      <tr><th rowspan="2">Head</th><td>X</td></tr>
      <tr><td>Y</td></tr>
    </tbody></table>`);
    expandRowSpans(el);
    const secondRow = el.querySelectorAll("tr")[1];
    expect(secondRow?.children[0]?.tagName.toLowerCase()).toBe("th");
  });

  // A rowspan reaching past the last row is legal markup; the covered rows
  // simply do not exist, and inventing them would change the table's shape.
  it("stops expanding at the last row", () => {
    const el = root(`<table><tbody>
      <tr><td rowspan="9">Tall</td><td>X</td></tr>
      <tr><td>Y</td></tr>
    </tbody></table>`);
    expandRowSpans(el);
    expect(grid(el)).toEqual([
      ["Tall:restart", "X"],
      ["·:continue", "Y"],
    ]);
  });

  it("expands every table in the pasted fragment", () => {
    const el = root(`
      <table><tbody><tr><td rowspan="2">A</td></tr><tr></tr></tbody></table>
      <table><tbody><tr><td rowspan="2">B</td></tr><tr></tr></tbody></table>
    `);
    expandRowSpans(el);
    expect(grid(el)).toEqual([["A:restart"], ["·:continue"], ["B:restart"], ["·:continue"]]);
  });

  it("expands a nested table independently of the one containing it", () => {
    const el = root(`<table><tbody>
      <tr><td><table><tbody>
        <tr><td rowspan="2">Inner</td><td>X</td></tr>
        <tr><td>Y</td></tr>
      </tbody></table></td></tr>
    </tbody></table>`);
    expandRowSpans(el);
    const inner = el.querySelector("td table");
    expect(inner).not.toBeNull();
    if (!(inner instanceof HTMLElement)) throw new Error("no inner table");
    expect(grid(inner)).toEqual([
      ["Inner:restart", "X"],
      ["·:continue", "Y"],
    ]);
  });
});

describe("collapseRowSpans", () => {
  it("leaves a table without merges alone", () => {
    const el = root(`<table><tbody>
      <tr><td>A</td><td>B</td></tr>
      <tr><td>C</td><td>D</td></tr>
    </tbody></table>`);
    collapseRowSpans(el);
    expect(grid(el)).toEqual([
      ["A", "B"],
      ["C", "D"],
    ]);
    expect(el.querySelector("td")?.hasAttribute("rowspan")).toBe(false);
  });

  it("turns continuation cells back into a rowspan", () => {
    const el = root(`<table><tbody>
      <tr><td data-vmerge="restart">Tall</td><td>X</td></tr>
      <tr><td data-vmerge="continue"></td><td>Y</td></tr>
    </tbody></table>`);
    collapseRowSpans(el);
    expect(el.querySelector("td")?.getAttribute("rowspan")).toBe("2");
    expect(grid(el)).toEqual([["Tall", "X"], ["Y"]]);
  });

  it("counts every row a merge covers", () => {
    const el = root(`<table><tbody>
      <tr><td data-vmerge="restart">Tall</td><td>X</td></tr>
      <tr><td data-vmerge="continue"></td><td>Y</td></tr>
      <tr><td data-vmerge="continue"></td><td>Z</td></tr>
    </tbody></table>`);
    collapseRowSpans(el);
    expect(el.querySelector("td")?.getAttribute("rowspan")).toBe("3");
  });

  it("collapses two merges in the same column independently", () => {
    const el = root(`<table><tbody>
      <tr><td data-vmerge="restart">First</td></tr>
      <tr><td data-vmerge="continue"></td></tr>
      <tr><td data-vmerge="restart">Second</td></tr>
      <tr><td data-vmerge="continue"></td></tr>
    </tbody></table>`);
    collapseRowSpans(el);
    const spans = Array.from(el.querySelectorAll("td")).map((td) => td.getAttribute("rowspan"));
    expect(spans).toEqual(["2", "2"]);
    // The covered rows keep their (now empty) `tr` — that is how HTML says a
    // row has no cell of its own in that column.
    expect(grid(el)).toEqual([["First"], [], ["Second"], []]);
  });

  // Copying from partway down a merge yields a continuation with no master in
  // range. It is the top of what was copied, so it becomes a cell of its own.
  it("keeps a continuation whose master was not copied", () => {
    const el = root(`<table><tbody>
      <tr><td data-vmerge="continue">Orphan</td><td>X</td></tr>
    </tbody></table>`);
    collapseRowSpans(el);
    expect(grid(el)).toEqual([["Orphan", "X"]]);
  });

  it("leaves no merge markers in the markup it emits", () => {
    const el = root(`<table><tbody>
      <tr><td data-vmerge="restart">Tall</td></tr>
      <tr><td data-vmerge="continue"></td></tr>
    </tbody></table>`);
    collapseRowSpans(el);
    expect(el.querySelector("[data-vmerge]")).toBeNull();
  });

  it("reverses expandRowSpans", () => {
    const source = `<table><tbody><tr><td rowspan="2" colspan="2">Wide and tall</td><td>C</td></tr><tr><td>F</td></tr></tbody></table>`;
    const expanded = root(source);
    expandRowSpans(expanded);

    const returned = root(source);
    expandRowSpans(returned);
    collapseRowSpans(returned);
    // Attribute order is not meaning, so compare what a second paste would see.
    expandRowSpans(returned);
    expect(grid(returned)).toEqual(grid(expanded));
  });
});
