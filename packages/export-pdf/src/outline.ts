import {
  PDFHexString,
  PDFName,
  PDFNumber,
  type PDFArray,
  type PDFDocument,
  type PDFRef,
} from "pdf-lib";
import type { DocumentLayout, LayoutBlock, PdfOutlineLevel } from "@scrivr/core";
import { PT_PER_PX } from "./context";

/**
 * Bookmarks, built from the blocks whose extensions declare an outline level.
 *
 * A reader opening a twelve-page agreement has no way through it but scrolling
 * unless the file carries an outline. Titles already say where the parts
 * begin and how they nest, so the structure is read off the laid-out document
 * rather than asked for separately.
 *
 * Must run after every page has been added: each bookmark's destination names
 * the page object it jumps to.
 */
export function addOutline(
  pdfDoc: PDFDocument,
  layout: DocumentLayout,
  levels: ReadonlyMap<string, PdfOutlineLevel>,
): void {
  const entries = collectEntries(layout, levels);
  const tree = nest(entries);
  const first = tree.roots[0];
  const last = tree.roots[tree.roots.length - 1];
  if (first === undefined || last === undefined) return;

  const context = pdfDoc.context;
  // Every reference is reserved before any dictionary is written, because an
  // item names its parent and both its siblings.
  const outlinesRef = context.nextRef();
  const refs = entries.map(() => context.nextRef());
  const refAt = (index: number): PDFRef => refs[index] ?? outlinesRef;

  entries.forEach((entry, index) => {
    const parent = tree.parentOf.get(index);
    const siblings = parent === undefined ? tree.roots : tree.childrenOf.get(parent) ?? [];
    const position = siblings.indexOf(index);
    const children = tree.childrenOf.get(index) ?? [];

    const item: Record<string, PDFHexString | PDFNumber | PDFRef | PDFArray> = {
      Title: PDFHexString.fromText(entry.title),
      Parent: parent === undefined ? outlinesRef : refAt(parent),
      Dest: destination(pdfDoc, entry),
    };
    const prev = siblings[position - 1];
    const next = siblings[position + 1];
    if (prev !== undefined) item["Prev"] = refAt(prev);
    if (next !== undefined) item["Next"] = refAt(next);
    const firstChild = children[0];
    const lastChild = children[children.length - 1];
    if (firstChild !== undefined && lastChild !== undefined) {
      item["First"] = refAt(firstChild);
      item["Last"] = refAt(lastChild);
      // Every branch starts closed. Opening this item reveals its immediate
      // children only; grandchildren remain hidden behind closed children.
      // PDF Count describes that visible set, not the size of the subtree.
      item["Count"] = PDFNumber.of(-children.length);
    }
    context.assign(refAt(index), context.obj(item));
  });

  context.assign(
    outlinesRef,
    context.obj({
      Type: "Outlines",
      First: refAt(first),
      Last: refAt(last),
      Count: PDFNumber.of(tree.roots.length),
    }),
  );
  pdfDoc.catalog.set(PDFName.of("Outlines"), outlinesRef);
}

/** `[page /XYZ left top zoom]` — jump to the entry's own line, keeping the zoom. */
function destination(pdfDoc: PDFDocument, entry: OutlineEntry): PDFArray {
  return pdfDoc.context.obj([
    pdfDoc.getPage(entry.pageIndex).ref,
    PDFName.of("XYZ"),
    PDFNumber.of(0),
    PDFNumber.of(entry.topPt),
    pdfDoc.context.obj(null),
  ]);
}

/**
 * Entries are a flat list carrying a level; a bookmark tree needs the nesting
 * that implies. An entry belongs under the nearest preceding one of a smaller
 * level, and a document that opens at level 2 or skips a level still nests
 * sensibly because only relative order is used.
 */
function nest(entries: readonly OutlineEntry[]) {
  const roots: number[] = [];
  const childrenOf = new Map<number, number[]>();
  const parentOf = new Map<number, number>();
  const ancestors: { index: number; level: number }[] = [];

  entries.forEach((entry, index) => {
    let parent = ancestors[ancestors.length - 1];
    while (parent && parent.level >= entry.level) {
      ancestors.pop();
      parent = ancestors[ancestors.length - 1];
    }
    if (parent === undefined) {
      roots.push(index);
    } else {
      parentOf.set(index, parent.index);
      childrenOf.set(parent.index, [...(childrenOf.get(parent.index) ?? []), index]);
    }
    ancestors.push({ index, level: entry.level });
  });

  return { roots, childrenOf, parentOf };
}

interface OutlineEntry {
  title: string;
  level: number;
  pageIndex: number;
  /** Distance from the page's bottom edge, which is where a PDF measures from. */
  topPt: number;
}

function collectEntries(layout: DocumentLayout, levels: ReadonlyMap<string, PdfOutlineLevel>): OutlineEntry[] {
  const pageHeightPt = layout.pageConfig.pageHeight * PT_PER_PX;
  const entries: OutlineEntry[] = [];
  const visit = (blocks: readonly LayoutBlock[], pageIndex: number, originY: number): void => {
    for (const block of blocks) {
      const pageY = originY + block.y;
      // Pagination repeats the source node in every visual fragment. Only
      // its first fragment owns a bookmark; equal titles in distinct source
      // blocks must remain distinct entries.
      const entry = block.isContinuation ? null : entryOf(block, levels);
      if (entry) {
        entries.push({ ...entry, pageIndex, topPt: pageHeightPt - pageY * PT_PER_PX });
      }
      // Cell blocks store y relative to their row, including cell padding,
      // exactly as the table PDF renderer consumes them. Keep document order
      // through cells and carry the row origin into each nested traversal.
      for (const cell of block.cells ?? []) visit(cell.blocks, pageIndex, pageY);
    }
  };
  layout.pages.forEach((page, pageIndex) => visit(page.blocks, pageIndex, 0));
  return entries;
}

function entryOf(block: LayoutBlock, levels: ReadonlyMap<string, PdfOutlineLevel>): { title: string; level: number } | null {
  const level = levels.get(block.node.type.name)?.(block.node);
  if (level === undefined || level === null) return null;
  const title = block.node.textContent.trim();
  return title ? { title, level } : null;
}
