/** The documents, page set-ups and comparison behind the layout oracle. */
import type { Node } from "prosemirror-model";
import { EditorState, type Transaction } from "prosemirror-state";
import { ExtensionManager } from "../extensions/ExtensionManager";
import { StarterKit } from "../extensions/StarterKit";
import { populateCharMap, registeredLineCount, type LayoutBlock } from "../layout/BlockLayout";
import { CharacterMap } from "../layout/CharacterMap";
import {
  defaultPageConfig,
  defaultPagelessConfig,
  runPipeline,
  type DocumentLayout,
  type MeasureCacheEntry,
  type PageConfig,
  type PageLayoutOptions,
} from "../layout/PageLayout";
import type { PageChromeContribution } from "../layout/PageMetrics";
import type { TextMeasurerLike } from "../layout/TextMeasurer";
import { createMeasurer } from "../test-utils";

const manager = new ExtensionManager([StarterKit.configure({ table: true })]);
export const schema = manager.schema;
const fontConfig = manager.buildBlockStyles();
const fontModifiers = manager.buildFontModifiers();
const measurer = createMeasurer();

// ── Documents ─────────────────────────────────────────────────────────────────

export const doc = (...blocks: Node[]): Node => schema.node("doc", null, blocks);
export const text = (value: string): Node => schema.text(value);
export const sized = (value: string, size: number): Node => schema.text(value, [schema.mark("fontSize", { size })]);
export const words = (count: number): string => Array.from({ length: count }, (_, i) => `word${i}`).join(" ");
export const p = (content: string | Node[] = [], attrs: Record<string, unknown> | null = null): Node =>
  schema.node("paragraph", attrs, typeof content === "string" ? [text(content)] : content);
export const h = (level: number, value: string): Node => schema.node("heading", { level }, [text(value)]);
const br = (): Node => schema.node("hardBreak");
export const image = (attrs: Record<string, unknown>): Node => schema.node("image", { src: "", ...attrs });
export const pageBreak = (): Node => schema.node("pageBreak");
export const sectionBreak = (breakType: string): Node =>
  schema.node("sectionBreak", { settings: { breakType, columns: { count: 1, gap: 24, equalWidth: true } } });
const item = (...blocks: Node[]): Node => schema.node("listItem", null, blocks);
const bullets = (...items: Node[]): Node => schema.node("bulletList", null, items);
const numbers = (...items: Node[]): Node => schema.node("orderedList", null, items);
export const cell = (...blocks: Node[]): Node => schema.node("tableCell", null, blocks);
export const row = (...cells: Node[]): Node => schema.node("tableRow", null, cells);
export const table = (...rows: Node[]): Node => schema.node("table", { grid: [200, 200] }, rows);
const some = (count: number, of: (i: number) => Node): Node[] => Array.from({ length: count }, (_, i) => of(i));

/** Every kind of block and break the engine lays out, with nothing floating. */
export const FLOWING: Record<string, Node> = {
  "one empty paragraph": doc(p()),
  "paragraphs over several pages": doc(...some(30, (i) => p(`${i} ${words(40)}`))),
  "one paragraph over several pages": doc(p(words(1500))),
  "headings and empty paragraphs": doc(...some(12, (i) => h(1 + (i % 6), `Heading ${i}`)), p(), p("text"), p(), p()),
  "hard breaks, leading, repeated and trailing": doc(p([br(), text("a"), br(), br(), text("b"), br()]), p([br()]), p("after")),
  "inline images of every height": doc(...some(8, (i) => p([text("before "), image({ width: 40, height: 10 + i * 30, wrapMode: "inline" }), text(` after ${words(20)}`)]))),
  "mixed sizes, over-long words and emoji": doc(p([text(words(10)), sized(" large words here ", 34), text("x".repeat(300)), text(" 👩‍👩‍👧‍👦".repeat(40))])),
  "first-line indents": doc(...some(6, () => p(words(60), { textIndent: 40 }))),
  "lists, nested and long": doc(bullets(...some(5, (i) => item(p(`${i} ${words(30)}`)))), numbers(item(p("one")), item(p("two"), bullets(item(p(words(30)))))), p("after")),
  "a table over several pages": doc(p("before"), table(...some(30, (i) => row(cell(p(`${i}`)), cell(p(words(1 + (i % 20))))))), p("after")),
  "a table in a cell": doc(table(row(cell(p("outer"), table(row(cell(p("inner")), cell(p(words(12)))))), cell(p("beside"))))),
  "page breaks": doc(p("one"), pageBreak(), p("two"), pageBreak(), pageBreak(), p("three")),
  "section breaks of every kind": doc(...["continuous", "nextPage", "evenPage", "oddPage"].flatMap((kind) => [p(`before ${kind}`), sectionBreak(kind)]), p("last")),
  "rules and code": doc(p("a"), schema.node("horizontalRule"), schema.node("codeBlock", null, [text("const a = 1;\nconst b = 2;")]), p("b")),
};

/** Floats of every wrap, beside text, over tables, across pages and reaching back. */
export const FLOATING: Record<string, Node> = {
  "a square float beside several paragraphs": doc(p([image({ wrapMode: "square", xAlign: "right", width: 200, height: 160 }), text(words(30))]), ...some(5, () => p(words(30)))),
  "a top-and-bottom float": doc(p(words(20)), p([text(words(10)), image({ wrapMode: "top-bottom", width: 200, height: 120 })]), p(words(60))),
  "behind and in front of the text": doc(p([text(words(20)), image({ wrapMode: "behind", width: 200, height: 200 })]), p([image({ wrapMode: "front", width: 100, height: 100 }), text(words(40))])),
  "two floats that meet": doc(p([image({ wrapMode: "square", xAlign: "left", width: 200, height: 200 }), image({ wrapMode: "square", xAlign: "left", width: 200, height: 100 }), text(words(150))])),
  "a float reaching back over the paragraph before": doc(p(words(60)), p(words(40)), p([text("anchor"), image({ wrapMode: "square", xAlign: "right", width: 200, height: 60, yOffset: -90 })]), p(words(30))),
  "a float beside a list": doc(bullets(...some(6, (i) => item(i === 0 ? p([text(words(20)), image({ wrapMode: "square", xAlign: "right", width: 220, height: 160 })]) : p(words(20)))))),
  "a float in a cell": doc(table(row(cell(p([image({ wrapMode: "square", xAlign: "left", width: 60, height: 80 }), text(words(20))])), cell(p("beside"))))),
  "a float before a table": doc(p([text("anchor"), image({ wrapMode: "square", xAlign: "right", width: 300, height: 140 })]), table(row(cell(p("a")), cell(p("b"))), row(cell(p("c")), cell(p("d")))), p("after")),
  "floats on every page": doc(...some(14, (i) => p([text(`${i} ${words(50)}`), ...(i % 3 === 0 ? [image({ wrapMode: "square", xAlign: i % 2 ? "left" : "right", width: 160, height: 90 })] : [])]))),
};

// ── Page set-ups ──────────────────────────────────────────────────────────────

const shortPage: PageConfig = { ...defaultPageConfig, pageHeight: 72 * 2 + 300 };

/**
 * Glyphs all half as wide as their size, so a test can say which line a word is
 * on: the same on every machine.
 */
export const fixedWidths: TextMeasurerLike = {
  measureWidth: (value, font) => value.length * (sizeOf(font) / 2),
  getFontMetrics: (font) => {
    const size = sizeOf(font);
    return { ascent: size * 0.8, descent: size * 0.2, lineHeight: size * 1.2, xHeight: size * 0.5 };
  },
  measureRun: (value, font) => {
    const step = sizeOf(font) / 2;
    return { totalWidth: value.length * step, charPositions: Array.from({ length: value.length }, (_, i) => i * step) };
  },
  invalidate: () => {},
};

function sizeOf(font: string): number {
  const size = /(\d+(?:\.\d+)?)px/.exec(font)?.[1];
  return size === undefined ? 16 : Number(size);
}

/** A page of 400px of content and fixed-width glyphs: what a test can say is on which page and line. */
export const SHORT_PAGE: Setup = { pageConfig: { ...defaultPageConfig, pageHeight: 72 * 2 + 400 }, measurer: fixedWidths };
export const SHORT_PAGE_TOP = 72;
export const SHORT_PAGE_BOTTOM = SHORT_PAGE_TOP + 400;

/** A header taller on the first page, and a footer: each page has its own room. */
const chrome: PageChromeContribution = {
  name: "oracle-chrome",
  measure: () => ({ topForPage: (page) => (page === 1 ? 60 : 20), bottomForPage: () => 30, stable: true }),
  render: () => {},
};

export const SETUPS: Record<string, Partial<PageLayoutOptions> & { pageConfig: PageConfig }> = {
  "A4 pages": { pageConfig: defaultPageConfig },
  "short pages": { pageConfig: shortPage },
  "pages with a header and footer": { pageConfig: shortPage, pageChromeContributions: [chrome] },
  "no pages": { pageConfig: defaultPagelessConfig },
};
export type Setup = (typeof SETUPS)[string];

// ── The ways to lay a document out ────────────────────────────────────────────

const optionsOf = (setup: Setup): PageLayoutOptions => ({ measurer, fontConfig, fontModifiers, ...setup });

export const whole = (node: Node, setup: Setup): DocumentLayout => runPipeline(node, optionsOf(setup));

const cachedOptions = (setup: Setup): PageLayoutOptions => ({ ...optionsOf(setup), measureCache: new WeakMap<Node, MeasureCacheEntry>() });

/** In chunks of `blocks`, as the editor streams a long document. */
export function streamed(node: Node, setup: Setup, blocks: number, options = cachedOptions(setup)): DocumentLayout {
  let layout = runPipeline(node, { ...options, maxBlocks: blocks });
  while (layout.isPartial) {
    if (!layout.resumption) throw new Error("a partial layout with nothing to resume from");
    layout = runPipeline(node, { ...options, maxBlocks: blocks, resumption: layout.resumption });
  }
  return layout;
}

/**
 * Each document on top of the last one's layout, as an editor lays out edits:
 * the first streamed, when `blocks` says in what chunks. Returns the last.
 */
export function inTurn(nodes: readonly Node[], setup: Setup, blocks?: number): DocumentLayout {
  const options = cachedOptions(setup);
  const [first, ...rest] = nodes;
  if (!first) throw new Error("no document to lay out");
  const opened = blocks === undefined ? runPipeline(first, options) : streamed(first, setup, blocks, options);
  return rest.reduce(
    (previousLayout, node) => runPipeline(node, { ...options, previousLayout, previousVersion: previousLayout.version }),
    opened,
  );
}

/** What an edit leaves, keeping every node the edit does not touch, as a transaction does. */
export function edit(node: Node, change: (tr: Transaction) => void): Node {
  const { tr } = EditorState.create({ doc: node });
  change(tr);
  return tr.doc;
}

const firstTextblock = (node: Node): number | null => {
  let at: number | null = null;
  node.descendants((child, pos) => {
    if (at === null && child.isTextblock) at = pos + 1;
    return at === null;
  });
  return at;
};

/** A top-level child's start, counted from either end of the document. */
const childAt = (node: Node, index: number): { pos: number; child: Node } | null => {
  const wanted = index < 0 ? node.childCount + index : index;
  if (wanted < 0 || wanted >= node.childCount) return null;
  let pos = 0;
  for (let i = 0; i < wanted; i++) pos += node.child(i).nodeSize;
  return { pos, child: node.child(wanted) };
};

const remove = (tr: Transaction, index: number): void => {
  const at = childAt(tr.doc, index);
  if (at && tr.doc.childCount > 1) tr.delete(at.pos, at.pos + at.child.nodeSize);
};

/** Edits a person makes, as a change to whatever document they are made in. */
export const EDITS: Record<string, (tr: Transaction) => void> = {
  "a letter typed": (tr) => {
    const at = firstTextblock(tr.doc);
    if (at !== null) tr.insertText("z", at);
  },
  "a paragraph added at the start": (tr) => tr.insert(0, p("added")),
  "a paragraph split": (tr) => {
    const at = firstTextblock(tr.doc);
    if (at !== null && tr.doc.resolve(at).depth === 1) tr.split(at);
  },
  "the first block deleted": (tr) => remove(tr, 0),
  "a block in the middle deleted": (tr) => remove(tr, Math.floor(tr.doc.childCount / 2)),
  "the last block deleted": (tr) => remove(tr, -1),
  "the last block moved to the start": (tr) => {
    const last = childAt(tr.doc, -1);
    if (!last || tr.doc.childCount < 2) return;
    tr.delete(last.pos, last.pos + last.child.nodeSize);
    tr.insert(0, last.child);
  },
};

// ── The comparison ────────────────────────────────────────────────────────────

const recordBlock = (block: LayoutBlock): unknown => ({
  kind: block.kind,
  type: block.blockType,
  nodePos: block.nodePos,
  sourceNodePos: block.sourceNodePos,
  x: block.x,
  y: block.y,
  width: block.width,
  height: block.height,
  spaceBefore: block.spaceBefore,
  spaceAfter: block.spaceAfter,
  align: block.align,
  continuation: block.isContinuation ?? false,
  continues: block.continuesOnNextPage ?? false,
  lastUnit: block.lastUnit ?? false,
  marker: block.marker ? { painter: block.marker.painter, x: block.marker.x } : null,
  lines: block.lines.map((line) => ({
    height: line.lineHeight,
    ascent: line.ascent,
    breakAt: line.terminalBreakDocPos,
    spans: line.spans.map((span) => ({ at: span.docPos, x: span.x, width: span.width, text: span.kind === "text" ? span.text : null })),
  })),
  regions: (block.regions ?? []).map((region) => ({
    pos: region.pos,
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
    blocks: region.blocks.map(recordBlock),
    floats: (region.floats ?? []).map((float) => ({ at: float.docPos, x: float.x, y: float.y, width: float.width, height: float.height })),
  })),
});

/** Where the caret can go and what a click finds, page by page. */
function recordCaret(layout: DocumentLayout, docSize: number, glyphs: TextMeasurerLike): unknown {
  const map = new CharacterMap();
  for (const page of layout.pages) {
    let line = 0;
    for (const block of page.blocks) {
      populateCharMap(block, map, page.pageNumber, line, glyphs);
      line += registeredLineCount(block);
    }
  }
  return { lines: map.linesInRange(-1, docSize + 1), glyphs: map.glyphsInRange(0, docSize + 1) };
}

/** Everything a layout decides, as data two layouts can be compared by. */
export function recordLayout(layout: DocumentLayout, docSize: number, glyphs: TextMeasurerLike = measurer): unknown {
  return {
    height: layout.totalContentHeight,
    pageStarts: layout.pageStarts,
    pages: layout.pages.map((page) => ({ page: page.pageNumber, blocks: page.blocks.map(recordBlock) })),
    fragments: (layout.fragments ?? []).map(({ fragmentIndex, fragmentCount, sourceNodePos, page, y, lineCount }) => ({ fragmentIndex, fragmentCount, sourceNodePos, page, y, lineCount })),
    floats: (layout.anchoredObjects ?? []).map(({ docPos, page, x, y, width, height, anchorPage, globalY }) => ({ docPos, page, x, y, width, height, anchorPage, globalY })),
    caret: recordCaret(layout, docSize, glyphs),
  };
}

/** Positions are sums of measured numbers, which agree to a millionth of a pixel and not to the last bit. */
const SAME = 1e-6;
const MAX_DIFFERENCES = 8;

/** Where two records differ, each as a path and both values. Empty when they agree. */
export function differences(actual: unknown, expected: unknown): string[] {
  const found: string[] = [];
  const visit = (a: unknown, e: unknown, path: string): void => {
    if (found.length >= MAX_DIFFERENCES) return;
    if (typeof a === "number" && typeof e === "number" && Math.abs(a - e) < SAME) return;
    if (Array.isArray(a) && Array.isArray(e)) {
      if (a.length !== e.length) found.push(`${path}.length: ${a.length} !== ${e.length}`);
      for (let i = 0; i < Math.min(a.length, e.length); i++) visit(a[i], e[i], `${path}[${i}]`);
      return;
    }
    if (isRecord(a) && isRecord(e)) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(e)])) visit(a[key], e[key], `${path}.${key}`);
      return;
    }
    if (a !== e) found.push(`${path}: ${String(a)} !== ${String(e)}`);
  };
  visit(actual, expected, "layout");
  return found;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Where `layout` differs from the document laid out whole. */
export const differencesFromWhole = (layout: DocumentLayout, node: Node, setup: Setup): string[] =>
  differences(
    recordLayout(layout, node.content.size, setup.measurer),
    recordLayout(whole(node, setup), node.content.size, setup.measurer),
  );

// ── Finding things in a layout ────────────────────────────────────────────────

export function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`no ${what}`);
  return value;
}

/** The parts of the block whose text starts with `start`, with the page each is on. */
export const partsOf = (layout: DocumentLayout, start: string): { page: number; block: LayoutBlock }[] =>
  layout.pages.flatMap((page) =>
    page.blocks.filter((block) => block.node.textContent.startsWith(start)).map((block) => ({ page: page.pageNumber, block })),
  );

/** The text of each of a block's lines that holds any. */
export const textLines = (block: LayoutBlock): string[] =>
  block.lines.filter((line) => line.spans.length > 0).map((line) => line.spans.map((span) => (span.kind === "text" ? span.text : "")).join(""));
