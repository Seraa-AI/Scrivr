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
import type { TextMeasurer } from "./TextMeasurer";
import type { FontModifier } from "../extensions/types";
import { populateCharMap } from "./BlockLayout";
import { spanEndDocPos } from "./LineBreaker";

interface FragmentIndexEntry {
  start: number; // first docPos on this line (charStart)
  end: number; // last docPos on this line, exclusive (charEnd)
  page: number;
}

export interface LayoutCoordinatorOptions {
  pageConfig: PageConfig;
  fontConfig: FontConfig;
  measurer: TextMeasurer;
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

  private _layout: DocumentLayout;
  private _dirty = false;
  private _layoutIsPartial = false;
  private _layoutResumption: LayoutResumption | null = null;
  private _partialLayoutBlocks = 0;
  private _idleLayoutId: number | null = null;
  private _ready = true;
  private _cursorPage = 1;

  private readonly _populatedPages = new Set<number>();
  private readonly _measureCache = new WeakMap<Node, MeasureCacheEntry>();

  /**
   * O(1) page lookup by page number.
   * Rebuilt by _indexLayout() after every layout assignment.
   */
  private _pageMap = new Map<number, LayoutPage>();

  /**
   * Flat sorted index used by _cursorPageFromLayout().
   * Each entry covers one rendered line — one entry per line per page.
   * Kept sorted by start so binary search is O(log N).
   * Rebuilt by _indexLayout() after every layout assignment.
   */
  private _fragmentIndex: FragmentIndexEntry[] = [];

  /** The glyph-position map — populated lazily per page, cleared on each layout pass. */
  readonly charMap = new CharacterMap();

  constructor(opts: LayoutCoordinatorOptions) {
    this.opts = opts;

    performance.mark("scrivr:layout-initial-start");
    this._layout = this._runLayout({
      previousVersion: 0,
      maxBlocks: LayoutCoordinator.INITIAL_BLOCKS,
    });
    performance.mark("scrivr:layout-initial-end");
    performance.measure(
      `scrivr:layout-initial (${opts.getDoc().childCount} blocks, first ${LayoutCoordinator.INITIAL_BLOCKS} sync)`,
      "scrivr:layout-initial-start",
      "scrivr:layout-initial-end",
    );

    this._layoutIsPartial = this._layout.isPartial ?? false;
    this._layoutResumption = this._layout.resumption ?? null;
    this._indexLayout();
    // Page 1 is always visible on first paint.
    this.ensurePagePopulated(1);

    if (this._layoutIsPartial) {
      this._partialLayoutBlocks = LayoutCoordinator.INITIAL_BLOCKS;
      this._scheduleIdleLayout();
    }
  }

  // ── Public getters ──────────────────────────────────────────────────────────

  get current(): DocumentLayout {
    return this._layout;
  }
  get cursorPage(): number {
    return this._cursorPage;
  }
  get isReady(): boolean {
    return this._ready;
  }

  get loadingState(): "syncing" | "rendering" | "ready" {
    if (!this._ready) return "syncing";
    if (this._layoutIsPartial) return "rendering";
    return "ready";
  }

  // ── Public methods ──────────────────────────────────────────────────────────

  /**
   * Mark the layout as stale. Call this whenever the document or selection
   * changes (i.e. on every dispatch). The actual re-layout is deferred to
   * the next ensureLayout() call — usually from Editor's RAF flush.
   */
  invalidate(): void {
    this._dirty = true;
  }

  /**
   * Recompute the layout if it is stale (dirty). No-op when clean.
   *
   * Called by Editor's RAF flush and by the `editor.layout` getter.
   * After completion, the charmap for the cursor page ± 1 is populated
   * so selection / cursor drawing works immediately.
   */
  ensureLayout(): void {
    if (!this._dirty) return;
    this._dirty = false;
    // A synchronous user action supersedes any in-progress idle pass.
    this._layoutIsPartial = false;
    this._layoutResumption = null;
    this.charMap.clear();
    this._populatedPages.clear();
    const prev = this._layout;
    this._layout = this._runLayout({
      previousVersion: prev.version,
      previousLayout: prev,
    });
    this._indexLayout();
    this._cursorPage = this._cursorPageFromLayout();
    this.ensurePagePopulated(this._cursorPage);
    this.ensurePagePopulated(this._cursorPage - 1); // no-op when page < 1
    this.ensurePagePopulated(this._cursorPage + 1); // no-op when page doesn't exist
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
    if (this._populatedPages.has(pageNumber)) return;
    const page = this._pageMap.get(pageNumber);
    if (!page) return; // don't mark as populated — layout may grow later
    this._populatedPages.add(pageNumber);
    const doc = this.opts.getDoc();
    let lineOffset = 0;
    for (const block of page.blocks) {
      if (block.lines.length === 0) {
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
      lineOffset += block.lines.length;
    }

    // Stamp real float objectRects. populateCharMap registers the anchor
    // span's zero-width objectRect (because floats are zero-width in the
    // inline flow); overwrite with the actual layout position/dimensions so
    // getNodeViewportRect returns the correct rect immediately (before the
    // TileManager paint re-stamps them via renderPage/drawFloat).
    for (const float of this._layout.floats ?? []) {
      if (float.page !== pageNumber) continue;
      this.charMap.registerObjectRect({
        docPos: float.docPos,
        x: float.x,
        y: float.y,
        width: float.width,
        height: float.height,
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
    this._ready = ready;

    if (ready) {
      this._cancelIdleLayout();
      this._partialLayoutBlocks = LayoutCoordinator.INITIAL_BLOCKS;
      this._dirty = false;
      this.charMap.clear();
      this._populatedPages.clear();
      this._layout = this._runLayout({
        previousVersion: this._layout.version,
        maxBlocks: LayoutCoordinator.INITIAL_BLOCKS,
      });
      this._layoutIsPartial = this._layout.isPartial ?? false;
      this._layoutResumption = this._layout.resumption ?? null;
      this._indexLayout();
      this._cursorPage = this._cursorPageFromLayout();
      this.ensurePagePopulated(this._cursorPage);
      this.ensurePagePopulated(this._cursorPage - 1);
      this.ensurePagePopulated(this._cursorPage + 1);
      this.opts.onUpdate(); // paint first pages immediately

      if (this._layoutIsPartial) {
        this._scheduleIdleLayout();
      }
    } else {
      this._cancelIdleLayout();
      this._layoutIsPartial = false;
    }
  }

  /** Cancel all pending async work. Call from Editor.destroy(). */
  destroy(): void {
    this._cancelIdleLayout();
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  /**
   * Rebuild the O(1) page map and O(log N) block index from the current layout.
   * Called immediately after every `this._layout` assignment.
   */
  private _indexLayout(): void {
    this._pageMap.clear();
    this._fragmentIndex = [];

    for (const page of this._layout.pages) {
      this._pageMap.set(page.pageNumber, page);

      for (const block of page.blocks) {
        if (block.lines.length === 0) {
          // Leaf block (image, HR): single entry covering the full node range.
          this._fragmentIndex.push({
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

          this._fragmentIndex.push({
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
  private _cursorPageFromLayout(): number {
    const head = this.opts.getHead();
    let lo = 0;
    let hi = this._fragmentIndex.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const { start, end, page } = this._fragmentIndex[mid]!;
      if (head < start) {
        hi = mid - 1;
      } else if (head >= end) {
        lo = mid + 1;
      } else {
        return page;
      }
    }
    // Binary search miss: fall back to linear scan by node range.
    return this._findPageLinear(head);
  }

  private _findPageLinear(docPos: number): number {
    for (const page of this._layout.pages) {
      for (const block of page.blocks) {
        if (
          docPos >= block.nodePos &&
          docPos < block.nodePos + block.node.nodeSize
        ) {
          return page.pageNumber;
        }
      }
    }
    return this._layout.pages.at(-1)?.pageNumber ?? 1;
  }

  /**
   * Thin delegation to runPipeline() — maps coordinator state to pipeline options.
   * All orchestration logic lives in runPipeline (PageLayout.ts); the coordinator
   * owns only the call-site wiring and state management.
   */
  private _runLayout(opts: {
    previousVersion?: number;
    maxBlocks?: number;
    previousLayout?: DocumentLayout;
    resumption?: LayoutResumption | null;
  }): DocumentLayout {
    return runPipeline(this.opts.getDoc(), {
      pageConfig: this.opts.pageConfig,
      fontConfig: this.opts.fontConfig,
      measurer: this.opts.measurer,
      fontModifiers: this.opts.fontModifiers,
      measureCache: this._measureCache,
      ...(opts.previousVersion !== undefined
        ? { previousVersion: opts.previousVersion }
        : {}),
      ...(opts.maxBlocks !== undefined ? { maxBlocks: opts.maxBlocks } : {}),
      ...(opts.previousLayout ? { previousLayout: opts.previousLayout } : {}),
      ...(opts.resumption ? { resumption: opts.resumption } : {}),
    });
  }

  private _scheduleIdleLayout(): void {
    const run = (deadline?: IdleDeadline) => this._completeIdleLayout(deadline);
    if (typeof requestIdleCallback !== "undefined") {
      this._idleLayoutId = requestIdleCallback(run);
    } else {
      this._idleLayoutId = setTimeout(() => run(), 16) as unknown as number;
    }
  }

  private _cancelIdleLayout(): void {
    if (this._idleLayoutId === null) return;
    if (typeof cancelIdleCallback !== "undefined") {
      cancelIdleCallback(this._idleLayoutId);
    } else {
      clearTimeout(this._idleLayoutId as unknown as number);
    }
    this._idleLayoutId = null;
  }

  /**
   * Processes one chunk of the remaining layout during an idle callback.
   * If the user typed between chunks, `ensureLayout()` will have cleared
   * `_layoutIsPartial` and this becomes a cheap no-op.
   */
  private _completeIdleLayout(deadline?: IdleDeadline): void {
    this._idleLayoutId = null;
    if (!this._layoutIsPartial) return;

    let chunkSize = LayoutCoordinator.LAYOUT_CHUNK_SIZE;
    if (deadline && deadline.timeRemaining() > 8) {
      // ~3 blocks/ms heuristic — process more when the browser has budget.
      chunkSize = Math.min(120, Math.floor(deadline.timeRemaining() * 2));
    }
    this._partialLayoutBlocks += chunkSize;

    this.charMap.clear();
    this._populatedPages.clear();
    performance.mark("scrivr:layout-chunk-start");
    // Pass resumption so layout continues from the next unprocessed block
    // rather than restarting from block 0 — O(N) total vs O(N²).
    this._layout = this._runLayout({
      resumption: this._layoutResumption,
      maxBlocks: chunkSize,
    });
    performance.mark("scrivr:layout-chunk-end");
    performance.measure(
      `scrivr:layout-chunk (next ${chunkSize} blocks, total ${this._partialLayoutBlocks} of ${this.opts.getDoc().childCount})`,
      "scrivr:layout-chunk-start",
      "scrivr:layout-chunk-end",
    );
    this._layoutIsPartial = this._layout.isPartial ?? false;
    this._layoutResumption = this._layout.resumption ?? null;
    this._indexLayout();
    this._cursorPage = this._cursorPageFromLayout();
    this.ensurePagePopulated(this._cursorPage);
    this.ensurePagePopulated(this._cursorPage - 1);
    this.ensurePagePopulated(this._cursorPage + 1);
    this.opts.onUpdate();

    if (this._layoutIsPartial) {
      this._scheduleIdleLayout();
    }
  }
}
