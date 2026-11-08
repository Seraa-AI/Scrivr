import { describe, it, expect } from "vitest";
import type { Node } from "prosemirror-model";
import { ExtensionManager } from "../extensions/ExtensionManager";
import { StarterKit } from "../extensions/StarterKit";
import { createMeasurer } from "../test-utils";
import {
  runPipeline,
  collapseMargins,
  defaultPageConfig,
  defaultPagelessConfig,
} from "./PageLayout";
import type { DocumentLayout, MeasureCacheEntry, PageConfig } from "./PageLayout";
import type { AnchoredObjectPlacement } from "./AnchoredObjects";
import { ANCHORED_OBJECT_MARGIN } from "./AnchoredObjects";
import { computePageMetrics, EMPTY_RESOLVED_CHROME } from "./PageMetrics";
import type { LayoutBlock } from "./BlockLayout";
import { cellAtCoords } from "./cellHitTest";
import { renderTableRowPdf } from "../table/pdfExport";

/**
 * A floating image beside a table. Word moves the whole table below a square
 * or top-bottom float and never narrows it (ECMA-376 Part 4 §14.8.3.23-24).
 *
 * Every expectation relates measured values from the same layout: rows wrap
 * differently on different machines' fonts, so no pixel value is asserted.
 */

const manager = new ExtensionManager([StarterKit.configure({ table: true })]);
const schema = manager.schema;
const fontConfig = manager.buildBlockStyles();

const CONTENT_X = defaultPageConfig.margins.left;
const CONTENT_WIDTH =
  defaultPageConfig.pageWidth - defaultPageConfig.margins.left - defaultPageConfig.margins.right;
const LONG_TEXT = "word ".repeat(80).trim();

function must<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new Error(`missing ${what}`);
  return value;
}

function para(text: string, ...inline: Node[]): Node {
  return schema.node("paragraph", null, [schema.text(text), ...inline]);
}

function image(attrs: Record<string, unknown>): Node {
  return schema.node("image", { src: "", width: 200, height: 150, xAlign: "right", ...attrs });
}

/** Two-column table whose cell text starts with `label` so rows can be found. */
function table(label: string, rows: number, cellParagraphs = 1): Node {
  const cell = (r: number, c: number) => schema.node(
    "tableCell",
    null,
    Array.from({ length: cellParagraphs }, () => para(`${label}${r}c${c}`)),
  );
  return schema.node(
    "table",
    { grid: [100, 100] },
    Array.from({ length: rows }, (_, r) => schema.node("tableRow", null, [cell(r, 0), cell(r, 1)])),
  );
}

function docOf(...blocks: Node[]): Node {
  return schema.node("doc", null, blocks);
}

function layout(d: Node, pageConfig: PageConfig = defaultPageConfig): DocumentLayout {
  return runPipeline(d, { pageConfig, fontConfig, measurer: createMeasurer() });
}

interface Placed {
  page: number;
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  spaceAfter: number;
  kind: string;
  text: string;
}

function blocksOf(l: DocumentLayout): Placed[] {
  return l.pages.flatMap((page) =>
    page.blocks.map((b, index) => ({
      page: page.pageNumber,
      index,
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      spaceAfter: b.spaceAfter,
      kind: b.kind,
      text: b.node.textContent,
    })),
  );
}

function rowsOf(l: DocumentLayout, label: string): Placed[] {
  return blocksOf(l).filter((b) => b.kind === "tableRow" && b.text.startsWith(label));
}

function floatOf(l: DocumentLayout, n = 0): AnchoredObjectPlacement {
  return must(l.anchoredObjects?.[n], `float ${n}`);
}

function blockWith(l: DocumentLayout, needle: string): Placed {
  return must(blocksOf(l).find((b) => b.kind === "text" && b.text.includes(needle)), needle);
}

function overlaps(row: Placed, f: AnchoredObjectPlacement): boolean {
  return row.page === f.page && row.y < f.y + f.height && row.y + row.height > f.y;
}

/** Where a block sits when nothing pushed it: right after its predecessor. */
function naturalY(l: DocumentLayout, block: Placed): number {
  const prev = must(
    l.pages.find((page) => page.pageNumber === block.page)?.blocks[block.index - 1],
    "predecessor",
  );
  return prev.y + prev.height + collapseMargins(prev.spaceAfter, 0);
}

function expectBelowFloat(rows: Placed[], f: AnchoredObjectPlacement): void {
  expect(rows.length).toBeGreaterThan(0);
  const first = must(rows[0], "first row");
  if (first.page === f.page) expect(first.y).toBeGreaterThanOrEqual(f.y + f.height);
  for (const row of rows) {
    expect(overlaps(row, f)).toBe(false);
    expect(row.x).toBe(CONTENT_X);
    expect(row.width).toBe(CONTENT_WIDTH);
  }
  for (let i = 1; i < rows.length; i++) {
    const prev = must(rows[i - 1], "previous row");
    const row = must(rows[i], "row");
    if (row.page === prev.page) expect(row.y).toBe(prev.y + prev.height);
  }
}

describe("float beside a table — the table moves below the float", () => {
  it.each<"right" | "left">(["right", "left"])("1/2: a %s square float above a table", (xAlign) => {
    const l = layout(docOf(para("Anchor", image({ wrapMode: "square", xAlign })), table("T", 3)));
    expectBelowFloat(rowsOf(l, "T"), floatOf(l));
  });

  it("3: a top-bottom float above a table", () => {
    const l = layout(docOf(para("Anchor", image({ wrapMode: "top-bottom" })), table("T", 3)));
    expectBelowFloat(rowsOf(l, "T"), floatOf(l));
  });

  it("3b: a top-bottom float pulled down over the table's rows", () => {
    const plain = layout(docOf(para("Anchor"), table("T", 4)));
    const rowY = must(rowsOf(plain, "T")[1], "row 1").y;
    const l = layout(docOf(
      para("Anchor", image({ wrapMode: "top-bottom", height: 60, yOffset: rowY - blockWith(plain, "Anchor").y })),
      table("T", 4),
    ));
    expectBelowFloat(rowsOf(l, "T"), floatOf(l));
  });

  it.each<"behind" | "front">(["behind", "front"])("4: a %s float leaves the table where it was", (wrapMode) => {
    const l = layout(docOf(para("Anchor", image({ wrapMode })), table("T", 3)));
    const plain = layout(docOf(para("Anchor"), table("T", 3)));
    expect(rowsOf(l, "T").map((r) => r.y)).toEqual(rowsOf(plain, "T").map((r) => r.y));
  });

  it("5: a float that ends before the table leaves it in place", () => {
    const l = layout(docOf(
      para("Anchor", image({ wrapMode: "square", height: 40 })),
      para(LONG_TEXT),
      table("T", 3),
    ));
    const first = must(rowsOf(l, "T")[0], "first row");
    expect(first.y).toBe(naturalY(l, first));
  });

  it("6: a float wholly in the page margin leaves the table in place", () => {
    const width = defaultPageConfig.margins.left - ANCHORED_OBJECT_MARGIN - 8;
    const l = layout(docOf(
      para("Anchor", image({ wrapMode: "square", xAlign: "custom", x: 0, width })),
      table("T", 3),
    ));
    const first = must(rowsOf(l, "T")[0], "first row");
    expect(first.y).toBe(naturalY(l, first));
  });

  it("7: a float whose top is mid-table moves the whole table, not the rows it covers", () => {
    const plain = layout(docOf(para("Anchor"), table("T", 6)));
    const anchorY = blockWith(plain, "Anchor").y;
    const midRow = must(rowsOf(plain, "T")[2], "row 2");
    const l = layout(docOf(
      para("Anchor", image({ wrapMode: "square", height: 60, yOffset: midRow.y - anchorY })),
      table("T", 6),
    ));
    const f = floatOf(l);
    expect(f.y).toBeGreaterThan(must(rowsOf(plain, "T")[0], "row 0").y);
    expectBelowFloat(rowsOf(l, "T"), f);
  });

  it("8: a float near the page bottom sends the table to the next page", () => {
    const plain = layout(docOf(para("Anchor"), table("T", 2)));
    const rowHeight = must(rowsOf(plain, "T")[0], "row").height;
    const page1 = computePageMetrics(defaultPageConfig, EMPTY_RESOLVED_CHROME, 1);
    const page2 = computePageMetrics(defaultPageConfig, EMPTY_RESOLVED_CHROME, 2);
    const l = layout(docOf(
      para("Anchor", image({ wrapMode: "square", height: page1.contentHeight - rowHeight / 2 })),
      table("T", 2),
    ));
    const f = floatOf(l);
    const rows = rowsOf(l, "T");
    const first = must(rows[0], "first row");
    expect(f.page).toBe(1);
    expect(first.page).toBe(2);
    expect(first.y).toBe(page2.contentTop);
    expect(first.height).toBe(rowHeight);
    expectBelowFloat(rows, f);
  });

  it("10: two floats on one page — the table clears both", () => {
    const l = layout(docOf(
      para("First", image({ wrapMode: "square", xAlign: "left", height: 100 })),
      para("Second", image({ wrapMode: "square", xAlign: "right", height: 100 })),
      table("T", 3),
    ));
    const a = floatOf(l, 0);
    const b = floatOf(l, 1);
    const rows = rowsOf(l, "T");
    expectBelowFloat(rows, a);
    expectBelowFloat(rows, b);
  });

  it("11: adjacent tables — only the one beside the float moves", () => {
    const plain = layout(docOf(para("Anchor"), table("A", 3), table("B", 3)));
    const anchorY = blockWith(plain, "Anchor").y;
    const bTop = must(rowsOf(plain, "B")[0], "B row 0").y;
    const l = layout(docOf(
      para("Anchor", image({
        wrapMode: "square", height: 60, yOffset: bTop - anchorY + ANCHORED_OBJECT_MARGIN + 2,
      })),
      table("A", 3),
      table("B", 3),
    ));
    expect(rowsOf(l, "A").map((r) => r.y)).toEqual(rowsOf(plain, "A").map((r) => r.y));
    expectBelowFloat(rowsOf(l, "B"), floatOf(l));
  });

  // Known gap, pinned: a pageless page reports a non-positive content height,
  // which clamps every float's wrap zone to nothing, so text does not wrap
  // either. When pageless floats carve a zone this flips, and the table must
  // then move as in scenario 1.
  it("16: pageless — floats carve no wrap zone yet, so the table stays put", () => {
    const l = layout(
      docOf(para("Anchor", image({ wrapMode: "square" })), table("T", 3)),
      defaultPagelessConfig,
    );
    const first = must(rowsOf(l, "T")[0], "first row");
    expect(first.y).toBe(naturalY(l, first));
  });

  it("18: a row taller than a page under a float is placed once and layout ends", () => {
    const l = layout(docOf(para("Anchor", image({ wrapMode: "square" })), table("T", 1, 80)));
    expect(rowsOf(l, "T")).toHaveLength(1);
  });

  describe("a float anchored after the table it reaches back over", () => {
    /** The table's rows and the anchor's y with no float in the document. */
    function probe(rows: number, lead: Node[] = []) {
      const plain = layout(docOf(...lead, table("T", rows), para("Anchor")));
      return { plain, anchor: blockWith(plain, "Anchor"), rows: rowsOf(plain, "T") };
    }

    it("12: a float free to follow its anchor leaves the table and overlaps it", () => {
      const { anchor, rows } = probe(3, [para("Intro")]);
      const yOffset = must(rows[1], "row 1").y - anchor.y;
      const l = layout(docOf(
        para("Intro"), table("T", 3),
        para("Anchor", image({ wrapMode: "square", height: 60, yOffset })),
      ));
      const f = floatOf(l);
      const anchorNow = blockWith(l, "Anchor");
      expect(rowsOf(l, "T").map((r) => r.y)).toEqual(rows.map((r) => r.y));
      expect(f.page).toBe(anchorNow.page);
      expect(f.y).toBe(anchorNow.y + yOffset);
      expect(rowsOf(l, "T").some((r) => overlaps(r, f))).toBe(true);
    });

    it("12b: a float pinned to the page top moves the table below it", () => {
      const l = layout(docOf(
        table("T", 3),
        para("Anchor", image({ wrapMode: "square", height: 60, yOffset: -5000 })),
      ));
      const f = floatOf(l);
      const page1 = computePageMetrics(defaultPageConfig, EMPTY_RESOLVED_CHROME, 1);
      expect(f.clamped).toBe(true);
      expect(f.y).toBe(page1.contentTop);
      expect(blockWith(l, "Anchor").page).toBe(f.page);
      expectBelowFloat(rowsOf(l, "T"), f);
    });

    it("9: a table split across pages — a float on page 2 moves only the page-2 rows", () => {
      const long = probe(80);
      const onPage1 = long.rows.filter((r) => r.page === 1).length;
      const { rows } = probe(onPage1 + 3);
      const l = layout(docOf(
        table("T", onPage1 + 3),
        para("Anchor", image({ wrapMode: "square", height: 60, yOffset: -5000 })),
      ));
      const f = floatOf(l);
      const after = rowsOf(l, "T");
      expect(f.page).toBe(2);
      expect(blockWith(l, "Anchor").page).toBe(2);
      expect(after.filter((r) => r.page === 1).map((r) => r.y))
        .toEqual(rows.filter((r) => r.page === 1).map((r) => r.y));
      expectBelowFloat(after.filter((r) => r.page === 2), f);
    });
  });

  it("17: pagination feedback — the float follows its anchor across the page boundary", () => {
    const build = (lead: number) => docOf(
      ...Array.from({ length: lead }, () => para(LONG_TEXT)),
      para("Anchor", image({ wrapMode: "square" })),
      table("T", 3),
    );
    let crossing = 0;
    while (blockWith(layout(build(crossing)), "Anchor").page === 1) crossing++;

    for (const lead of [crossing - 2, crossing - 1, crossing, crossing + 1]) {
      const d = build(lead);
      const measurer = createMeasurer();
      const measureCache = new WeakMap<object, MeasureCacheEntry>();
      const opts = { pageConfig: defaultPageConfig, fontConfig, measurer, measureCache };
      const first = runPipeline(d, opts);
      const again = runPipeline(d, { ...opts, previousLayout: first });
      const f = floatOf(first);
      expect(f.page).toBe(blockWith(first, "Anchor").page);
      for (const row of rowsOf(first, "T")) expect(overlaps(row, f)).toBe(false);
      expect(blocksOf(again)).toEqual(blocksOf(first));
      expect(again.anchoredObjects).toEqual(first.anchoredObjects);
    }
  });

  describe("consumers read the moved rows", () => {
    const moved = () => layout(docOf(para("Anchor", image({ wrapMode: "square" })), table("T", 3)));

    function firstRowBlock(l: DocumentLayout): LayoutBlock {
      return must(
        l.pages.flatMap((page) => page.blocks).find((b) => b.kind === "tableRow"),
        "first row block",
      );
    }

    it("13: a click lands in the moved cell, not where the row used to be", () => {
      const l = moved();
      const row = firstRowBlock(l);
      const cell = must(row.cells?.[0], "first cell");
      const centreX = cell.x + cell.width / 2;
      const centreY = row.y + cell.y + cell.height / 2;
      expect(cellAtCoords(l.pages, centreX, centreY, 1)).toBe(cell.cellPos);

      const plainRow = must(rowsOf(layout(docOf(para("Anchor"), table("T", 3))), "T")[0], "plain row");
      expect(cellAtCoords(l.pages, centreX, plainRow.y + plainRow.height / 2, 1)).not.toBe(cell.cellPos);
    });

    it("14: PDF draws the moved row where the layout put it", () => {
      const l = moved();
      const f = floatOf(l);
      const row = firstRowBlock(l);
      const lineYs: number[] = [];
      const childYs: number[] = [];
      const record = { text: () => {}, rect: () => {}, image: () => {}, imagePlaceholder: () => {} };
      renderTableRowPdf(row, {
        draw: {
          ...record,
          line: (op) => { lineYs.push(op.from.y, op.to.y); },
          lines: () => {},
        },
        blocks: (blocks) => { for (const b of blocks) childYs.push(b.y); },
      });
      expect(Math.min(...lineYs)).toBe(row.y);
      expect(Math.min(...lineYs)).toBeGreaterThanOrEqual(f.y + f.height);
      expect(Math.min(...childYs)).toBeGreaterThanOrEqual(row.y);
    });
  });

  // Known gap, pinned: a float anchored inside a cell is not resolved as a
  // float, because a row's own lines are empty and cells are not scanned.
  it("15: a square float anchored in a cell is not placed yet", () => {
    const inCell = schema.node("table", { grid: [100, 100] }, [
      schema.node("tableRow", null, [
        schema.node("tableCell", null, [para("Cell", image({ wrapMode: "square" }))]),
        schema.node("tableCell", null, [para("Other")]),
      ]),
    ]);
    const l = layout(docOf(para("Before"), inCell));
    expect(l.anchoredObjects ?? []).toHaveLength(0);
  });

  describe("19: the previous-layout tail cache", () => {
    const withFloat = (wrapMode: string) =>
      docOf(para("Anchor", image({ wrapMode })), table("T", 3), para("Tail"));

    function relayout(before: Node, after: Node): { cached: DocumentLayout; fresh: DocumentLayout } {
      const measurer = createMeasurer();
      const measureCache = new WeakMap<object, MeasureCacheEntry>();
      const opts = { pageConfig: defaultPageConfig, fontConfig, measurer, measureCache };
      const first = runPipeline(before, opts);
      const cached = runPipeline(after, { ...opts, previousLayout: first });
      return { cached, fresh: layout(after) };
    }

    it("a float moved off the table gives the table its place back", () => {
      const { cached, fresh } = relayout(withFloat("square"), withFloat("behind"));
      expect(blocksOf(cached)).toEqual(blocksOf(fresh));
      const first = must(rowsOf(cached, "T")[0], "first row");
      expect(first.y).toBe(naturalY(cached, first));
    });

    it("a float added beside the table moves it on an incremental layout", () => {
      const { cached, fresh } = relayout(withFloat("behind"), withFloat("square"));
      expect(blocksOf(cached)).toEqual(blocksOf(fresh));
      expectBelowFloat(rowsOf(cached, "T"), floatOf(cached));
    });

    it("laying out the same document again changes nothing", () => {
      const d = withFloat("square");
      const { cached, fresh } = relayout(d, d);
      expect(blocksOf(cached)).toEqual(blocksOf(fresh));
      expect(cached.anchoredObjects).toEqual(fresh.anchoredObjects);
    });
  });
});
