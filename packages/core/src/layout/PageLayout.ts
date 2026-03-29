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
import type { LayoutLine, ConstraintProvider } from "./LineBreaker";
import { ExclusionManager } from "./ExclusionManager";

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

/**
 * A float image that has been lifted out of the normal flow.
 * Produced by the Pass 2 float analysis step in layoutDocument.
 * Consumed by PageRenderer to draw the image at its absolute position.
 */
export interface FloatLayout {
  /** ProseMirror doc position of the float anchor span */
  docPos: number;
  /** Page this float appears on (1-based) */
  page: number;
  /** Left edge in page coordinates */
  x: number;
  /** Top edge in page coordinates */
  y: number;
  width: number;
  height: number;
  /** wrappingMode value — 'square-left' | 'square-right' | 'top-bottom' | 'behind' | 'front' */
  mode: string;
  /** The ProseMirror image node */
  node: Node;
  /**
   * Pass 1 y-coordinate of the anchor block — stored so Pass 4 can apply the
   * correct yDelta correction without overwriting Fix 1's stacking offset.
   * Pass 4 computes: newY = f.y + (finalAnchorY - anchorBlockY), which shifts
   * the float by exactly how much the anchor block moved in Pass 3, preserving
   * any extra downward offset that float stacking added.
   */
  anchorBlockY: number;
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
  /**
   * Float images lifted out of the normal text flow.
   * Each entry has absolute page coordinates so PageRenderer can draw it.
   * Absent (or empty) when the document has no floating images.
   */
  floats?: FloatLayout[];
  /**
   * Snapshot of the Pass 1 page/block positions BEFORE runFloatPass mutated
   * them. Set only when the layout contains floats.
   *
   * Phase 1b early termination copies blocks from previousLayout. If it
   * copied from the float-processed pages, those blocks would carry stale
   * Pass-3 yDelta values. When the new run's Pass 3 then adds its own yDelta
   * on top, positions double-shift and blocks overflow the page, disappearing
   * from the visible area. Phase 1b must copy from these clean Pass 1
   * positions so runFloatPass starts from a correct baseline every time.
   */
  _pass1Pages?: LayoutPage[];
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
  let earlyTerminated = false;

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
      const partialPass1: DocumentLayout = { pages: [...pages, currentPage], pageConfig, version: chunkVersion, isPartial: true, resumption };
      // Run the float pass on already-processed pages so floats visible in the
      // initial chunk render immediately — avoids the "floats appear on follow-up
      // render" page-jump. Floats beyond the cutoff will appear when idle layout
      // completes and produces the full layout, which is the normal update path.
      return runFloatPass(partialPass1, margins, pageWidth, contentWidth, measurer, fontConfig, fontModifiers);
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

    if (!overflows) {
      // ── Normal placement ───────────────────────────────────────────────────
      currentPage.blocks.push(block);
      y = targetY + entry.height;
      prevSpaceAfter = blockStyle.spaceAfter;
    } else if (entry.lines.length === 0) {
      // ── Leaf block (image, HR): move whole block to next page ──────────────
      // Leaf blocks have no lines to split. If the block exceeds the full page
      // height, place it anyway (overflow) rather than looping forever.
      const tooTallForAnyPage = entry.height > contentHeight;
      if (tooTallForAnyPage) {
        currentPage.blocks.push(block);
        y = targetY + entry.height;
        prevSpaceAfter = blockStyle.spaceAfter;
      } else {
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
        prevSpaceAfter = blockStyle.spaceAfter;
      }
    } else {
      // ── Text block: split lines across page boundaries ─────────────────────
      // Iterate through remainingLines, placing as many as fit on each page.
      // Handles blocks that span 2, 3, or more pages in a single pass.
      let remainingLines = entry.lines;
      let hasPlacedAnyPart = false;
      let currentPartStartY = targetY;

      while (remainingLines.length > 0) {
        const partStartY = currentPartStartY;
        const pageAvailable = (margins.top + contentHeight) - partStartY;

        let linesFit = 0;
        let heightFit = 0;
        for (const line of remainingLines) {
          if (heightFit + line.lineHeight > pageAvailable) break;
          linesFit++;
          heightFit += line.lineHeight;
        }

        if (linesFit === 0) {
          if (hasPlacedAnyPart || partStartY === margins.top) {
            // At the top of a page and still can't fit — force one line so we
            // never loop forever (handles single lines taller than the page).
            linesFit = 1;
            heightFit = remainingLines[0]!.lineHeight;
          } else {
            // Nothing placed yet and targetY left no room — advance first.
            pages.push(currentPage);
            currentPage = newPage(pages.length + 1);
            prevSpaceAfter = 0;
            currentPartStartY = margins.top;
            continue;
          }
        }

        const isLastPart = linesFit >= remainingLines.length;
        const isCont = hasPlacedAnyPart;
        const partLines = remainingLines.slice(0, linesFit);

        const partBlock: LayoutBlock = {
          node,
          nodePos,
          x: blockX,
          y: partStartY,
          width: blockWidth,
          height: heightFit,
          lines: partLines,
          spaceBefore: isCont ? 0 : entry.spaceBefore,
          spaceAfter: isLastPart ? blockStyle.spaceAfter : 0,
          blockType: entry.blockType,
          align: entry.align,
          availableWidth: blockWidth,
          ...(isCont ? { isContinuation: true as const } : {}),
          ...(!isLastPart ? { continuesOnNextPage: true as const } : {}),
        };

        if (listMarker !== undefined) {
          if (!isCont) {
            partBlock.listMarker = listMarker;
            partBlock.listMarkerX = blockX - MARKER_RIGHT_GAP;
          }
          partBlock.blockType = "list_item";
        }

        currentPage.blocks.push(partBlock);
        hasPlacedAnyPart = true;

        if (!isLastPart) {
          pages.push(currentPage);
          currentPage = newPage(pages.length + 1);
          prevSpaceAfter = 0;
          currentPartStartY = margins.top;
          remainingLines = remainingLines.slice(linesFit);
        } else {
          y = partStartY + heightFit;
          prevSpaceAfter = blockStyle.spaceAfter;
          break;
        }
      }
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
      // Use _pass1Pages when available — those are the clean pre-float positions.
      // previousLayout.pages contains float-adjusted y values (post Pass 3 yDelta);
      // copying those would cause the new Pass 3 to stack yDelta on top of already-
      // shifted blocks, doubling displacement and losing paragraphs off the page.
      const prevPages = previousLayout._pass1Pages ?? previousLayout.pages;
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

          earlyTerminated = true;
          break;
        }
      }
    }
  }

  // Flush last page. When Phase 1b early-terminated, the current page was
  // already pushed inside the loop (along with all subsequent copied pages).
  if (!earlyTerminated) {
    pages.push(currentPage);
  }

  const pass1Result: DocumentLayout = { pages, pageConfig, version: chunkVersion };
  return runFloatPass(pass1Result, margins, pageWidth, contentWidth, measurer, fontConfig, fontModifiers);
}

/**
 * Pass 2 + Pass 3 of layout: compute float positions, populate the
 * ExclusionManager, and re-flow any blocks that overlap an exclusion zone.
 *
 * Called both for complete layouts and for partial (streaming) layouts so that
 * floats visible in the initial chunk appear immediately rather than jumping
 * into view when the idle-layout follow-up completes.
 */
function runFloatPass(
  pass1Result: DocumentLayout,
  margins: PageConfig["margins"],
  pageWidth: number,
  contentWidth: number,
  measurer: TextMeasurer,
  fontConfig: FontConfig,
  fontModifiers: Map<string, FontModifier> | undefined,
): DocumentLayout {
  const { pages } = pass1Result;

  // Only run when the document actually contains floating images.
  // When no floats exist, skip entirely — zero overhead for the common case.
  const floatAnchors = collectFloatAnchors(pages);
  if (floatAnchors.length === 0) {
    return pass1Result;
  }

  // Snapshot Pass 1 page/block positions before any mutation.
  // Phase 1b copies blocks from previousLayout; it must copy from these clean
  // positions rather than the float-adjusted ones. See DocumentLayout._pass1Pages.
  const pass1Pages: LayoutPage[] = pages.map((p) => ({
    pageNumber: p.pageNumber,
    blocks: [...p.blocks],
  }));

  // Pass 2: compute float positions and populate the ExclusionManager.
  const exclusionMgr = new ExclusionManager();
  const floats: FloatLayout[] = [];
  const FLOAT_MARGIN = 8; // px gap around each float

  for (const anchor of floatAnchors) {
    const node = anchor.node;
    const attrs = node.attrs as {
      width?: number;
      height?: number;
      wrappingMode?: string;
      floatOffset?: { x: number; y: number };
    };

    const nodeWidth  = typeof attrs.width  === "number" ? attrs.width  : 200;
    const nodeHeight = typeof attrs.height === "number" ? attrs.height : 200;
    const mode       = attrs.wrappingMode ?? "inline";
    const offsetX    = attrs.floatOffset?.x ?? 0;
    const offsetY    = attrs.floatOffset?.y ?? 0;

    const contentX = margins.left;
    const contentRight = pageWidth - margins.right;

    let floatX: number;
    if (mode === "square-right") {
      // offsetX shifts from the default right-side position. Adding it means
      // dragging right increases offsetX and moves the image right (natural).
      floatX = contentRight - nodeWidth + offsetX;
    } else {
      // square-left, top-bottom, behind, front — default to left side
      floatX = contentX + offsetX;
    }

    // Fix 1: downward scan — push this float below any already-placed float on
    // the same page that it would physically overlap. This implements the CSS
    // VizAssert "find smallest Y where float fits" rule: a float cannot occupy
    // horizontal space already taken by a previously placed float at that Y.
    // 'behind'/'front' floats are exempt — they render above/below text and
    // never create exclusion zones, so stacking rules don't apply.
    let candidateY = anchor.anchorBlockY + offsetY;
    if (mode !== "behind" && mode !== "front") {
      let changed = true;
      while (changed) {
        changed = false;
        for (const placed of floats) {
          if (placed.page !== anchor.anchorPage) continue;
          if (placed.mode === "behind" || placed.mode === "front") continue;
          const hOverlap =
            floatX < placed.x + placed.width && floatX + nodeWidth > placed.x;
          const vOverlap =
            candidateY < placed.y + placed.height &&
            candidateY + nodeHeight > placed.y;
          if (hOverlap && vOverlap) {
            candidateY = placed.y + placed.height;
            changed = true;
          }
        }
      }
    }

    floats.push({
      docPos: anchor.docPos,
      page: anchor.anchorPage,
      x: floatX,
      y: candidateY,
      width: nodeWidth,
      height: nodeHeight,
      mode,
      node,
      anchorBlockY: anchor.anchorBlockY,
    });

    // 'behind' and 'front' float over text with no exclusion — text flows
    // through them. Only wrapping modes create exclusion zones.
    if (mode === "behind" || mode === "front") continue;

    // Determine which side text is excluded from.
    const side: "left" | "right" | "full" =
      mode === "square-left" ? "left" :
      mode === "square-right" ? "right" :
      "full"; // top-bottom

    exclusionMgr.addRect({
      page: anchor.anchorPage,
      x: floatX - FLOAT_MARGIN,
      right: floatX + nodeWidth + FLOAT_MARGIN,
      y: candidateY,
      bottom: candidateY + nodeHeight,
      side,
      docPos: anchor.docPos,
    });
  }

  // Pass 3: re-layout blocks whose Y range overlaps an exclusion zone, then
  // cascade any height change to every subsequent block on the same page.
  const pageBottom = pass1Result.pageConfig.pageHeight - pass1Result.pageConfig.margins.bottom;

  for (const page of pages) {
    if (!exclusionMgr.hasExclusionsOnPage(page.pageNumber)) continue;

    const pageNum = page.pageNumber;
    // Accumulated height delta from all re-layouts so far on this page.
    // Applied to subsequent blocks so they don't overlap the taller reflowed blocks.
    let yDelta = 0;
    // Non-overlapping blocks pushed past the page bottom by yDelta accumulation.
    // Collected here and prepended to the next page after the inner loop.
    const overflowToNext: LayoutBlock[] = [];

    for (let bi = 0; bi < page.blocks.length; bi++) {
      let block = page.blocks[bi]!;

      // Shift this block's Y by the accumulated delta from previous re-layouts.
      if (yDelta !== 0) {
        block = { ...block, y: block.y + yDelta };
        page.blocks[bi] = block;
      }

      // Skip leaf blocks (no lines to reflow or clamp).
      if (block.lines.length === 0) continue;

      const hasOverlap = exclusionMgr.getConstraint(
        pageNum,
        block.y,
        block.height || 1,
        margins.left,
        contentWidth,
      ) !== null;

      if (hasOverlap) {
        // Build a ConstraintProvider bound to this block's absolute position.
        const blockContentX = block.x;
        const blockAvailWidth = block.availableWidth;

        const constraintProvider: ConstraintProvider = (absoluteLineY: number) => {
          return exclusionMgr.getConstraint(
            pageNum,
            absoluteLineY,
            1,
            blockContentX,
            blockAvailWidth,
          );
        };

        // Re-measure the block with the constraint provider.
        // layoutBlock always lays out the FULL paragraph node. When this block
        // was split across pages in Pass 1, the reflowed result contains all
        // lines — far more than can fit on this page — causing content to
        // overflow into the bottom margin. Clamp lines to the page boundary.
        const reflowed = layoutBlock(block.node, {
          nodePos: block.nodePos,
          x: block.x,
          y: block.y,
          availableWidth: block.availableWidth,
          page: pageNum,
          measurer,
          fontConfig,
          ...(fontModifiers ? { fontModifiers } : {}),
          constraintProvider,
        });

        const finalBlock = clampBlockToPage(reflowed, pageBottom);

        // Accumulate the height difference so subsequent blocks shift accordingly.
        yDelta += finalBlock.height - block.height;
        page.blocks[bi] = finalBlock;
      } else if (block.y + block.height > pageBottom) {
        // Non-overlapping block pushed past the page bottom by yDelta.
        // Stripping its lines would lose content — move it to the next page instead.
        overflowToNext.push(block);
        page.blocks.splice(bi, 1);
        bi--;
      }
    }

    // Prepend overflow blocks to the next page, repositioned at the top of its
    // content area. Existing next-page blocks shift down to make room.
    if (overflowToNext.length > 0) {
      const nextPageNum = pageNum + 1;
      let nextPage = pages.find((p) => p.pageNumber === nextPageNum);
      if (!nextPage) {
        nextPage = { pageNumber: nextPageNum, blocks: [] };
        const insertAt = pages.findIndex((p) => p.pageNumber > nextPageNum);
        if (insertAt === -1) pages.push(nextPage);
        else pages.splice(insertAt, 0, nextPage);
      }

      // Stack overflow blocks at the top of the next page's content area.
      let nextY = margins.top;
      const reposBlocks: LayoutBlock[] = overflowToNext.map((b) => {
        const rb = { ...b, y: nextY };
        nextY += b.height;
        return rb;
      });
      const totalHeight = nextY - margins.top;

      // Push existing next-page blocks down to accommodate the inserted blocks.
      for (let j = 0; j < nextPage.blocks.length; j++) {
        nextPage.blocks[j] = { ...nextPage.blocks[j]!, y: nextPage.blocks[j]!.y + totalHeight };
      }
      nextPage.blocks.unshift(...reposBlocks);
    }
  }

  // Pass 3b: Overflow cascade — propagate block overflow to pages that were
  // skipped by Pass 3 because they have no float exclusions.
  //
  // Pass 3 runs only on pages that have exclusion zones. When it moves blocks
  // from page N to page N+1 (overflowToNext), it pushes page N+1's existing
  // blocks DOWN. If those pushed blocks now exceed page N+1's bottom, they stay
  // there — Pass 3 never visits page N+1 because it has no exclusions.
  //
  // This pass iterates every page in forward order and moves any text block
  // whose bottom exceeds pageBottom to the next page, cascading as far as
  // needed. It is safe to re-run on pages already handled by Pass 3 because
  // those pages have no remaining overflowing blocks after Pass 3.
  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi]!;
    const overflowBlocks: LayoutBlock[] = [];

    for (let bi = 0; bi < page.blocks.length; bi++) {
      const block = page.blocks[bi]!;
      // Leaf blocks (images, HRs) keep their position even when they overflow —
      // same policy as Pass 3. Text blocks are moved to preserve content.
      if (block.lines.length === 0) continue;
      if (block.y + block.height > pageBottom) {
        overflowBlocks.push(block);
        page.blocks.splice(bi, 1);
        bi--;
      }
    }

    if (overflowBlocks.length === 0) continue;

    const nextPageNum = page.pageNumber + 1;
    let nextPage = pages.find((p) => p.pageNumber === nextPageNum);
    if (!nextPage) {
      nextPage = { pageNumber: nextPageNum, blocks: [] };
      const insertAt = pages.findIndex((p) => p.pageNumber > nextPageNum);
      if (insertAt === -1) pages.push(nextPage);
      else pages.splice(insertAt, 0, nextPage);
    }

    let nextY = margins.top;
    const reposBlocks: LayoutBlock[] = overflowBlocks.map((b) => {
      const rb = { ...b, y: nextY };
      nextY += b.height;
      return rb;
    });
    const totalHeight = nextY - margins.top;

    for (let j = 0; j < nextPage.blocks.length; j++) {
      nextPage.blocks[j] = { ...nextPage.blocks[j]!, y: nextPage.blocks[j]!.y + totalHeight };
    }
    nextPage.blocks.unshift(...reposBlocks);
    // Do NOT increment pi — we need to re-examine this same page index in case
    // the newly inserted nextPage is at pages[pi+1] and itself overflows.
  }

  // Pass 4: Reconcile float Y values after Pass 3 may have shifted anchor blocks.
  //
  // Pass 3 applies a `yDelta` to every block that follows a reflowed block,
  // updating block.y in-place. But the FloatLayout entries were computed in
  // Pass 2 from the original Pass 1 block positions. If a block *before* a
  // float's anchor paragraph was reflowed (grew taller due to text wrapping),
  // the anchor block shifts by yDelta while the float remains at the old Y —
  // causing the float to visually drift above its anchor.
  //
  // Fix: walk the final block list, find each float anchor span, record the
  // block's new Y, then remap every FloatLayout to that corrected position.
  // This corrects the rendered position; the exclusion zones (used by Pass 3,
  // now complete) are not retroactively changed.
  if (floats.length > 0) {
    const finalAnchorY = new Map<number, { y: number; page: number }>();
    for (const page of pages) {
      for (const block of page.blocks) {
        for (const line of block.lines) {
          for (const span of line.spans) {
            if (span.kind !== "object" || span.width !== 0) continue;
            const wm = span.node.attrs["wrappingMode"] as string | undefined;
            if (!wm || wm === "inline") continue;
            finalAnchorY.set(span.docPos, { y: block.y, page: page.pageNumber });
          }
        }
      }
    }

    for (let fi = 0; fi < floats.length; fi++) {
      const f = floats[fi]!;
      const final = finalAnchorY.get(f.docPos);
      if (!final) continue;
      // Shift by exactly how much the anchor block moved in Pass 3 (yDelta).
      // Using (final.y - f.anchorBlockY) rather than (final.y + offsetY) is
      // critical: the latter would reset f.y to the un-stacked position,
      // undoing any downward displacement that Fix 1's stacking applied.
      const yDelta = final.y - f.anchorBlockY;
      const newY = f.y + yDelta;
      if (newY !== f.y || final.page !== f.page) {
        floats[fi] = { ...f, y: newY, page: final.page };
      }
    }
  }

  return { ...pass1Result, floats, _pass1Pages: pass1Pages };
}

/**
 * Truncates a block's lines so that `block.y + block.height <= pageBottom`.
 * Returns the same block reference when no clamping is needed.
 * Forces at least one line when the block starts below the page bottom so the
 * block is never completely empty (prevents cursor / hit-test holes).
 */
function clampBlockToPage(block: LayoutBlock, pageBottom: number): LayoutBlock {
  const available = pageBottom - block.y;
  if (block.height <= available) return block;

  let h = 0;
  let lineCount = 0;
  for (const line of block.lines) {
    if (h + line.lineHeight > available) break;
    h += line.lineHeight;
    lineCount++;
  }
  // Force at least one line only when the block starts above the page bottom
  // and there is at least a sliver of space. Blocks that start at or below
  // pageBottom (available ≤ 0) become empty (they're fully off-page).
  if (lineCount === 0 && available > 0 && block.lines.length > 0) {
    lineCount = 1;
    h = block.lines[0]!.lineHeight;
  }
  return {
    ...block,
    lines: block.lines.slice(0, lineCount),
    height: h,
    continuesOnNextPage: true as const,
  };
}

/** Float anchor: a zero-width object span referencing a floating image node. */
interface FloatAnchor {
  docPos: number;
  node: Node;
  anchorBlockY: number;
  anchorPage: number;
}

/**
 * Walks all laid-out blocks and collects float anchors — zero-width object
 * spans whose node has wrappingMode !== 'inline' and !== undefined.
 */
function collectFloatAnchors(pages: LayoutPage[]): FloatAnchor[] {
  const anchors: FloatAnchor[] = [];

  for (const page of pages) {
    for (const block of page.blocks) {
      for (const line of block.lines) {
        for (const span of line.spans) {
          if (span.kind !== "object") continue;
          if (span.width !== 0) continue; // only zero-width float anchors
          const wrappingMode = span.node.attrs["wrappingMode"] as string | undefined;
          if (!wrappingMode || wrappingMode === "inline") continue;
          anchors.push({
            docPos: span.docPos,
            node: span.node,
            anchorBlockY: block.y,
            anchorPage: page.pageNumber,
          });
        }
      }
    }
  }

  return anchors;
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
    // Only update the cache when this block holds ALL the cached lines.
    // Split-part blocks carry a subset of lines; updating with partial data
    // would corrupt subsequent layout runs that expect the full measurement.
    if (cached && block.lines.length === cached.lines.length) {
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
