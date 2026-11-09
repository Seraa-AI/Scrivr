import { describe, it, expect } from "vitest";
import type { Node } from "prosemirror-model";
import { ExtensionManager } from "../extensions/ExtensionManager";
import { StarterKit } from "../extensions/StarterKit";
import { createMeasurer } from "../test-utils";
import { runPipeline, defaultPageConfig } from "./PageLayout";
import type { DocumentLayout } from "./PageLayout";
import type { AnchoredObjectPlacement } from "./AnchoredObjects";
import type { CellSubBlock, LayoutBlock } from "./BlockLayout";

/**
 * An image anchored in a table cell is laid out in that cell, as Word does
 * with `layoutInCell`: it wraps the cell's own text and the row grows to hold
 * it. Every expectation relates measured values from the same layout.
 */

const manager = new ExtensionManager([StarterKit.configure({ table: true })]);
const schema = manager.schema;
const fontConfig = manager.buildBlockStyles();
const CELL_TEXT = "word ".repeat(30).trim();

function must<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new Error(`missing ${what}`);
  return value;
}

function para(text: string, ...inline: Node[]): Node {
  return schema.node("paragraph", null, [schema.text(text), ...inline]);
}

function image(attrs: Record<string, unknown>): Node {
  return schema.node("image", { src: "", width: 60, height: 80, xAlign: "left", wrapMode: "square", ...attrs });
}

function row(label: string, first: Node[], second: Node[] = [para(`${label} other`)]): Node {
  return schema.node("tableRow", null, [schema.node("tableCell", null, first), schema.node("tableCell", null, second)]);
}

function tableOf(...rows: Node[]): Node {
  return schema.node("table", { grid: [300, 200] }, rows);
}

function layout(...blocks: Node[]): DocumentLayout {
  return runPipeline(schema.node("doc", null, blocks), { pageConfig: defaultPageConfig, fontConfig, measurer: createMeasurer() });
}

function rowBlock(l: DocumentLayout, label: string): { block: LayoutBlock; page: number } {
  for (const page of l.pages) {
    const block = page.blocks.find((b) => b.kind === "tableRow" && b.node.textContent.endsWith(`${label} other`));
    if (block) return { block, page: page.pageNumber };
  }
  throw new Error(`missing row ${label}`);
}

function cellOf(block: LayoutBlock, index: number): CellSubBlock {
  return must(block.cells?.[index], `cell ${index}`);
}

function floatIn(l: DocumentLayout): AnchoredObjectPlacement {
  return must(l.anchoredObjects?.[0], "float");
}

/** The cell's lines in page-local y, with their x extent. */
function cellLines(block: LayoutBlock, cell: CellSubBlock) {
  return cell.blocks.flatMap((b) =>
    b.lines.map((line, i) => {
      const top = block.y + cell.y + b.y + b.lines.slice(0, i).reduce((sum, l) => sum + l.lineHeight, 0);
      const spans = line.spans.filter((s) => s.kind === "text" && s.width > 0);
      const left = Math.min(...spans.map((s) => b.x + s.x));
      const right = Math.max(...spans.map((s) => b.x + s.x + s.width));
      return { top, bottom: top + line.lineHeight, left, right, hasText: spans.length > 0 };
    }),
  );
}

describe("an image anchored in a table cell", () => {
  it("1: square wraps the cell's text beside it, and the row holds the image", () => {
    const plain = layout(tableOf(row("R", [para(CELL_TEXT)])));
    const l = layout(tableOf(row("R", [para(CELL_TEXT, image({}))])));
    const { block, page } = rowBlock(l, "R");
    const cell = cellOf(block, 0);
    const f = floatIn(l);

    expect(f.page).toBe(page);
    expect(f.x).toBeGreaterThanOrEqual(cell.x);
    expect(f.x + f.width).toBeLessThanOrEqual(cell.x + cell.width);
    expect(f.y).toBeGreaterThanOrEqual(block.y);
    expect(block.y + block.height).toBeGreaterThanOrEqual(f.y + f.height);
    for (const line of cellLines(block, cell)) {
      if (!line.hasText || line.bottom <= f.y || line.top >= f.y + f.height) continue;
      expect(line.left).toBeGreaterThanOrEqual(f.x + f.width);
    }
    expect(block.height).toBeGreaterThan(rowBlock(plain, "R").block.height);
  });

  it.each([
    ["after the text", (img: Node) => para("Milestones reviewed", img)],
    ["before the text", (img: Node) => schema.node("paragraph", null, [img, schema.text("Milestones reviewed")])],
  ])("1b: a word too wide for the gap beside the image goes below it, never into the next cell (anchor %s)", (_, cellPara) => {
    const l = layout(tableOf(row("R", [cellPara(image({ width: 340, height: 60 }))])));
    const { block } = rowBlock(l, "R");
    const cell = cellOf(block, 0);
    const f = floatIn(l);
    const lines = cellLines(block, cell).filter((line) => line.hasText);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.right).toBeLessThanOrEqual(cell.x + cell.width);
      expect(line.top).toBeGreaterThanOrEqual(f.y + f.height);
    }
  });

  it.each([-40, -70, -100])("1c: an image raised %ipx over the paragraph above never has text under it", (yOffset) => {
    const l = layout(tableOf(row("R", [
      para("alpha ".repeat(20).trim()),
      para("beta ".repeat(20).trim(), image({ width: 230, height: 80, yOffset })),
    ])));
    const { block } = rowBlock(l, "R");
    const f = floatIn(l);
    for (const line of cellLines(block, cellOf(block, 0))) {
      if (!line.hasText) continue;
      const beside = line.bottom > f.y && line.top < f.y + f.height;
      if (beside) expect(line.left >= f.x + f.width || line.right <= f.x).toBe(true);
    }
  });

  it("2b: top-and-bottom in a later paragraph sits at that paragraph, with its text below it", () => {
    const l = layout(tableOf(row("R", [para("Short intro"), para("Second", image({ wrapMode: "top-bottom", width: 100, height: 60 }))])));
    const { block } = rowBlock(l, "R");
    const cell = cellOf(block, 0);
    const f = floatIn(l);
    const second = must(cell.blocks[1], "second paragraph");
    expect(f.y).toBeCloseTo(block.y + second.y, 6);
    for (const line of cellLines(block, cell)) {
      if (line.hasText) expect(line.bottom <= f.y || line.top >= f.y + f.height).toBe(true);
    }
  });

  it("2c: two top-and-bottom images in one paragraph do not cover each other", () => {
    const l = layout(tableOf(row("R", [para("Text", image({ wrapMode: "top-bottom" }), image({ wrapMode: "top-bottom" }))])));
    const [a, b] = l.anchoredObjects ?? [];
    if (!a || !b) throw new Error("expected two images");
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.height);
  });

  it("2d: an image wider than its cell is scaled down whole, not squashed", () => {
    const l = layout(tableOf(row("R", [para("Text", image({ width: 800, height: 200 }))])));
    const f = floatIn(l);
    expect(f.width).toBeLessThan(800);
    expect(f.height / f.width).toBeCloseTo(200 / 800, 6);
  });

  it("2: top-and-bottom puts the cell's text below the image", () => {
    const l = layout(tableOf(row("R", [para(CELL_TEXT, image({ wrapMode: "top-bottom" }))])));
    const { block } = rowBlock(l, "R");
    const f = floatIn(l);
    for (const line of cellLines(block, cellOf(block, 0))) {
      if (!line.hasText) continue;
      expect(line.bottom <= f.y || line.top >= f.y + f.height).toBe(true);
    }
    expect(block.y + block.height).toBeGreaterThanOrEqual(f.y + f.height);
  });

  it.each(["behind", "front"])("3: %s paints in the cell and leaves the row's height alone", (wrapMode) => {
    const plain = layout(tableOf(row("R", [para("Short")])));
    const l = layout(tableOf(row("R", [para("Short", image({ wrapMode }))])));
    const { block } = rowBlock(l, "R");
    const cell = cellOf(block, 0);
    const f = floatIn(l);
    expect(f.x).toBeGreaterThanOrEqual(cell.x);
    expect(f.y).toBeGreaterThanOrEqual(block.y);
    expect(block.height).toBe(rowBlock(plain, "R").block.height);
  });

  it("4: a negative offset never lifts the image above its cell", () => {
    const l = layout(
      tableOf(row("A", [para("Above")]), row("R", [para("First"), para(CELL_TEXT, image({ yOffset: -5000 }))])),
    );
    const { block } = rowBlock(l, "R");
    const f = floatIn(l);
    expect(f.y).toBeGreaterThanOrEqual(block.y);
    expect(f.clamped).toBe(true);
  });

  it("5: the neighbouring cell and the rows around keep their places", () => {
    const plain = layout(tableOf(row("A", [para("Above")]), row("R", [para("Short")]), row("B", [para("Below")])));
    const l = layout(tableOf(row("A", [para("Above")]), row("R", [para("Short", image({}))]), row("B", [para("Below")])));
    const above = rowBlock(l, "A").block;
    const r = rowBlock(l, "R").block;
    const below = rowBlock(l, "B").block;
    expect(above.y).toBe(rowBlock(plain, "A").block.y);
    expect(r.y).toBe(rowBlock(plain, "R").block.y);
    expect(below.y).toBe(r.y + r.height);
    const plainSecond = cellOf(rowBlock(plain, "R").block, 1);
    expect(cellOf(r, 1).x).toBe(plainSecond.x);
    expect(cellOf(r, 1).width).toBe(plainSecond.width);
    expect(cellOf(r, 1).blocks[0]?.lines.length).toBe(plainSecond.blocks[0]?.lines.length);
  });

  it("5b: an in-cell image never moves the body or the table under Decision 1", () => {
    const l = layout(para("Before"), tableOf(row("R", [para(CELL_TEXT, image({ height: 300 }))])), para("After"));
    const r = rowBlock(l, "R");
    const f = floatIn(l);
    const after = must(l.pages.flatMap((p) => p.blocks).find((b) => b.node.textContent === "After"), "after");
    expect(f.y).toBeGreaterThanOrEqual(r.block.y);
    expect(after.y).toBeGreaterThanOrEqual(r.block.y + r.block.height);
  });

  it("9: a row carried onto the next page takes its image with it", () => {
    const filler = Array.from({ length: 60 }, (_, i) => para(`Filler ${i} ${CELL_TEXT}`));
    const l = layout(...filler, tableOf(row("R", [para(CELL_TEXT, image({ height: 120 }))])));
    const { block, page } = rowBlock(l, "R");
    const f = floatIn(l);
    expect(f.page).toBe(page);
    expect(f.y).toBeGreaterThanOrEqual(block.y);
    expect(f.y + f.height).toBeLessThanOrEqual(block.y + block.height);
  });

  it("marks the placement with the cell that holds it", () => {
    const l = layout(tableOf(row("R", [para("Short", image({}))])));
    const { block } = rowBlock(l, "R");
    expect(floatIn(l).cellPos).toBe(cellOf(block, 0).cellPos);
  });
});
