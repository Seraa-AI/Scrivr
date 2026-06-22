import type { Node } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import { CharacterMap } from "./CharacterMap";
import { runPipeline } from "./PageLayout";
import type {
  PageConfig,
  DocumentLayout,
  LayoutPage,
  MeasureCacheEntry,
  LayoutResumption,
} from "./PageLayout";
import type { FontConfig } from "./FontConfig";
import type { InlineRegistry } from "./BlockRegistry";
import type { TextMeasurerLike } from "./TextMeasurer";
import type { FontModifier } from "../extensions/types";
import type { PageChromeContribution } from "./PageMetrics";
import { populateCharMap, registeredLineCount } from "./BlockLayout";
import { spanEndDocPos } from "./LineBreaker";

interface FragmentIndexEntry {
  start: number; // first docPos on this line (charStart)
  end: number; // last docPos on this line, exclusive (charEnd)
  page: number;
}

export interface LayoutCoordinatorOptions {
  pageConfig: PageConfig;
  fontConfig: FontConfig;
  measurer: TextMeasurerLike;
  fontModifiers: Map<string, FontModifier>;
  /** Returns the current ProseMirror document — read at layout time so the
   *  coordinator always operates on the latest doc without needing per-call args. */
  getDoc: () => Node;
  /** Returns the current cursor head position — used to identify the cursor page
   *  after every layout pass. Exposed as a callback so external code (e.g. a
   *  collaborative adapter) can also read it via coordinator.getHead(). */
  getHead: () => number;
  /** Called after idle-layout and setReady layout updates complete.
   *  Should trigger a re-render (notifyListeners). The RAF flush path is
   *  owned by Editor and calls ensureLayout() + its own post-flush work. */
  onUpdate: () => void;
  /** Returns the current page chrome contributions — read per layout pass so
   *  extensions registered after construction are picked up. */
  getPageChromeContributions?: () => PageChromeContribution[];
  /** Inline object registry — enables dynamic measurement for tokens. */
  inlineRegistry?: InlineRegistry;
}

/**
 * Owns all layout state: the DocumentLayout, CharacterMap, measure cache,
 * dirty/partial flags, and the idle-callback scheduling for streamed loads.
 *
 * Editor holds a single LayoutCoordinator and delegates every layout
 * concern to it. This reduces Editor's private field count by ~12 and
 * collapses four nearly-identical `layoutDocument(...)` call sites into one.
 */
export class LayoutCoordinator {
  /** Number of blocks measured synchronously on initial / setReady load. */
  static readonly INITIAL_BLOCKS = 100;

  /**
   * Blocks per idle chunk. Small enough to stay within ~16 ms;
   * large enough to finish a 1 000-block doc in ~20 ticks.
   */
  private static readonly LAYOUT_CHUNK_SIZE = 50;

  private readonly opts: LayoutCoordinatorOptions;

  private layout: DocumentLayout;
  private dirty = false;
  private layoutIsPartial = false;
  private layoutResumption: LayoutResumption | null = null;
  private partialLayoutBlocks = 0;
  private idleLayoutId: number | null = null;
  private ready = true;
  private cursorPageValue = 1;

  private readonly populatedPages = new Set<number>();
  private readonly measureCache = new WeakMap<Node, MeasureCacheEntry>();

  /**
   * O(1) page lookup by page number.
   * Rebuilt by indexLayout() after every layout assignment.
   */
  private pageMap = new Map<number, LayoutPage>();

  /**
   * Flat sorted index used by cursorPageFromLayout().
   * Each entry covers one rendered line — one entry per line per page.
   * Kept sorted by start so binary search is O(log N).
   * Rebuilt by indexLayout() after every layout assignment.
   */
  private fragmentIndex: FragmentIndexEntry[] = [];

  /** The glyph-position map — populated lazily per page, cleared on each layout pass. */
  readonly charMap = new CharacterMap();

  constructor(opts: LayoutCoordinatorOptions) {
    this.opts = opts;

    performance.mark("scrivr:layout-initial-start");
    this.layout = this.runLayout({
      previousVersion: 0,
      maxBlocks: LayoutCoordinator.INITIAL_BLOCKS,
    });
    performance.mark("scrivr:layout-initial-end");
    performance.measure(
      `scrivr:layout-initial (${opts.getDoc().childCount} blocks, first ${LayoutCoordinator.INITIAL_BLOCKS} sync)`,
      "scrivr:layout-initial-start",
      "scrivr:layout-initial-end",
    );

    this.layoutIsPartial = this.layout.isPartial ?? false;
    this.layoutResumption = this.layout.resumption ?? null;
    this.indexLayout();
    // Page 1 is always visible on first paint.
    this.ensurePagePopulated(1);

    if (this.layoutIsPartial) {
      this.partialLayoutBlocks = LayoutCoordinator.INITIAL_BLOCKS;
      this.scheduleIdleLayout();
    }
  }

  // ── Public getters ──────────────────────────────────────────────────────────

  get current(): DocumentLayout {
    return this.layout;
  }
  get cursorPage(): number {
    return this.cursorPageValue;
  }
  get isReady(): boolean {
    return this.ready;
  }

  get loadingState(): "syncing" | "rendering" | "ready" {
    if (!this.ready) return "syncing";
    if (this.layoutIsPartial) return "rendering";
    return "ready";
  }

  // ── Public methods ──────────────────────────────────────────────────────────

  /**
   * Mark the layout as stale. Call this whenever the document or selection
   * changes (i.e. on every dispatch). The actual re-layout is deferred to
   * the next ensureLayout() call — usually from Editor's RAF flush.
   */
  invalidate(): void {
    this.dirty = true;
  }

  /**
   * Recompute the layout if it is stale (dirty). No-op when clean.
   *
   * Called by Editor's RAF flush and by the `editor.layout` getter.
   * After completion, the charmap for the cursor page ± 1 is populated
   * so selection / cursor drawing works immediately.
   */
  ensureLayout(): void {
    if (!this.dirty) return;
    this.dirty = false;
    // A synchronous user action supersedes any in-progress idle pass.
    this.layoutIsPartial = false;
    this.layoutResumption = null;
    this.charMap.clear();
    this.populatedPages.clear();
    const prev = this.layout;
    this.layout = this.runLayout({
      previousVersion: prev.version,
      previousLayout: prev,
    });
    this.indexLayout();
    this.cursorPageValue = this.cursorPageFromLayout();
    this.ensurePagePopulated(this.cursorPageValue);
    this.ensurePagePopulated(this.cursorPageValue - 1); // no-op when page < 1
    this.ensurePagePopulated(this.cursorPageValue + 1); // no-op when page doesn't exist
  }

  /**
   * Synchronously finish the full document layout.
   *
   * The normal browser path streams large documents: first paint gets an
   * initial chunk, then idle callbacks complete the rest. Serialization paths
   * such as PDF export need the complete layout immediately, so they use this
   * method to cancel pending idle work and run the same pipeline without a
   * `maxBlocks` cutoff.
   */
  ensureFullLayout(): void {
    this.cancelIdleLayout();
    const prev = this.layout;
    this.dirty = false;
    this.layoutIsPartial = false;
    this.layoutResumption = null;
    this.charMap.clear();
    this.populatedPages.clear();
    this.layout = this.runLayout({
      previousVersion: prev.version,
      previousLayout: prev,
    });
    this.indexLayout();
    this.cursorPageValue = this.cursorPageFromLayout();
    this.ensurePagePopulated(this.cursorPageValue);
    this.ensurePagePopulated(this.cursorPageValue - 1);
    this.ensurePagePopulated(this.cursorPageValue + 1);
  }

  /**
   * Populate the CharacterMap for a single page (idempotent).
   *
   * Called eagerly for cursor page ± 1 after every layout pass.
   * Also called by ViewManager before painting each visible page so that
   * hit-testing coordinates are always available when needed.
   */
  ensurePagePopulated(pageNumber: number): void {
    if (pageNumber < 1) return;
    if (this.populatedPages.has(pageNumber)) return;
    const page = this.pageMap.get(pageNumber);
    if (!page) return; // don't mark as populated — layout may grow later
    this.populatedPages.add(pageNumber);
    const doc = this.opts.getDoc();
    let lineOffset = 0;
    for (const block of page.blocks) {
      if (block.kind === "leaf") {
        // Leaf block (HR, image, …). nodePos and nodePos+nodeSize are document-level
        // gap positions — TextSelection.between snaps them to the nearest text node,
        // always landing in the paragraph BEFORE the block. Resolve to real text
        // cursor positions first so left-click → end of preceding para and
        // right-click → start of following para.
        const $before = doc.resolve(block.nodePos);
        const beforeSel = TextSelection.findFrom($before, -1);
        const beforePos = beforeSel?.head ?? block.nodePos;

        const $after = doc.resolve(
          Math.min(block.nodePos + block.node.nodeSize, doc.content.size),
        );
        const afterSel = TextSelection.findFrom($after, 1);
        const afterPos = afterSel?.head ?? block.nodePos + block.node.nodeSize;

        const halfWidth = block.availableWidth / 2;
        const li = lineOffset;
        if (!this.charMap.hasLine(page.pageNumber, li)) {
          this.charMap.registerLine({
            page: page.pageNumber,
            lineIndex: li,
            y: block.y,
            height: block.height,
            x: block.x,
            contentWidth: block.availableWidth,
            startDocPos: beforePos,
            endDocPos: afterPos,
          });
        }
        // Left-half glyph only (no hasGlyph guard so it coexists with para's sentinel).
        // coordsAtPos finds the paragraph's glyph first (registered earlier) → cursor
        // draws on the paragraph line, not on the leaf block.
        //
        // No right-half glyph: posAtCoords falls through to line.endDocPos = afterPos.
        // The following paragraph registers its own glyph at afterPos unblocked, so
        // coordsAtPos draws the cursor at the correct position in that paragraph.
        this.charMap.registerGlyph({
          docPos: beforePos,
          x: block.x,
          y: block.y,
          lineY: block.y,
          width: halfWidth,
          height: block.height,
          page: page.pageNumber,
          lineIndex: li,
        });
        lineOffset += 1;
        continue;
      }

      populateCharMap(
        block,
        this.charMap,
        page.pageNumber,
        lineOffset,
        this.opts.measurer,
      );
      lineOffset += registeredLineCount(block);
    }

    // Stamp anchored-object rects so getNodeViewportRect returns the rendered
    // object bounds immediately, before the tile paint pass re-stamps them.
    for (const object of this.layout.anchoredObjects ?? []) {
      if (object.page !== pageNumber) continue;
      this.charMap.registerObjectRect({
        docPos: object.docPos,
        x: object.x,
        y: object.y,
        width: object.width,
        height: object.height,
        page: pageNumber,
      });
    }
  }

  /**
   * Switch between ready and suppressed (collaborative sync) modes.
   *
   * `true`  — cancel any stale idle work, run the first layout chunk
   *            synchronously, notify listeners, then continue in idle chunks.
   * `false` — cancel idle; suppress future idle layout. Editor.setReady also
   *            cancels the pending RAF when going false.
   */
  setReady(ready: boolean): void {
    this.ready = ready;

    if (ready) {
      this.cancelIdleLayout();
      this.partialLayoutBlocks = LayoutCoordinator.INITIAL_BLOCKS;
      this.dirty = false;
      this.charMap.clear();
      this.populatedPages.clear();
      this.layout = this.runLayout({
        previousVersion: this.layout.version,
        maxBlocks: LayoutCoordinator.INITIAL_BLOCKS,
      });
      this.layoutIsPartial = this.layout.isPartial ?? false;
      this.layoutResumption = this.layout.resumption ?? null;
      this.indexLayout();
      this.cursorPageValue = this.cursorPageFromLayout();
      this.ensurePagePopulated(this.cursorPageValue);
      this.ensurePagePopulated(this.cursorPageValue - 1);
      this.ensurePagePopulated(this.cursorPageValue + 1);
      this.opts.onUpdate(); // paint first pages immediately

      if (this.layoutIsPartial) {
        this.scheduleIdleLayout();
      }
    } else {
      this.cancelIdleLayout();
      this.layoutIsPartial = false;
    }
  }

  /** Cancel all pending async work. Call from Editor.destroy(). */
  destroy(): void {
    this.cancelIdleLayout();
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  /**
   * Rebuild the O(1) page map and O(log N) block index from the current layout.
   * Called immediately after every `this.layout` assignment.
   */
  private indexLayout(): void {
    this.pageMap.clear();
    this.fragmentIndex = [];

    for (const page of this.layout.pages) {
      this.pageMap.set(page.pageNumber, page);

      for (const block of page.blocks) {
        if (block.kind === "leaf") {
          // Leaf block (image, HR): single entry covering the full node range.
          this.fragmentIndex.push({
            start: block.nodePos,
            end: block.nodePos + block.node.nodeSize,
            page: page.pageNumber,
          });
          continue;
        }

        // Text block: one entry per rendered line.
        // Each line's char range is naturally non-overlapping, so split-paragraph
        // continuation blocks (same nodePos, different lines on different pages)
        // map to the correct page without special casing.
        const isLastVisualPart = !block.continuesOnNextPage;

        for (let li = 0; li < block.lines.length; li++) {
          const line = block.lines[li]!;
          const firstSpan = line.spans[0];
          const lastSpan = line.spans[line.spans.length - 1];

          if (!firstSpan || !lastSpan) continue; // safety: skip phantom lines

          const lineStart = firstSpan.docPos;
          let lineEnd = spanEndDocPos(lastSpan);

          // Sentinel: the very last line of the last visual part extends to
          // nodePos + nodeSize so the paragraph-end cursor position is covered.
          const isLastLine = li === block.lines.length - 1;
          if (isLastLine && isLastVisualPart) {
            lineEnd = Math.max(lineEnd, block.nodePos + block.node.nodeSize);
          }

          this.fragmentIndex.push({
            start: lineStart,
            end: lineEnd,
            page: page.pageNumber,
          });
        }
      }
    }

    // No sort needed: entries are produced in document order.
    // Pages are processed in sequence; blocks within each page are in docPos order;
    // lines within each block are in docPos order; overflow always moves to a later page.
    // The sentinel extension on the last line (end = nodePos + nodeSize) can exceed
    // the next entry's start, but start values remain strictly non-decreasing.
  }

  /**
   * Find the page number of the cursor using a binary search over _blockIndex.
   * O(log N) vs the previous O(pages × blocks) nested loop.
   */
  private cursorPageFromLayout(): number {
    const head = this.opts.getHead();
    let lo = 0;
    let hi = this.fragmentIndex.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const { start, end, page } = this.fragmentIndex[mid]!;
      if (head < start) {
        hi = mid - 1;
      } else if (head >= end) {
        lo = mid + 1;
      } else {
        return page;
      }
    }
    // Binary search miss: fall back to linear scan by node range.
    return this.findPageLinear(head);
  }

  private findPageLinear(docPos: number): number {
    for (const page of this.layout.pages) {
      for (const block of page.blocks) {
        if (
          docPos >= block.nodePos &&
          docPos < block.nodePos + block.node.nodeSize
        ) {
          return page.pageNumber;
        }
      }
    }
    return this.layout.pages.at(-1)?.pageNumber ?? 1;
  }

  /**
   * Thin delegation to runPipeline() — maps coordinator state to pipeline options.
   * All orchestration logic lives in runPipeline (PageLayout.ts); the coordinator
   * owns only the call-site wiring and state management.
   */
  private runLayout(opts: {
    previousVersion?: number;
    maxBlocks?: number;
    previousLayout?: DocumentLayout;
    resumption?: LayoutResumption | null;
  }): DocumentLayout {
    const contribs = this.opts.getPageChromeContributions?.() ?? [];
    return runPipeline(this.opts.getDoc(), {
      pageConfig: this.opts.pageConfig,
      fontConfig: this.opts.fontConfig,
      measurer: this.opts.measurer,
      fontModifiers: this.opts.fontModifiers,
      measureCache: this.measureCache,
      ...(contribs.length > 0 ? { pageChromeContributions: contribs } : {}),
      ...(opts.previousVersion !== undefined
        ? { previousVersion: opts.previousVersion }
        : {}),
      ...(opts.maxBlocks !== undefined ? { maxBlocks: opts.maxBlocks } : {}),
      ...(opts.previousLayout ? { previousLayout: opts.previousLayout } : {}),
      ...(opts.resumption ? { resumption: opts.resumption } : {}),
      ...(this.opts.inlineRegistry ? { inlineRegistry: this.opts.inlineRegistry } : {}),
    });
  }

  private scheduleIdleLayout(): void {
    const run = (deadline?: IdleDeadline) => this.completeIdleLayout(deadline);
    if (typeof requestIdleCallback !== "undefined") {
      this.idleLayoutId = requestIdleCallback(run);
    } else {
      this.idleLayoutId = setTimeout(() => run(), 16) as unknown as number;
    }
  }

  private cancelIdleLayout(): void {
    if (this.idleLayoutId === null) return;
    if (typeof cancelIdleCallback !== "undefined") {
      cancelIdleCallback(this.idleLayoutId);
    } else {
      clearTimeout(this.idleLayoutId as unknown as number);
    }
    this.idleLayoutId = null;
  }

  /**
   * Processes one chunk of the remaining layout during an idle callback.
   * If the user typed between chunks, `ensureLayout()` will have cleared
   * `_layoutIsPartial` and this becomes a cheap no-op.
   */
  private completeIdleLayout(deadline?: IdleDeadline): void {
    this.idleLayoutId = null;
    if (!this.layoutIsPartial) return;

    let chunkSize = LayoutCoordinator.LAYOUT_CHUNK_SIZE;
    if (deadline && deadline.timeRemaining() > 8) {
      // ~3 blocks/ms heuristic — process more when the browser has budget.
      chunkSize = Math.min(120, Math.floor(deadline.timeRemaining() * 2));
    }
    this.partialLayoutBlocks += chunkSize;

    this.charMap.clear();
    this.populatedPages.clear();
    performance.mark("scrivr:layout-chunk-start");
    // Pass resumption so layout continues from the next unprocessed block
    // rather than restarting from block 0 — O(N) total vs O(N²).
    this.layout = this.runLayout({
      resumption: this.layoutResumption,
      maxBlocks: chunkSize,
    });
    performance.mark("scrivr:layout-chunk-end");
    performance.measure(
      `scrivr:layout-chunk (next ${chunkSize} blocks, total ${this.partialLayoutBlocks} of ${this.opts.getDoc().childCount})`,
      "scrivr:layout-chunk-start",
      "scrivr:layout-chunk-end",
    );
    this.layoutIsPartial = this.layout.isPartial ?? false;
    this.layoutResumption = this.layout.resumption ?? null;
    this.indexLayout();
    this.cursorPageValue = this.cursorPageFromLayout();
    this.ensurePagePopulated(this.cursorPageValue);
    this.ensurePagePopulated(this.cursorPageValue - 1);
    this.ensurePagePopulated(this.cursorPageValue + 1);
    this.opts.onUpdate();

    if (this.layoutIsPartial) {
      this.scheduleIdleLayout();
    }
  }
}
