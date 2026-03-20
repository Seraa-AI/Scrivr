import { Node } from "prosemirror-model";
import { TextMeasurer } from "./TextMeasurer";
import { FontConfig, defaultFontConfig, getBlockStyle } from "./FontConfig";
import { layoutBlock, LayoutBlock } from "./BlockLayout";
import { layoutTable } from "./TableLayout";

export interface PageConfig {
  pageWidth: number;
  pageHeight: number;
  margins: { top: number; right: number; bottom: number; left: number };
}

export interface LayoutPage {
  pageNumber: number;
  blocks: LayoutBlock[];
}

export interface DocumentLayout {
  pages: LayoutPage[];
  pageConfig: PageConfig;
  /**
   * Increments on every layout run. PageRenderer checks this before drawing
   * to abort stale renders when the document changes mid-scroll.
   */
  version: number;
}

export interface PageLayoutOptions {
  pageConfig: PageConfig;
  measurer: TextMeasurer;
  fontConfig?: FontConfig;
  /**
   * Pass the previous version so callers can increment it.
   * Defaults to 1 on first layout.
   */
  previousVersion?: number;
  /** Optional font modifier map from the ExtensionManager. Enables extensions to declare font effects. */
  fontModifiers?: Map<string, import("../extensions/types").FontModifier>;
}

/** A4 at 96dpi with 1-inch margins */
export const defaultPageConfig: PageConfig = {
  pageWidth: 794,
  pageHeight: 1123,
  margins: { top: 72, right: 72, bottom: 72, left: 72 },
};

/**
 * layoutDocument — the top-level layout pass.
 *
 * Walks every block node in the ProseMirror doc, stacks them vertically,
 * detects page boundaries, and returns a fully positioned DocumentLayout.
 *
 * Does NOT touch the CharacterMap — that is the PageRenderer's responsibility.
 * This keeps layout pure: same inputs always produce the same output.
 *
 * Y coordinates in LayoutBlock are PAGE-LOCAL (0 = page top edge).
 * Each page's canvas starts at (0,0), so renderers use these directly.
 */
export function layoutDocument(
  doc: Node,
  options: PageLayoutOptions
): DocumentLayout {
  const { pageConfig, measurer } = options;
  const fontConfig = options.fontConfig ?? defaultFontConfig;
  const { fontModifiers } = options;
  const version = (options.previousVersion ?? 0) + 1;

  const { pageWidth, pageHeight, margins } = pageConfig;
  const contentWidth = pageWidth - margins.left - margins.right;
  const contentHeight = pageHeight - margins.top - margins.bottom;

  const pages: LayoutPage[] = [];
  let currentPage: LayoutPage = { pageNumber: 1, blocks: [] };
  let y = margins.top;
  let prevSpaceAfter = 0;

  /**
   * Collect the flat sequence of layoutable items from the doc.
   * List container nodes (bulletList, orderedList) are expanded into their
   * individual list item paragraphs so each item is a separate LayoutBlock.
   */
  const items = collectLayoutItems(doc, fontConfig);

  for (const item of items) {
    // ── Hard page break ──────────────────────────────────────────────────────
    if (item.isPageBreak) {
      pages.push(currentPage);
      currentPage = newPage(pages.length + 1);
      y = margins.top;
      prevSpaceAfter = 0;
      continue;
    }

    const { node, nodePos, listMarker, indentLeft } = item;

    // ── Margin collapsing ────────────────────────────────────────────────────
    const level = node.attrs["level"] as number | undefined;
    const blockStyle = getBlockStyle(fontConfig, node.type.name, level);
    const isFirstOnPage = currentPage.blocks.length === 0;
    const gap = isFirstOnPage
      ? 0
      : collapseMargins(prevSpaceAfter, blockStyle.spaceBefore);

    const targetY = y + gap;
    const blockX = margins.left + indentLeft;
    const blockWidth = contentWidth - indentLeft;

    // ── Measure block (no CharacterMap — just dimensions) ────────────────────
    const block = node.type.name === "table"
      ? layoutTable(node, {
          nodePos,
          x: blockX,
          y: targetY,
          availableWidth: blockWidth,
          page: currentPage.pageNumber,
          measurer,
          fontConfig,
          ...(fontModifiers ? { fontModifiers } : {}),
        })
      : layoutBlock(node, {
          nodePos,
          x: blockX,
          y: targetY,
          availableWidth: blockWidth,
          page: currentPage.pageNumber,
          measurer,
          fontConfig,
          ...(fontModifiers ? { fontModifiers } : {}),
          // map intentionally omitted — PageRenderer populates it
        });

    if (listMarker !== undefined) {
      const markerX = blockX - MARKER_RIGHT_GAP;
      block.listMarker = listMarker;
      block.listMarkerX = markerX;
      block.blockType = "list_item";
    }

    // ── Page overflow check ───────────────────────────────────────────────────
    const blockBottom = targetY + block.height;
    const pageBottom = margins.top + contentHeight;
    const overflows = blockBottom > pageBottom && !isFirstOnPage;
    const tooTallForAnyPage = block.height > contentHeight;

    if (overflows && !tooTallForAnyPage) {
      // ── Move to next page ──────────────────────────────────────────────────
      pages.push(currentPage);
      currentPage = newPage(pages.length + 1);
      y = margins.top;
      prevSpaceAfter = 0;

      const reflow = node.type.name === "table"
        ? layoutTable(node, {
            nodePos,
            x: blockX,
            y: margins.top,
            availableWidth: blockWidth,
            page: currentPage.pageNumber,
            measurer,
            fontConfig,
            ...(fontModifiers ? { fontModifiers } : {}),
          })
        : layoutBlock(node, {
            nodePos,
            x: blockX,
            y: margins.top,
            availableWidth: blockWidth,
            page: currentPage.pageNumber,
            measurer,
            fontConfig,
            ...(fontModifiers ? { fontModifiers } : {}),
          });

      if (listMarker !== undefined) {
        reflow.listMarker = listMarker;
        reflow.listMarkerX = blockX - MARKER_RIGHT_GAP;
        reflow.blockType = "list_item";
      }

      currentPage.blocks.push(reflow);
      y = margins.top + reflow.height;
      prevSpaceAfter = reflow.spaceAfter;
    } else {
      // ── Place on current page ──────────────────────────────────────────────
      currentPage.blocks.push(block);
      y = targetY + block.height;
      prevSpaceAfter = block.spaceAfter;
    }
  }

  // Flush last page (always — even if empty, so there's at least one page)
  pages.push(currentPage);

  return { pages, pageConfig, version };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function newPage(pageNumber: number): LayoutPage {
  return { pageNumber, blocks: [] };
}

/** A single item ready for layout — either a plain block or an expanded list item. */
interface LayoutItem {
  isPageBreak?: true;
  node: Node;
  nodePos: number;
  /** Extra left indent in px (0 for regular blocks, LIST_INDENT for list items). */
  indentLeft: number;
  /** Bullet character or ordered number, e.g. "•" or "1.". Undefined for non-list blocks. */
  listMarker?: string;
}

const LIST_INDENT = 24;  // px — text starts this far right of the margin
const MARKER_RIGHT_GAP = 6;  // px — gap between the marker's right edge and the text

/**
 * Walks the doc's top-level children and returns a flat array of layout items.
 * List container nodes (bulletList, orderedList) are expanded into one item
 * per list item so each renders as an independent LayoutBlock.
 */
function collectLayoutItems(doc: Node, _fontConfig: FontConfig): LayoutItem[] {
  const items: LayoutItem[] = [];

  doc.forEach((node, offset) => {
    if (node.type.name === "page_break") {
      items.push({ isPageBreak: true, node, nodePos: offset, indentLeft: 0 });
      return;
    }

    if (node.type.name === "bulletList" || node.type.name === "orderedList") {
      const isBullet = node.type.name === "bulletList";
      let itemIndex = node.attrs["order"] as number ?? 1;

      node.forEach((listItem, liOffset) => {
        // nodePos of the paragraph inside this listItem:
        // offset (before bulletList) + 1 (into bulletList) + liOffset (before listItem) + 1 (into listItem)
        const paraNodePos = offset + 1 + liOffset + 1;
        const para = listItem.firstChild;
        if (!para) return;

        const marker = isBullet ? "•" : `${itemIndex}.`;

        items.push({
          node: para,
          nodePos: paraNodePos,
          indentLeft: LIST_INDENT,
          listMarker: marker,
        });

        itemIndex++;
      });
      return;
    }

    items.push({ node, nodePos: offset, indentLeft: 0 });
  });

  return items;
}

/**
 * CSS-style margin collapsing.
 * The gap between two adjacent blocks is the larger of their margins, not the sum.
 */
export function collapseMargins(spaceAfter: number, spaceBefore: number): number {
  return Math.max(spaceAfter, spaceBefore);
}
