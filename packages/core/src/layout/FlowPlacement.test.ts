import { describe, it, expect } from "vitest";
import type { Node } from "prosemirror-model";
import { ExtensionManager } from "../extensions/ExtensionManager";
import { StarterKit } from "../extensions/StarterKit";
import { createMeasurer } from "../test-utils";
import { runPipeline, collapseMargins, defaultPageConfig } from "./PageLayout";
import type { DocumentLayout } from "./PageLayout";

/**
 * Flow stamping must land and end each block where pagination paints it, or
 * every later block is stamped off its painted position. Page heights are
 * derived from measured layouts, never fixed pixels.
 */

const manager = new ExtensionManager([StarterKit.configure({ table: true })]);
const schema = manager.schema;
const fontConfig = manager.buildBlockStyles();
const WORDS = "word ".repeat(30).trim();

function para(text: string): Node {
  return schema.node("paragraph", null, [schema.text(text)]);
}

function layoutAt(d: Node, pageHeight: number): DocumentLayout {
  return runPipeline(d, { pageConfig: { ...defaultPageConfig, pageHeight }, fontConfig, fontModifiers: manager.buildFontModifiers(), measurer: createMeasurer() });
}

/** Blocks not at their page's content top nor right after the block above (with or without the gap). */
function misplaced(l: DocumentLayout): string[] {
  const out: string[] = [];
  l.pages.forEach((page, pageIndex) => {
    const top = l.metrics?.[pageIndex]?.contentTop;
    page.blocks.forEach((b, i) => {
      const prev = page.blocks[i - 1];
      if (!prev) {
        if (b.y !== top) out.push(`page ${page.pageNumber} starts at ${b.y}, content top ${top}`);
        return;
      }
      const end = prev.y + prev.height;
      const gap = collapseMargins(prev.spaceAfter, b.spaceBefore);
      if (Math.abs(b.y - end) > 0.01 && Math.abs(b.y - end - gap) > 0.01) {
        out.push(`page ${page.pageNumber} block ${i} at ${b.y}, previous ends ${end}`);
      }
    });
  });
  return out;
}

/** The page height that puts page 1's content bottom `belowEnd` px below the end of its block `index`. */
function pageHeightBelow(d: Node, index: number, belowEnd: number): number {
  const tall = 5000;
  const l = layoutAt(d, tall);
  const block = l.pages[0]?.blocks[index];
  const bottom = l.metrics?.[0]?.contentBottom;
  if (!block || bottom === undefined) throw new Error("no block");
  return tall - bottom + block.y + block.height + belowEnd;
}

describe("flow landing", () => {
  it.each([["one line", "T short"], ["several lines", `T ${WORDS}`]])("a first line within half a pixel of fitting is painted on its page, and what follows starts the next page clean (%s)", (_, text) => {
    const d = schema.node("doc", null, [para(`A ${WORDS}`), para(`B ${WORDS}`), para(text), para(`C ${WORDS}`), para(`D ${WORDS}`)]);
    const lineHeight = layoutAt(d, 5000).pages[0]?.blocks[2]?.lines[0]?.lineHeight ?? 0;
    const l = layoutAt(d, pageHeightBelow(d, 1, lineHeight - 0.25));

    const page1 = l.pages[0]?.blocks ?? [];
    expect(page1.at(-1)?.node.textContent.startsWith("T")).toBe(true);
    expect(misplaced(l)).toEqual([]);
  });

  it("a gap that reaches the page bottom moves the block to the next page even if its first line would fit without it", () => {
    // Small print: a line shorter than the gap between paragraphs.
    const small = schema.node("paragraph", null, [schema.text("Small", [schema.mark("fontSize", { size: 6 })])]);
    const d = schema.node("doc", null, [para(`A ${WORDS}`), small, para(`C ${WORDS}`)]);
    const tall = layoutAt(d, 5000).pages[0]?.blocks ?? [];
    const gap = collapseMargins(tall[0]?.spaceAfter ?? 0, tall[1]?.spaceBefore ?? 0);
    const lineHeight = tall[1]?.lines[0]?.lineHeight ?? 0;
    expect(gap).toBeGreaterThan(lineHeight);
    const l = layoutAt(d, pageHeightBelow(d, 0, (gap + lineHeight) / 2));

    expect(l.pages[1]?.blocks[0]?.node.textContent).toBe("Small");
    expect(misplaced(l)).toEqual([]);
  });
});
