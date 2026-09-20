import {
  PDFHexString,
  PDFName,
  PDFNumber,
  type PDFArray,
  type PDFDocument,
  type PDFRef,
} from "pdf-lib";
import type { DocumentLayout, LayoutBlock } from "@scrivr/core";
import { PT_PER_PX } from "./context";

/**
 * Bookmarks, built from the document's headings.
 *
 * A reader opening a twelve-page agreement has no way through it but scrolling
 * unless the file carries an outline. Headings already say where the parts
 * begin and how they nest, so the structure is read off the laid-out document
 * rather than asked for separately.
 *
 * Must run after every page has been added: each bookmark's destination names
 * the page object it jumps to.
 */
export function addHeadingOutline(pdfDoc: PDFDocument, layout: DocumentLayout): void {
  const headings = collectHeadings(layout);
  if (headings.length === 0) return;

  const context = pdfDoc.context;
  // Every reference is reserved before any dictionary is written, because an
  // item names its parent and both its siblings.
  const outlinesRef = context.nextRef();
  const refs = headings.map(() => context.nextRef());
  const tree = nest(headings);

  headings.forEach((heading, index) => {
    const parent = tree.parentOf.get(index);
    const siblings = parent === undefined ? tree.roots : tree.childrenOf.get(parent) ?? [];
    const position = siblings.indexOf(index);
    const children = tree.childrenOf.get(index) ?? [];

    const item: Record<string, PDFHexString | PDFNumber | PDFRef | PDFArray> = {
      Title: PDFHexString.fromText(heading.title),
      Parent: parent === undefined ? outlinesRef : refs[parent]!,
      Dest: destination(pdfDoc, heading),
    };
    if (position > 0) item["Prev"] = refs[siblings[position - 1]!]!;
    if (position < siblings.length - 1) item["Next"] = refs[siblings[position + 1]!]!;
    if (children.length > 0) {
      item["First"] = refs[children[0]!]!;
      item["Last"] = refs[children[children.length - 1]!]!;
      // Negative so the node starts closed: a long agreement should open as
      // its top-level sections, not as every clause at once.
      item["Count"] = PDFNumber.of(-countDescendants(index, tree.childrenOf));
    }
    context.assign(refs[index]!, context.obj(item));
  });

  context.assign(
    outlinesRef,
    context.obj({
      Type: "Outlines",
      First: refs[tree.roots[0]!]!,
      Last: refs[tree.roots[tree.roots.length - 1]!]!,
      Count: PDFNumber.of(tree.roots.length),
    }),
  );
  pdfDoc.catalog.set(PDFName.of("Outlines"), outlinesRef);
}

/** `[page /XYZ left top zoom]` — jump to the heading's own line, keeping the zoom. */
function destination(pdfDoc: PDFDocument, heading: OutlineHeading): PDFArray {
  return pdfDoc.context.obj([
    pdfDoc.getPage(heading.pageIndex).ref,
    PDFName.of("XYZ"),
    PDFNumber.of(0),
    PDFNumber.of(heading.topPt),
    pdfDoc.context.obj(null),
  ]);
}

/**
 * Headings are a flat list carrying a level; a bookmark tree needs the nesting
 * that implies. A heading belongs under the nearest preceding one of a smaller
 * level, and a document that opens at `h2` or skips a level still nests
 * sensibly because only relative order is used.
 */
function nest(headings: readonly OutlineHeading[]) {
  const roots: number[] = [];
  const childrenOf = new Map<number, number[]>();
  const parentOf = new Map<number, number>();
  const ancestors: number[] = [];

  headings.forEach((heading, index) => {
    while (ancestors.length > 0 && headings[ancestors[ancestors.length - 1]!]!.level >= heading.level) {
      ancestors.pop();
    }
    const parent = ancestors[ancestors.length - 1];
    if (parent === undefined) {
      roots.push(index);
    } else {
      parentOf.set(index, parent);
      childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), index]);
    }
    ancestors.push(index);
  });

  return { roots, childrenOf, parentOf };
}

function countDescendants(index: number, childrenOf: Map<number, number[]>): number {
  const children = childrenOf.get(index) ?? [];
  return children.reduce((total, child) => total + 1 + countDescendants(child, childrenOf), 0);
}

interface OutlineHeading {
  title: string;
  level: number;
  pageIndex: number;
  /** Distance from the page's bottom edge, which is where a PDF measures from. */
  topPt: number;
}

function collectHeadings(layout: DocumentLayout): OutlineHeading[] {
  const pageHeightPt = layout.pageConfig.pageHeight * PT_PER_PX;
  const headings: OutlineHeading[] = [];
  layout.pages.forEach((page, pageIndex) => {
    for (const block of page.blocks) {
      const heading = headingOf(block);
      if (heading) headings.push({ ...heading, pageIndex, topPt: pageHeightPt - block.y * PT_PER_PX });
    }
  });
  return headings;
}

function headingOf(block: LayoutBlock): { title: string; level: number } | null {
  if (block.node.type.name !== "heading") return null;
  const title = block.node.textContent.trim();
  if (!title) return null;
  const level = block.node.attrs["level"];
  return { title, level: typeof level === "number" ? level : 1 };
}
