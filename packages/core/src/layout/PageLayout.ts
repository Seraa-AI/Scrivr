import { Node } from "prosemirror-model";
import type { FontModifier } from "../extensions/types";
import { TextMeasurer } from "./TextMeasurer";
import {
  FontConfig,
  defaultFontConfig,
  getBlockStyle,
  BlockStyle,
  applyPageFont,
} from "./FontConfig";
import { layoutBlock, LayoutBlock } from "./BlockLayout";
import type { LayoutLine } from "./LineBreaker";

export interface PageConfig {
  pageWidth: number;
  pageHeight: number;
  margins: { top: number; right: number; bottom: number; left: number };
  /**
   * Document-level default font family (e.g. "Georgia, serif" or "Inter, sans-serif").
   * When set, overrides the font family in every block style — paragraph, headings, etc.
   * Font sizes and weights defined by each block style are preserved.
   * Absent = use whatever family is declared in each block style.
   */
  fontFamily?: string;
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
  /**
   * True when the layout was stopped early via `maxBlocks`. The pages
   * present are correct; blocks beyond the cutoff have not been measured.
   * Editor schedules a background pass to complete the layout.
   */
  isPartial?: boolean;
  /**
   * Saved cursor state for O(N) incremental chunked layout.
   * Present when isPartial:true. Pass back via PageLayoutOptions.resumption
   * to continue exactly where this run stopped — avoids O(N²) re-iteration.
   */
  resumption?: LayoutResumption;
}

/**
 * Saved cursor state from a partial layout pass.
 * Returned with isPartial:true; passed back as PageLayoutOptions.resumption
 * to resume from the exact item where the previous chunk stopped.
 */
export interface LayoutResumption {
  /** The flat item list — cached to avoid re-walking the doc. */
  items: LayoutItem[];
  /** Index of the first item that was NOT yet processed. */
  nextItemIndex: number;
  /** Pages completely finished by previous chunks. */
  completedPages: LayoutPage[];
  /** The page currently being built (may have partial blocks). */
  currentPage: LayoutPage;
  /** Y cursor position on currentPage. */
  currentY: number;
  /** spaceAfter of the last placed block, for margin collapsing. */
  prevSpaceAfter: number;
  /** Layout version carried through all chunks. */
  version: number;
}

/**
 * Cached measurement result for a single block node.
 * Keyed by Node reference in a WeakMap — ProseMirror's structural sharing
 * guarantees that unchanged nodes keep the same JS object identity across
 * transactions, so pointer equality is a perfect cache key.
 *
 * All fields are position-independent: LayoutLine x-coordinates are relative
 * to the line origin, not the page. The cached entry is valid as long as
 * availableWidth matches (invalidated if margins change).
 */
export interface MeasureCacheEntry {
  /** Content width the block was measured at — invalidates entry if margins change */
  availableWidth: number;
  /**
   * The nodePos at which these lines were last measured. Span docPos values
   * are absolute and must be adjusted when the block shifts in the document.
   */
  nodePos: number;
  height: number;
  lines: LayoutLine[];
  spaceBefore: number;
  spaceAfter: number;
  blockType: string;
  align: BlockStyle["align"];
  /**
   * Phase 1b — early termination.
   *
   * The targetY (y + gap, page-local, BEFORE overflow) and page number where
   * this block was last placed. If the current run arrives at the same values,
   * all downstream blocks are guaranteed to be identical to `previousLayout`
   * and the loop can exit early.
   *
   * Undefined on first layout (cache entries have no placement history yet).
   */
  placedTargetY?: number;
  placedPage?: number;
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
  fontModifiers?: Map<string, FontModifier>;
  /**
   * Block measurement cache keyed by Node reference.
   * When provided, unchanged blocks (same ProseMirror Node object) skip the
   * layoutBlock call entirely — O(1) cache hit instead of O(chars) re-measure.
   * The Editor owns this WeakMap and passes it on every layoutDocument call.
   */
  measureCache?: WeakMap<Node, MeasureCacheEntry>;
  /**
   * Phase 1b — early termination.
   *
   * Pass the layout produced by the immediately preceding run. When the loop
   * finds a cache-hit block at an identical (targetY, page) as last time, all
   * downstream blocks are guaranteed unchanged — remaining pages are copied
   * from this layout instead of re-iterating.
   */
  previousLayout?: DocumentLayout;
  /**
   * Streaming layout — stop after measuring this many blocks and return
   * a partial layout (`isPartial: true`). The Editor uses this to show the
   * first visible pages immediately, then completes the rest via
   * requestIdleCallback so the browser can paint without blocking.
   *
   * When undefined the full document is always laid out in one pass.
   */
  maxBlocks?: number;
  /**
   * Resume a chunked layout pass from a previous partial result.
   * When provided, skips collectLayoutItems() and starts directly from
   * resumption.nextItemIndex with the saved page/Y cursor state.
   * Makes each chunk O(chunkSize) instead of O(totalBlocks) — total O(N).
   */
  resumption?: LayoutResumption;
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
  options: PageLayoutOptions,
): DocumentLayout {
  // Destructured once — avoids repeated property access inside the hot loop.
  const { fontModifiers, measureCache, previousLayout,pageConfig, measurer } = options;
  const version = (options.previousVersion ?? 0) + 1;
  const baseConfig = options.fontConfig ?? defaultFontConfig;
  const fontConfig = pageConfig.fontFamily
    ? applyPageFont(baseConfig, pageConfig.fontFamily)
    : baseConfig;

  const { pageWidth, pageHeight, margins } = pageConfig;
  const contentWidth = pageWidth - margins.left - margins.right;
  const contentHeight = pageHeight - margins.top - margins.bottom;
  const maxBlocks = options.maxBlocks;

  // ── Resumption support: O(N) incremental chunked layout ───────────────────
  // When resumption is provided, restore the cursor state from the previous
  // chunk rather than re-iterating already-processed blocks. The items array
  // is cached in the resumption object so collectLayoutItems() is only called
  // on the first chunk.
  const r = options.resumption;
  const items = r ? r.items : collectLayoutItems(doc, fontConfig);
  const startIndex = r ? r.nextItemIndex : 0;

  // Restore page cursor from previous chunk, or start fresh.
  const pages: LayoutPage[] = r ? r.completedPages : [];
  let currentPage: LayoutPage = r ? r.currentPage : { pageNumber: 1, blocks: [] };
  let y = r ? r.currentY : margins.top;
  let prevSpaceAfter = r ? r.prevSpaceAfter : 0;
  const chunkVersion = r ? r.version : version;

  // Phase 1b: early termination is only valid after we've seen at least one
  // cache miss. A miss means the node was modified (ProseMirror creates a new
  // Node object on every change). Until we've passed the edit point, cache
  // hits might be UPSTREAM of the change and their placement in previousLayout
  // may still be correct even though downstream blocks have changed.
  let seenCacheMiss = false;
  let processedBlocks = 0;

  for (let itemIdx = startIndex; itemIdx < items.length; itemIdx++) {
    const item = items[itemIdx]!;
    // ── Hard page break ──────────────────────────────────────────────────────
    if (item.isPageBreak) {
      pages.push(currentPage);
      currentPage = newPage(pages.length + 1);
      y = margins.top;
      prevSpaceAfter = 0;
      continue;
    }

    // ── Streaming layout cutoff ───────────────────────────────────────────────
    // Stop here when maxBlocks is set (initial load optimisation). Save the
    // cursor state as LayoutResumption so the next chunk can continue in O(N)
    // without re-iterating already-processed blocks.
    if (maxBlocks !== undefined && processedBlocks >= maxBlocks) {
      // Don't push currentPage yet — the next chunk will continue adding to it.
      const resumption: LayoutResumption = {
        items,
        nextItemIndex: itemIdx,
        completedPages: pages,
        currentPage: { ...currentPage, blocks: [...currentPage.blocks] },
        currentY: y,
        prevSpaceAfter,
        version: chunkVersion,
      };
      return { pages: [...pages, currentPage], pageConfig, version: chunkVersion, isPartial: true, resumption };
    }

    const { node, nodePos, listMarker, indentLeft, styleKey } = item;

    // ── Margin collapsing ────────────────────────────────────────────────────
    // Use styleKey when set (e.g. "list_item") so list item spacing comes from
    // the list_item block style rather than the inner paragraph style.
    const level = node.attrs["level"] as number | undefined;
    const blockStyle = getBlockStyle(
      fontConfig,
      styleKey ?? node.type.name,
      level,
    );
    const isFirstOnPage = currentPage.blocks.length === 0;
    const gap = isFirstOnPage
      ? 0
      : collapseMargins(prevSpaceAfter, blockStyle.spaceBefore);

    const targetY = y + gap;
    const blockX = margins.left + indentLeft;
    const blockWidth = contentWidth - indentLeft;

    // ── Phase 1b: peek at cache BEFORE resolving, to track hit/delta/placement ──
    const preCached = measureCache?.get(node);
    const isHit = preCached !== undefined && preCached.availableWidth === blockWidth;
    const prevNodePos = preCached?.nodePos;
    const preCachedTargetY = preCached?.placedTargetY;
    const preCachedPage = preCached?.placedPage;

    if (!isHit) seenCacheMiss = true;

    // ── Measure block (cache-first; no CharacterMap — just dimensions) ────────
    const entry = resolveBlockEntry(
      node,
      nodePos,
      blockX,
      targetY,
      blockWidth,
      currentPage.pageNumber,
      measurer,
      fontConfig,
      fontModifiers,
      measureCache,
    );

    // Build a positioned LayoutBlock from the (possibly cached) measurements.
    // Extracted so both the normal-placement and reflow paths share it.
    const buildBlock = (x: number, y: number): LayoutBlock => ({
      node,
      nodePos,
      x,
      y,
      width: blockWidth,
      height: entry.height,
      lines: entry.lines,
      spaceBefore: entry.spaceBefore,
      spaceAfter: entry.spaceAfter,
      blockType: entry.blockType,
      align: entry.align,
      availableWidth: blockWidth,
    });

    const block = buildBlock(blockX, targetY);

    if (listMarker !== undefined) {
      block.listMarker = listMarker;
      block.listMarkerX = blockX - MARKER_RIGHT_GAP;
      block.blockType = "list_item";
    }

    // ── Page overflow check ───────────────────────────────────────────────────
    const blockBottom = targetY + entry.height;
    const pageBottom = margins.top + contentHeight;
    const overflows = blockBottom > pageBottom && !isFirstOnPage;
    const tooTallForAnyPage = entry.height > contentHeight;

    if (overflows && !tooTallForAnyPage) {
      // ── Move to next page ──────────────────────────────────────────────────
      // The reflow block uses the same cached measurements; only y changes.
      pages.push(currentPage);
      currentPage = newPage(pages.length + 1);
      y = margins.top;
      prevSpaceAfter = 0;

      const reflow = buildBlock(blockX, margins.top);

      if (listMarker !== undefined) {
        reflow.listMarker = listMarker;
        reflow.listMarkerX = blockX - MARKER_RIGHT_GAP;
        reflow.blockType = "list_item";
      }

      currentPage.blocks.push(reflow);
      y = margins.top + entry.height;
      // Use styleKey-resolved spaceAfter so list items use list_item spacing, not paragraph spacing
      prevSpaceAfter = blockStyle.spaceAfter;
    } else {
      // ── Place on current page ──────────────────────────────────────────────
      currentPage.blocks.push(block);
      y = targetY + entry.height;
      // Use styleKey-resolved spaceAfter so list items use list_item spacing, not paragraph spacing
      prevSpaceAfter = blockStyle.spaceAfter;
    }

    processedBlocks++;

    // ── Update placement tracking in cache ────────────────────────────────────
    entry.placedTargetY = targetY;
    entry.placedPage = currentPage.pageNumber;

    // ── Phase 1b: early termination ───────────────────────────────────────────
    // If this block is a cache hit and landed at the exact same (targetY, page)
    // as the previous layout run, every downstream block is guaranteed identical.
    // Copy remaining pages from previousLayout and exit the loop early.
    if (
      previousLayout &&
      seenCacheMiss &&
      isHit &&
      preCachedTargetY !== undefined &&
      preCachedPage !== undefined &&
      targetY === preCachedTargetY &&
      currentPage.pageNumber === preCachedPage
    ) {
      // delta: how much all subsequent blocks' nodePos has shifted this run.
      // Uniform for everything after the edit point.
      const delta = prevNodePos !== undefined ? nodePos - prevNodePos : 0;
      const prevPages = previousLayout.pages;
      const curPageIdx = currentPage.pageNumber - 1;

      if (curPageIdx < prevPages.length) {
        const prevCurPage = prevPages[curPageIdx]!;
        // Find this block in previousLayout by its pre-delta nodePos.
        const oldNodePos = nodePos - delta;
        const triggerIdx = prevCurPage.blocks.findIndex(
          (b) => b.nodePos === oldNodePos,
        );

        if (triggerIdx >= 0) {
          // Append remaining blocks on the current page from previousLayout.
          for (let bi = triggerIdx + 1; bi < prevCurPage.blocks.length; bi++) {
            currentPage.blocks.push(
              shiftBlock(prevCurPage.blocks[bi]!, delta, measureCache),
            );
          }
          pages.push(currentPage);

          // Append all subsequent pages.
          for (let pi = curPageIdx + 1; pi < prevPages.length; pi++) {
            const prevPage = prevPages[pi]!;
            pages.push({
              pageNumber: prevPage.pageNumber,
              blocks: prevPage.blocks.map((b) =>
                shiftBlock(b, delta, measureCache),
              ),
            });
          }

          return { pages, pageConfig, version: chunkVersion };
        }
      }
    }
  }

  // Flush last page (always — even if empty, so there's at least one page)
  pages.push(currentPage);

  return { pages, pageConfig, version: chunkVersion };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function newPage(pageNumber: number): LayoutPage {
  return { pageNumber, blocks: [] };
}

/**
 * Returns a LayoutBlock with nodePos and span docPos values shifted by `delta`.
 * Used by the Phase 1b early-termination path when copying blocks from
 * `previousLayout` that haven't passed through the main loop this run.
 *
 * When `delta === 0` the original block is returned unchanged (no allocation).
 *
 * Also updates the measureCache entry for the block so the next layout run
 * sees a correct nodePos and avoids redundant adjustment.
 */
function shiftBlock(
  block: LayoutBlock,
  delta: number,
  measureCache: WeakMap<Node, MeasureCacheEntry> | undefined,
): LayoutBlock {
  if (delta === 0) return block;

  const adjustedLines = block.lines.map((line) => ({
    ...line,
    spans: line.spans.map((span) => ({ ...span, docPos: span.docPos + delta })),
  }));

  const shifted: LayoutBlock = {
    ...block,
    nodePos: block.nodePos + delta,
    lines: adjustedLines,
  };

  // Propagate the correction into the cache so the next run's resolveBlockEntry
  // sees delta === 0 and skips the per-span adjustment.
  if (measureCache) {
    const cached = measureCache.get(block.node);
    if (cached) {
      // Keep placedTargetY / placedPage intact — they reflect the correct
      // placement positions from the previous run and are still valid.
      measureCache.set(block.node, {
        ...cached,
        nodePos: cached.nodePos + delta,
        lines: adjustedLines,
      });
    }
  }

  return shifted;
}

/** A single item ready for layout — either a plain block or an expanded list item. */
export interface LayoutItem {
  isPageBreak?: true;
  node: Node;
  nodePos: number;
  /** Extra left indent in px (0 for regular blocks, LIST_INDENT for list items). */
  indentLeft: number;
  /** Bullet character or ordered number, e.g. "•" or "1.". Undefined for non-list blocks. */
  listMarker?: string;
  /**
   * Override the FontConfig key used for block-style lookup.
   * List items lay out their inner `paragraph` node but should use the
   * `list_item` spacing defined in addBlockStyles(), not the paragraph style.
   */
  styleKey?: string;
}

const LIST_INDENT = 24; // px — text starts this far right of the margin
const MARKER_RIGHT_GAP = 6; // px — gap between the marker's right edge and the text

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
      let itemIndex = (node.attrs["order"] as number) ?? 1;

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
          styleKey: "list_item",
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
 * Returns a `MeasureCacheEntry` for the given node, either from the cache or
 * by calling `layoutBlock` once and writing the result back.
 *
 * Centralises all cache read/write logic so the main layout loop stays clean.
 *
 * LayoutLine x-coordinates are relative to the line origin — position-independent.
 * However, LayoutSpan.docPos values are absolute ProseMirror positions. Because
 * ProseMirror's structural sharing keeps the same Node reference for unchanged
 * blocks even when text is inserted/deleted before them, a cached entry's docPos
 * values can become stale. We fix this by storing the nodePos at measure-time and
 * adjusting span docPos values by the delta on every cache hit.
 */
function resolveBlockEntry(
  node: Node,
  nodePos: number,
  blockX: number,
  targetY: number,
  blockWidth: number,
  pageNumber: number,
  measurer: TextMeasurer,
  fontConfig: FontConfig,
  fontModifiers: Map<string, FontModifier> | undefined,
  measureCache: WeakMap<Node, MeasureCacheEntry> | undefined,
): MeasureCacheEntry {
  const cached = measureCache?.get(node);
  if (cached && cached.availableWidth === blockWidth) {
    const delta = nodePos - cached.nodePos;
    if (!delta) return cached;

    // Block shifted in the document (text inserted/deleted before it).
    // Adjust all span docPos values and update the cache entry.
    const adjustedLines = cached.lines.map((line) => ({
      ...line,
      spans: line.spans.map((span) => ({ ...span, docPos: span.docPos + delta })),
    }));
    const updated: MeasureCacheEntry = { ...cached, nodePos, lines: adjustedLines };
    measureCache!.set(node, updated);
    return updated;
  }

  // Cache miss — measure and populate. map is intentionally omitted:
  // CharacterMap population is deferred to Editor.ensurePagePopulated().
  const measured = layoutBlock(node, {
    nodePos,
    x: blockX,
    y: targetY,
    availableWidth: blockWidth,
    page: pageNumber,
    measurer,
    fontConfig,
    ...(fontModifiers ? { fontModifiers } : {}),
  });

  const entry: MeasureCacheEntry = {
    availableWidth: blockWidth,
    nodePos,
    height: measured.height,
    lines: measured.lines,
    spaceBefore: measured.spaceBefore,
    spaceAfter: measured.spaceAfter,
    blockType: measured.blockType,
    align: measured.align,
  };
  measureCache?.set(node, entry);
  return entry;
}

/**
 * CSS-style margin collapsing.
 * The gap between two adjacent blocks is the larger of their margins, not the sum.
 */
export function collapseMargins(
  spaceAfter: number,
  spaceBefore: number,
): number {
  return Math.max(spaceAfter, spaceBefore);
}
