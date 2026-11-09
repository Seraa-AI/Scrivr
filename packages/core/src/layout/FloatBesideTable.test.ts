import { describe, it, expect } from "vitest";
import type { Node } from "prosemirror-model";
import { ExtensionManager } from "../extensions/ExtensionManager";
import { StarterKit } from "../extensions/StarterKit";
import { createMeasurer, measureTextWidth } from "../test-utils";
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
const WORDS_40 = "word ".repeat(40).trim();

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

/** The float paints where its anchor paragraph says, or is clamped onto that page. */
function expectOnAnchor(l: DocumentLayout, f: AnchoredObjectPlacement, needle: string, yOffset: number): void {
  const anchor = blockWith(l, needle);
  expect(f.page).toBe(anchor.page);
  if (!f.clamped) expect(f.y).toBeCloseTo(anchor.y + yOffset, 6);
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
      para("Anchor", image({ wrapMode: "square", xAlign: "custom", x: -defaultPageConfig.margins.left, width })),
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
  it("15: a square float anchored in a cell is laid out in its cell (CellFloats.test.ts)", () => {
    const inCell = schema.node("table", { grid: [100, 100] }, [
      schema.node("tableRow", null, [
        schema.node("tableCell", null, [para("Cell", image({ wrapMode: "square" }))]),
        schema.node("tableCell", null, [para("Other")]),
      ]),
    ]);
    const l = layout(docOf(para("Before"), inCell));
    const row = must(rowsOf(l, "Cell")[0], "row");
    const f = floatOf(l);
    expect(f.cellPos).toBeDefined();
    expect(row.y + row.height).toBeGreaterThanOrEqual(f.y + f.height);
  });

  describe("every float on the page still holds after a later float moves content", () => {
    it("20: a later float that grows the text above keeps the table below an earlier float", () => {
      const l = layout(docOf(
        para(WORDS_40, image({ wrapMode: "square", width: 200, height: 150 })),
        table("T", 3),
        para("Anchor", image({ wrapMode: "square", xAlign: "left", width: 150, height: 20, yOffset: -5000 })),
      ));
      for (const f of l.anchoredObjects ?? []) expectBelowFloat(rowsOf(l, "T"), f);
    });

    it("21: a table restamped by a later float's push clears an earlier float below it", () => {
      const l = layout(docOf(
        para("P1", image({ wrapMode: "square", height: 100, yOffset: 330 })),
        para("P2", image({ wrapMode: "square", xAlign: "left", height: 150 })),
        table("T", 3),
        table("U", 3),
      ));
      for (const f of l.anchoredObjects ?? []) {
        for (const row of [...rowsOf(l, "T"), ...rowsOf(l, "U")]) expect(overlaps(row, f)).toBe(false);
      }
    });

    it("22: a paragraph restamped by a later float's push wraps around an earlier float", () => {
      const l = layout(docOf(
        para("P1", image({ wrapMode: "square", height: 100, yOffset: 330 })),
        para("P2", image({ wrapMode: "square", xAlign: "left", height: 150 })),
        table("T", 3),
        para(`Q ${LONG_TEXT}`),
      ));
      const a = floatOf(l, 0);
      const q = must(
        l.pages.flatMap((page) => page.blocks.map((block) => ({ page: page.pageNumber, block })))
          .find(({ block }) => block.node.textContent.startsWith("Q ")),
        "Q",
      );
      let lineY = q.block.y;
      for (const line of q.block.lines) {
        const beside = q.page === a.page && lineY < a.y + a.height && lineY + line.lineHeight > a.y;
        const right = Math.max(...line.spans.map((span) => q.block.x + span.x + span.width));
        if (beside) expect(right).toBeLessThanOrEqual(a.x);
        lineY += line.lineHeight;
      }
    });
  });

  // A stacked float owns its offset: it moves below the float it would
  // overlap, and its paragraph stays where the text puts it.
  it("27: re-wrapping text that did not change height keeps a stacked float below the other", () => {
    const l = layout(docOf(
      para("Lead", image({ wrapMode: "square", width: 400, height: 100 })),
      para("Stacked", image({ wrapMode: "square", width: 400, height: 100 })),
      para("Pinned", image({ wrapMode: "square", xAlign: "left", width: 100, height: 30, yOffset: -5000 })),
    ));
    const a = floatOf(l, 0);
    const b = floatOf(l, 1);
    const stacked = blockWith(l, "Stacked");
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.height);
    expect(b.page).toBe(stacked.page);
    expect(stacked.y).toBe(naturalY(l, stacked));
  });

  describe("a move re-places every float whose anchor it shifts", () => {
    it("23: a float between the table and the pinned float's anchor follows its paragraph", () => {
      const l = layout(docOf(
        table("T", 3),
        para("Mid", image({ wrapMode: "square", xAlign: "left", width: 80, height: 40 })),
        para("Anchor", image({ wrapMode: "square", height: 60, yOffset: -5000 })),
      ));
      expectOnAnchor(l, floatOf(l, 0), "Mid", 0);
      expectOnAnchor(l, floatOf(l, 1), "Anchor", -5000);
      expectBelowFloat(rowsOf(l, "T"), floatOf(l, 1));
    });

    it("24: a pinned float cannot drag a free float off its anchor; the table stays", () => {
      const plain = layout(docOf(para("Intro"), table("T", 3), para("Anchor"), para("Tail")));
      const yOffset = must(rowsOf(plain, "T")[1], "row 1").y - blockWith(plain, "Anchor").y;
      const l = layout(docOf(
        para("Intro"), table("T", 3),
        para("Anchor", image({ wrapMode: "square", height: 60, yOffset })),
        para("Tail", image({ wrapMode: "square", xAlign: "left", width: 100, height: 60, yOffset: -5000 })),
      ));
      expectOnAnchor(l, floatOf(l, 0), "Anchor", yOffset);
      expectOnAnchor(l, floatOf(l, 1), "Tail", -5000);
      expect(rowsOf(l, "T").map((r) => r.y)).toEqual(rowsOf(plain, "T").map((r) => r.y));
    });

    it("25: a move that would carry the anchor onto the next page is refused", () => {
      const lead = table("T", 3);
      const probeDoc = layout(docOf(lead, ...Array.from({ length: 80 }, (_, n) => para(`Filler ${n}`))));
      const fillersOnPage1 = blocksOf(probeDoc).filter((b) => b.page === 1 && b.kind === "text").length;
      const fillers = Array.from({ length: fillersOnPage1 - 1 }, (_, n) => para(`Filler ${n}`));
      const anchorDoc = (withFloat: boolean) => docOf(
        table("T", 3),
        ...fillers,
        para("Anchor", ...(withFloat
          ? [image({ wrapMode: "square", height: 10, margin: 40, yOffset: -5000 })]
          : [])),
      );
      const plain = layout(anchorDoc(false));
      expect(blockWith(plain, "Anchor").page).toBe(1);

      const l = layout(anchorDoc(true));
      const f = floatOf(l);
      expect(blockWith(l, "Anchor").page).toBe(1);
      expect(f.page).toBe(1);
      expect(rowsOf(l, "T").map((r) => r.y)).toEqual(rowsOf(plain, "T").map((r) => r.y));
    });
  });

  it("26: a table split across pages moves only its rows on the float's page", () => {
    const l = layout(docOf(para("Anchor", image({ wrapMode: "square" })), table("T", 60)));
    const f = floatOf(l);
    const rows = rowsOf(l, "T");
    expectBelowFloat(rows.filter((r) => r.page === f.page), f);
    const page2 = computePageMetrics(defaultPageConfig, EMPTY_RESOLVED_CHROME, 2);
    expect(must(rows.find((r) => r.page === 2), "page-2 row").y).toBe(page2.contentTop);
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

  describe("each float owns its placement", () => {
    const words = (n: number) => "word ".repeat(n).trim();

    function floatsOverlap(a: AnchoredObjectPlacement, b: AnchoredObjectPlacement): boolean {
      return a.page === b.page && a.x < b.x + b.width && b.x < a.x + a.width &&
        a.y < b.y + b.height && b.y < a.y + a.height;
    }

    /** Every float sits on its anchor paragraph's page. */
    function expectFloatsOnAnchorPages(l: DocumentLayout): void {
      for (const f of l.anchoredObjects ?? []) {
        const anchor = must(
          l.pages.flatMap((page) => page.blocks.map((b) => ({ page: page.pageNumber, b })))
            .find(({ b }) => b.kind === "text" && b.nodePos < f.docPos && f.docPos <= b.nodePos + b.node.nodeSize),
          `anchor of ${f.docPos}`,
        );
        expect(f.page).toBe(anchor.page);
      }
    }

    it("28: two square floats in one paragraph stack, the first stays on its anchor", () => {
      const l = layout(docOf(para(`A ${WORDS_40}`,
        image({ wrapMode: "square", height: 100 }), image({ wrapMode: "square", height: 100 }))));
      const [a, b] = [floatOf(l, 0), floatOf(l, 1)];
      expect(floatsOverlap(a, b)).toBe(false);
      expectOnAnchor(l, a, "A word", 0);
      expect(b.page).toBe(a.page);
    });

    it("29: a block above that really grows keeps a stacked float below the one it stacked on", () => {
      const l = layout(docOf(
        para(`PA ${words(30)}`, image({ wrapMode: "square", height: 150 })),
        para("PB", image({ wrapMode: "square", height: 100 })),
        para("PC", image({ wrapMode: "square", xAlign: "left", width: 250, height: 60, yOffset: -180 })),
        para(`Q ${words(80)}`),
      ));
      expect(floatsOverlap(floatOf(l, 0), floatOf(l, 1))).toBe(false);
    });

    // Each float's own wrap grows the paragraph above it, which moves its
    // anchor: no fixed point. Each locks where it stood when its placement
    // first repeated, so it sits within the paragraph above's height of
    // `anchor + yOffset`, with no text under it.
    it("30: floats with no fixed point lock in place without dragging later ones", () => {
      const l = expectStable(docOf(...Array.from({ length: 6 }, (_, i) => para(`P${i} ${words(25)}`,
        image({ wrapMode: "square", xAlign: i % 2 ? "left" : "right", width: 120, height: 30, yOffset: -40 })))));
      expect(textUnderFloats(l)).toEqual([]);
      expectFloatsOnAnchorPages(l);
      const blocks = blocksOf(l);
      (l.anchoredObjects ?? []).forEach((f, i) => {
        const anchorIndex = blocks.findIndex((b) => b.text.startsWith(`P${i} `));
        const anchor = must(blocks[anchorIndex], "anchor");
        const above = blocks[anchorIndex - 1];
        if (f.clamped) return;
        expect(Math.abs(f.y - (anchor.y - 40))).toBeLessThanOrEqual(above?.height ?? 0);
      });
    });

    it("32: a restamp inside one reflow never moves a table below a stale float rect", () => {
      const l = layout(docOf(
        para(`Lead ${WORDS_40}`),
        table("T", 3),
        para("Anchor", image({ wrapMode: "top-bottom", width: 100, height: 200 })),
        para("Tail", image({ wrapMode: "square", width: 300, height: 40, yOffset: -5000 })),
      ));
      const first = must(rowsOf(l, "T")[0], "first row");
      expect(first.y).toBe(naturalY(l, first));
    });

    it("35: pageless with a page height — the table is not moved, so nothing lands under the float", () => {
      const l = layout(
        docOf(para(`Anchor ${words(5)}`, image({ wrapMode: "square", height: 150 })), table("T", 3), para(`Tail ${words(80)}`)),
        { ...defaultPageConfig, pageless: true },
      );
      const first = must(rowsOf(l, "T")[0], "first row");
      expect(first.y).toBe(naturalY(l, first));
      const f = floatOf(l);
      const tail = must(l.pages[0]?.blocks.find((b) => b.node.textContent.startsWith("Tail")), "Tail");
      let lineY = tail.y;
      for (const line of tail.lines) {
        const right = Math.max(...line.spans.map((span) => tail.x + span.x + span.width));
        if (lineY < f.y + f.height && lineY + line.lineHeight > f.y) expect(right).toBeLessThanOrEqual(f.x);
        lineY += line.lineHeight;
      }
    });

    // Known gap, pinned: each streamed chunk starts with no floats and no
    // exclusions, so a float in an earlier chunk does not move a table in a
    // later one. Text has the same gap on `main`.
    it("36: streaming — a float in an earlier chunk does not move a table in a later one", () => {
      const d = docOf(para(`Anchor ${words(5)}`, image({ wrapMode: "square", height: 150 })), table("T", 3));
      const measurer = createMeasurer();
      const opts = { pageConfig: defaultPageConfig, fontConfig, measurer, maxBlocks: 1 };
      let l = runPipeline(d, opts);
      for (let guard = 0; l.isPartial && l.resumption && guard < 20; guard++) {
        l = runPipeline(d, { ...opts, resumption: l.resumption, previousLayout: l });
      }
      const first = must(rowsOf(l, "T")[0], "first row");
      expect(first.y).toBe(naturalY(l, first));
    });

    it("38: a move may not carry the table under a float that does not follow it", () => {
      const plain = layout(docOf(table("T", 12), para("Pin"), para("Bottom")));
      const page1 = computePageMetrics(defaultPageConfig, EMPTY_RESOLVED_CHROME, 1);
      const tableBottom = Math.max(...rowsOf(plain, "T").map((r) => r.y + r.height));
      const l = layout(docOf(
        table("T", 12),
        para("Pin", image({ wrapMode: "square", height: 120, yOffset: -5000 })),
        para("Bottom", image({
          wrapMode: "square", xAlign: "left", width: 100,
          height: page1.contentTop + page1.contentHeight - tableBottom - 60, yOffset: 5000,
        })),
      ));
      const bottom = floatOf(l, 1);
      expect(bottom.clamped).toBe(true);
      for (const row of rowsOf(l, "T")) expect(overlaps(row, bottom)).toBe(false);
    });

    // Guard: a float anchored after the table whose anchor is carried to the
    // next page is placed again there; it never blocks the move. Not red on
    // any earlier version: the float is placed after the move it rides on.
    it("37: a float that does not reach back over the table may be carried onto the next page", () => {
      const fillersOnPage1 = blocksOf(layout(docOf(table("T", 3),
        ...Array.from({ length: 80 }, (_, n) => para(`Filler ${n}`))))).filter((b) => b.page === 1 && b.kind === "text").length;
      const l = layout(docOf(
        table("T", 3),
        para("Pin", image({ wrapMode: "square", height: 200, yOffset: -5000 })),
        ...Array.from({ length: fillersOnPage1 - 2 }, (_, n) => para(`Filler ${n}`)),
        para("Carried", image({ wrapMode: "square", xAlign: "left", width: 60, height: 10 })),
      ));
      expectBelowFloat(rowsOf(l, "T"), floatOf(l, 0));
      expect(blockWith(l, "Carried").page).toBe(2);
      expectOnAnchor(l, floatOf(l, 1), "Carried", 0);
    });

    /** Text lines that run under a square or top-bottom float. */
    function textUnderFloats(l: DocumentLayout): string[] {
      const out: string[] = [];
      for (const f of l.anchoredObjects ?? []) {
        if (f.wrapMode !== "square" && f.wrapMode !== "top-bottom") continue;
        for (const page of l.pages) {
          if (page.pageNumber !== f.page) continue;
          for (const b of page.blocks) {
            if (b.kind !== "text") continue;
            let y = b.y;
            for (const line of b.lines) {
              for (const s of line.spans) {
                if (s.kind !== "text" || s.text.trim() === "") continue;
                const left = b.x + s.x;
                const beside = f.wrapMode === "square" && (left + s.width <= f.x + 0.5 || left >= f.x + f.width - 0.5);
                const below = y + line.lineHeight <= f.y + 0.5 || y >= f.y + f.height - 0.5;
                if (!beside && !below) out.push(`${b.node.textContent.slice(0, 3)}@${y.toFixed(0)}`);
              }
              y += line.lineHeight;
            }
          }
        }
      }
      return [...new Set(out)];
    }

    /** Two layouts of the same document agree, so the settle is deterministic. */
    function expectStable(d: Node): DocumentLayout {
      const first = layout(d);
      expect(blocksOf(layout(d))).toEqual(blocksOf(first));
      return first;
    }

    it("39: a float pulled over the line above its anchor never leaves text under it", () => {
      // A top-bottom float whose top covers the last line of the paragraph
      // above its anchor: clearing that line moves the anchor, which moves
      // the float back over it. No fixed point, on any font set.
      const plain = layout(docOf(para(`Above ${WORDS_40}`), para("Anchor")));
      const aboveBlock = must(plain.pages[0]?.blocks[0], "above");
      const lastLine = must(aboveBlock.lines.at(-1), "last line");
      const lastLineY = aboveBlock.y + aboveBlock.height - lastLine.lineHeight;
      const yOffset = lastLineY - blockWith(plain, "Anchor").y;
      const l = expectStable(docOf(
        para(`Above ${WORDS_40}`),
        para(`Anchor ${WORDS_40}`, image({ wrapMode: "top-bottom", width: 200, height: 60, yOffset })),
      ));
      expect(textUnderFloats(l)).toEqual([]);
      expectFloatsOnAnchorPages(l);
    });

    // Guard, never red (on main either). A float whose own zone covers the
    // paragraph before it has no fixed point and locks; what follows moves
    // with it while it settles. A float later on, at yOffset 0, cannot move
    // its own anchor: it must follow its paragraph, never lock off it.
    it("55: guard — a float after one that locks stays on its anchor", () => {
      const l = expectStable(docOf(
        para(`P0 ${words(3)}`),
        para("A2", image({ wrapMode: "top-bottom", xAlign: "left", width: 200, height: 250 })),
        para(`A3 ${words(40)}`, image({ wrapMode: "top-bottom", xAlign: "left", width: 200, height: 150, yOffset: -120 })),
        para(`Follower ${words(40)}`, image({ wrapMode: "square", xAlign: "left", width: 120, height: 40 })),
      ));
      const follower = floatOf(l, 2);
      expect(follower.clamped).toBeUndefined();
      expect(follower.stackOffset).toBeUndefined();
      expect(follower.y).toBeCloseTo(blockWith(l, "Follower").y, 6);
      expect(textUnderFloats(l)).toEqual([]);
    });

    it("41: a float whose own zone covers the paragraph it would push leaves no text under it", () => {
      const l = expectStable(docOf(
        para(`P0 ${words(3)}`),
        table("T", 4),
        para("A2", image({ wrapMode: "top-bottom", xAlign: "left", width: 200, height: 250 })),
        para(`A3 ${words(40)}`, image({ wrapMode: "top-bottom", xAlign: "left", width: 200, height: 150, yOffset: -120 })),
      ));
      expect(textUnderFloats(l)).toEqual([]);
      expectFloatsOnAnchorPages(l);
    });

    describe("built from measured geometry, so any font set triggers them", () => {
      const page1 = computePageMetrics(defaultPageConfig, EMPTY_RESOLVED_CHROME, 1);
      const pageBottom = page1.contentTop + page1.contentHeight;
      const filler = (n: number) => para(`Filler ${n}`);

      /** How many one-line fillers after `lead` still start on page 1. */
      function fillersOnPage1(lead: Node[]): number {
        const l = layout(docOf(...lead, ...Array.from({ length: 120 }, (_, n) => filler(n))));
        return blocksOf(l).filter((b) => b.page === 1 && b.text.startsWith("Filler ")).length;
      }

      it("47: a paragraph moved whole onto the next page wraps around that page's float", () => {
        const count = fillersOnPage1([]);
        const l = expectStable(docOf(
          ...Array.from({ length: count }, (_, n) => filler(n)),
          para(`Moved ${LONG_TEXT}`),
          para("Pin", image({ wrapMode: "square", width: 200, height: 120, yOffset: -5000 })),
        ));
        expect(blockWith(l, "Moved").page).toBe(2);
        expect(textUnderFloats(l)).toEqual([]);
      });

      it("48: a float with a stable position does not lock on another float's oscillation", () => {
        // "Flip", a pinned top-bottom float on the last line of page 1, has no
        // fixed point: it pushes that line to page 2 and back. "Steady"
        // reaches up beside the short paragraph above it, which does not
        // grow around it, so it has a stable position and must end on it.
        const count = fillersOnPage1([para("Above")]);
        const plain = layout(docOf(para("Above"), para("Steady")));
        const yOffset = blockWith(plain, "Above").y - blockWith(plain, "Steady").y;
        const l = expectStable(docOf(
          para("Above"),
          para("Steady", image({ wrapMode: "square", xAlign: "left", width: 60, height: 30, yOffset })),
          ...Array.from({ length: count - 2 }, (_, n) => filler(n)),
          para("Flip", image({ wrapMode: "top-bottom", width: 200, height: 120, yOffset: -5000 })),
        ));
        expect(floatOf(l, 0).y).toBeCloseTo(blockWith(l, "Steady").y + yOffset, 6);
        expectFloatsOnAnchorPages(l);
      });

      it("49: a locked float anchored after a table overlaps it instead of pushing it", () => {
        const plain = layout(docOf(table("T", 3), para(`Q ${WORDS_40}`), para("Anchor")));
        const rows = rowsOf(plain, "T");
        const lastRow = must(rows[rows.length - 1], "last row");
        const anchorY = blockWith(plain, "Anchor").y;
        const l = expectStable(docOf(
          table("T", 3), para(`Q ${WORDS_40}`),
          para("Anchor", image({
            wrapMode: "top-bottom", width: 200, height: anchorY - lastRow.y,
            yOffset: lastRow.y - anchorY,
          })),
        ));
        expect(rowsOf(l, "T").map((r) => r.y)).toEqual(rows.map((r) => r.y));
        expect(textUnderFloats(l)).toEqual([]);
      });

      it("51: a paragraph split across pages wraps the next page's float on its continuation", () => {
        // The last filler that fits, minus one, leaves room for the split
        // paragraph's first line on page 1 and sends the rest to page 2.
        const count = fillersOnPage1([]);
        const l = expectStable(docOf(
          ...Array.from({ length: count - 1 }, (_, n) => filler(n)),
          para(`Split ${LONG_TEXT}`),
          para("Pin", image({ wrapMode: "square", width: 200, height: 120, yOffset: -5000 })),
        ));
        const parts = blocksOf(l).filter((b) => b.text.startsWith("Split"));
        expect(new Set(parts.map((b) => b.page))).toEqual(new Set([1, 2]));
        expect(textUnderFloats(l)).toEqual([]);
      });

      it("34: guard — a float follows its anchor when the anchor's first line lands on the next page", () => {
        const count = fillersOnPage1([]);
        for (let n = count - 2; n <= count; n++) {
          const l = expectStable(docOf(
            ...Array.from({ length: n }, (_, k) => filler(k)),
            para(`Anchor ${LONG_TEXT}`, image({ wrapMode: "square", height: 100 })),
          ));
          const f = floatOf(l);
          const anchorBlock = blockWith(l, "Anchor");
          expect(f.page, `${n} fillers`).toBe(anchorBlock.page);
          expect(f.y).toBeCloseTo(anchorBlock.y, 6);
        }
      });

      // An image dragged up over the lines above its paragraph, when that
      // paragraph is near the page bottom: the lines it covers move below it
      // and push the paragraph onto the next page, the image follows, the
      // lines come back, and so does the paragraph. Wherever the paragraph
      // starts, the image must end on its page with no text under it.
      it("43: an image dragged up in a paragraph near the page bottom ends on its page with no text under it", () => {
        const count = fillersOnPage1([]);
        for (let n = count - 12; n <= count; n++) {
          for (const yOffset of [-40, -100]) {
            const l = expectStable(docOf(
              ...Array.from({ length: n }, (_, k) => filler(k)),
              para("Flip", image({ wrapMode: "top-bottom", width: 127, height: 160, yOffset })),
            ));
            expect(textUnderFloats(l), `${n} fillers, yOffset ${yOffset}`).toEqual([]);
            expectFloatsOnAnchorPages(l);
          }
        }
      });

      it("44: a paragraph that runs onto the next page keeps its wrap on both pages", () => {
        // Three fillers short of a full page: the paragraph starts on page 1
        // with room for its float and runs onto page 2.
        const count = fillersOnPage1([]);
        const l = expectStable(docOf(
          ...Array.from({ length: count - 3 }, (_, k) => filler(k)),
          para(`Split ${LONG_TEXT}`, image({ wrapMode: "square", xAlign: "left", width: 150, height: 30 })),
          para("Pin", image({ wrapMode: "square", width: 200, height: 120, yOffset: -5000 })),
        ));
        const parts = blocksOf(l).filter((b) => b.text.startsWith("Split"));
        expect(new Set(parts.map((b) => b.page))).toEqual(new Set([1, 2]));
        expect(textUnderFloats(l)).toEqual([]);
      });

      // The gap before a block can carry its start past the page bottom;
      // pagination then drops the gap and paints the block at the next page's
      // top. Every count of fillers near the bottom walks through that case.
      it("53: a heading near the page bottom keeps the anchor after it where it paints", () => {
        const count = fillersOnPage1([]);
        for (let n = count - 4; n <= count; n++) {
          const l = expectStable(docOf(
            ...Array.from({ length: n }, (_, k) => filler(k)),
            schema.node("heading", { level: 2 }, [schema.text("Title")]),
            para(`Anchor ${WORDS_40}`, image({ wrapMode: "top-bottom", width: 200, height: 300, yOffset: -160 })),
          ));
          expect(textUnderFloats(l), `${n} fillers`).toEqual([]);
          expectFloatsOnAnchorPages(l);
        }
      });

      // A large word makes a paragraph's first line taller than the rest; when
      // the paragraph is re-wrapped, its first line can change, and so can
      // whether it fits at the page bottom.
      it("54: a paragraph whose first line changes height on re-wrap lands where it paints", () => {
        const count = fillersOnPage1([]);
        const big = schema.text("BIG", [schema.mark("fontSize", { size: 48 })]);
        for (let n = count - 4; n <= count; n++) {
          for (const lead of [4, 8]) {
            const l = expectStable(docOf(
              ...Array.from({ length: n }, (_, k) => filler(k)),
              schema.node("paragraph", null, [schema.text(`Big ${words(lead)} `), big, schema.text(` ${LONG_TEXT}`)]),
              para(`Pin ${words(10)}`, image({ wrapMode: "square", xAlign: "left", width: 300, height: 200, yOffset: -5000 })),
            ));
            expect(textUnderFloats(l), `${n} fillers, ${lead} words`).toEqual([]);
          }
        }
      });

      it("50: a square float clamped to the page bottom still stacks clear of the one above", () => {
        const count = fillersOnPage1([]);
        const plain = layout(docOf(...Array.from({ length: count }, (_, n) => filler(n))));
        const target = pageBottom - 300;
        const anchorIndex = blocksOf(plain).findIndex((b) => b.y >= target);
        const l = expectStable(docOf(
          ...Array.from({ length: anchorIndex }, (_, n) => filler(n)),
          para("High", image({ wrapMode: "square", width: 200, height: 200 })),
          para("Low", image({ wrapMode: "square", width: 200, height: 150, yOffset: 5000 })),
        ));
        expect(floatsOverlap(floatOf(l, 0), floatOf(l, 1))).toBe(false);
        expectFloatsOnAnchorPages(l);
      });
    });
  });
});
