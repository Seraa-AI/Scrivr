import type { Node } from "prosemirror-model";
import { createLayoutFontResolver } from "../fonts/layoutResolver";
import type { LayoutFontResolver } from "../fonts/layoutResolver";
import type { FontProvider, FontResource, FontResolution } from "../fonts/types";
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
import { collectFontRequests } from "../fonts/collectFontRequests";
import type { FontRequest } from "../fonts/types";

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
  /** Answers font requests. Absent when the application supplied no provider. */
  fonts?: FontProvider | null;
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

  /**
   * How long the first paint waits for a document's faces. Long enough for a
   * font file on a slow connection, short enough that a provider which never
   * answers costs a legible pause rather than an editor that never paints.
   */
  private static readonly FONT_WAIT_MS = 2_000;

  private readonly opts: LayoutCoordinatorOptions;

  private layout: DocumentLayout;
  private dirty = false;
  private layoutIsPartial = false;
  private layoutResumption: LayoutResumption | null = null;
  private partialLayoutBlocks = 0;
  private idleLayoutId: number | null = null;
  /**
   * Two things gate showing a document, and both have to be satisfied.
   *
   * `collabReady` is the caller's: a shared document is not worth laying out
   * until it has synced. `fontsReady` is ours: a document laid out before its
   * faces are installed is measured against whatever the host substitutes, and
   * swapping to the real faces afterwards re-breaks every line. Waiting is
   * cheaper than showing the wrong thing and correcting it.
   */
  private collabReady = true;
  private fontsReady = true;
  private get ready(): boolean {
    return this.collabReady && this.fontsReady;
  }
  private cursorPageValue = 1;

  private readonly populatedPages = new Set<number>();
  private measureCache = new WeakMap<Node, MeasureCacheEntry>();
  /**
   * Keep the resolver and measurement cache in the same generation.
   *
   * A span records its resolution as an id into this resolver's table, and the
   * measure cache hands those spans back on later runs without re-measuring.
   * A resolver rebuilt per run would start numbering again, so the ids on
   * cached spans would point into a table that no longer describes them.
   */
  private fontResolverValue: LayoutFontResolver | null;
  /** Keyed by `FontResource.id`: a provider may hand back a fresh object each call. */
  private readonly installedFonts = new Map<string, string>();
  /**
   * Faces this backend has already tried to install, whether or not it could.
   *
   * The document waits for a face the first time it is asked for. It does not
   * wait again: a backend with no `FontFace` at all, or bytes that cannot be
   * fetched, would otherwise hold the document forever and re-enter this on
   * every layout.
   */
  private readonly attemptedFonts = new Set<string>();
  /** Installs in flight, by resource id, so two batches share one install. */
  private readonly installing = new Map<string, Promise<string | null>>();
  /** The document has been shown once; the font gate never closes again. */
  private shownOnce = false;
  private fontWaitTimer: number | null = null;
  private preparingFonts = false;
  private fontPreparationPending = false;
  private disposed = false;
  private unsubscribeFonts?: () => void;

  /**
   * The provider's answer, as this measurement backend can actually honour it.
   *
   * An answer with no resource is one the provider already settled without
   * bytes — a system family, or nothing owned at all — and there is nothing
   * here to install, so it passes through as written. An answer whose bytes
   * this backend has not installed is the degraded case: the face exists
   * somewhere but is not what will be measured, and saying so is the point.
   */
  private canvasResolution(answer: FontResolution): FontResolution {
    if (!answer.resource) return answer;

    const measuredAs = this.installedFonts.get(answer.resource.id);
    if (measuredAs) return { ...answer, measuredAs };

    const { resource: _resource, ...rest } = answer;
    return { ...rest, resolved: { ...answer.resolved, source: "generic", portable: false } };
  }

  private newFontResolver(): LayoutFontResolver | null {
    const provider = this.opts.fonts;
    return provider ? createLayoutFontResolver({
      defaultRequest: () => provider.defaultRequest(),
      prepare: (requests, constraints) => provider.prepare(requests, constraints),
      resolve: (request, constraints) => this.canvasResolution(provider.resolve(request, constraints)),
    }) : null;
  }

  /**
   * Install whatever these requests resolve to, and publish the set in one go.
   *
   * Each install is a separate await and `installedFonts` is what
   * `canvasResolution` reads, so a set that filled in place would answer for
   * the faces that had landed and degrade the rest — measuring one line
   * against two typefaces and placing its runs from both.
   *
   * Two batches can be in flight at once (the first layout queues one while
   * the document's own is still running), so a face already being installed is
   * awaited rather than installed again — the id is what dedupes, because a
   * provider may hand back a fresh resource object each call.
   */
  private async installFaces(requests: readonly FontRequest[]): Promise<boolean> {
    const provider = this.opts.fonts;
    if (!provider) return false;

    const wanted = new Map<string, FontResource>();
    for (const request of requests) {
      const resource = provider.resolve(request).resource;
      if (resource && !this.installedFonts.has(resource.id)) wanted.set(resource.id, resource);
    }

    const landed = new Map<string, string>();
    for (const [id, resource] of wanted) {
      let pending = this.installing.get(id);
      if (!pending) {
        this.attemptedFonts.add(id);
        pending = this.installOne(resource);
        this.installing.set(id, pending);
        const settled = pending;
        void settled.finally(() => {
          if (this.installing.get(id) === settled) this.installing.delete(id);
        });
      }
      const family = await pending;
      if (family !== null) landed.set(id, family);
    }

    if (this.disposed) return false;
    for (const [id, family] of landed) this.installedFonts.set(id, family);
    return landed.size > 0;
  }

  /**
   * One face into the measurement backend. A failure is an answer, not an
   * error: the face resolves as generic and is reported, and a later layout
   * may find the bytes reachable.
   */
  private async installOne(resource: FontResource): Promise<string | null> {
    try {
      const install = this.opts.measurer.installFont;
      if (!install) return null;
      return (await install.call(this.opts.measurer, resource)) || null;
    } catch {
      return null;
    }
  }

  /**
   * Every face this document paints, body and chrome.
   *
   * The document names most of them and can be read without measuring, which
   * is what lets them be installed before anything is laid out for the screen.
   * The resolver's table adds what only a layout knows — a header's face lives
   * in a doc attribute, not in the node tree, so a walk of the document alone
   * would miss it.
   */
  private documentFontRequests(): readonly FontRequest[] {
    const provider = this.opts.fonts;
    if (!provider) return [];
    const fromDocument = collectFontRequests(this.opts.getDoc(), provider.defaultRequest());
    const fromLayout = [...(this.fontResolverValue?.table().values() ?? [])].map((r) => r.request);
    // Duplicates are free: `installFaces` keys by resource id.
    return [...fromDocument, ...fromLayout];
  }

  /**
   * Hold the document until the faces it is written in are installed.
   *
   * Only before it has ever been shown. Once it is on screen a missing face is
   * handled the way it always was — installed in the background, then a normal
   * re-layout — because blocking a document the user is already reading, or
   * throwing its layout away to rebuild from the first chunk, is worse than
   * the swap it would avoid.
   *
   * Bounded: a provider that never settles must not leave the editor unable to
   * paint. When the wait runs out the document is shown against whatever the
   * host substitutes.
   */
  private holdForDocumentFonts(): void {
    if (this.disposed || this.shownOnce || !this.fontsReady) return;
    const provider = this.opts.fonts;
    if (!provider) return;

    const requests = this.documentFontRequests();
    const missing = requests.some((request) => {
      const resource = provider.resolve(request).resource;
      return (
        !!resource && !this.installedFonts.has(resource.id) && !this.attemptedFonts.has(resource.id)
      );
    });
    // Nothing to wait for: never report a document as unready for no reason.
    if (!missing) return;

    this.fontsReady = false;
    this.fontWaitTimer = setTimeout(
      () => this.openFontGate(),
      LayoutCoordinator.FONT_WAIT_MS,
    ) as unknown as number;
    void this.installDocumentFonts(requests);
  }

  private async installDocumentFonts(requests: readonly FontRequest[]): Promise<void> {
    try {
      await this.opts.fonts?.prepare(requests);
      if (await this.installFaces(requests)) {
        this.fontResolverValue = this.newFontResolver();
        this.measureCache = new WeakMap();
        this.opts.measurer.invalidate();
      }
    } catch {
      // A provider may reject. The document is shown against what resolved,
      // and the shortfall is reported by the export lane as it always was.
    } finally {
      this.openFontGate();
    }
  }

  /** Let the document be shown. Idempotent: the wait and its timer race. */
  private openFontGate(): void {
    if (this.fontWaitTimer !== null) {
      clearTimeout(this.fontWaitTimer);
      this.fontWaitTimer = null;
    }
    if (this.disposed || this.fontsReady) return;
    this.fontsReady = true;
    this.reveal();
  }

  private async prepareFonts(): Promise<void> {
    if (this.disposed || !this.opts.fonts || !this.fontResolverValue) return;
    if (this.preparingFonts) { this.fontPreparationPending = true; return; }
    this.preparingFonts = true;
    try {
      const requests = [...this.fontResolverValue.table().values()].map(r => r.request);
      await this.opts.fonts.prepare(requests);
      await this.installFaces(requests);
      if (this.disposed) return;
      const changed = [...this.fontResolverValue.table().values()].some(old => {
        const current = this.canvasResolution(this.opts.fonts!.resolve(old.request));
        return (
          current.resource?.id !== old.resource?.id ||
          current.measuredAs !== old.measuredAs ||
          current.resolved.family !== old.resolved.family ||
          current.resolved.source !== old.resolved.source ||
          current.resolved.portable !== old.resolved.portable
        );
      });
      if (changed) {
        this.fontResolverValue = this.newFontResolver();
        this.measureCache = new WeakMap();
        this.opts.measurer.invalidate();
        this.cancelIdleLayout();
        this.dirty = true;
        this.opts.onUpdate();
      }
    } catch {
      // A custom provider may reject preparation. Keep the honest generic
      // layout; a later provider notification or layout can retry.
      this.fontPreparationPending = false;
    } finally {
      this.preparingFonts = false;
      if (this.fontPreparationPending) {
        this.fontPreparationPending = false;
        queueMicrotask(() => { void this.prepareFonts(); });
      }
    }
  }

  /**
   * The resolver this coordinator measures with, for a caller that has to lay
   * something out the same way — a header being edited, whose geometry must
   * match the one stored for it.
   */
  get fontResolver(): LayoutFontResolver | null {
    return this.fontResolverValue;
  }

  /** A new, uncached layout for a captured document and an export's measurer. */
  layoutForExport(doc: Node, fonts: LayoutFontResolver, measurer: TextMeasurerLike = this.opts.measurer): DocumentLayout {
    return runPipeline(doc, {
      pageConfig: this.opts.pageConfig, fontConfig: this.opts.fontConfig,
      measurer, fonts, fontModifiers: this.opts.fontModifiers,
      pageChromeContributions: this.opts.getPageChromeContributions?.() ?? [],
      ...(this.opts.inlineRegistry ? { inlineRegistry: this.opts.inlineRegistry } : {}),
    });
  }

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
    this.fontResolverValue = this.newFontResolver();
    const unsubscribe = opts.fonts?.subscribe?.(() => { void this.prepareFonts(); });
    if (unsubscribe) this.unsubscribeFonts = unsubscribe;

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

    // After the first layout, not before it: `reveal()` reads `this.layout`,
    // and the resolver's table is what knows the faces a header uses.
    this.holdForDocumentFonts();
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
    this.layoutResumption = null;
    this.charMap.clear();
    this.populatedPages.clear();
    // From scratch: no `previousLayout`, or pagination's early-termination
    // copies the partial's truncated tail. measureCache still speeds measuring.
    this.layout = this.runLayout({ previousVersion: prev.version });
    this.layoutIsPartial = this.layout.isPartial ?? false; // read, don't force false
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
   * Ensure every page touched by a document range has CharacterMap entries.
   * Unlike CharacterMap.coordsAtPos(), this uses the layout index and therefore
   * cannot mistake the last glyph on an already-populated page for the target.
   */
  ensureRangePopulated(from: number, to: number): boolean {
    const docSize = this.opts.getDoc().content.size;
    if (from < 0 || to < from || to > docSize) return false;

    let pages = this.pagesTouchingRange(from, to);
    const fromLocated = this.pagesTouchingRange(from, from).length > 0;
    const toLocated = this.pagesTouchingRange(to, to).length > 0;

    // A streamed layout may contain the start of a long range but not its end.
    if (this.layoutIsPartial && (!fromLocated || !toLocated)) {
      this.ensureFullLayout();
      pages = this.pagesTouchingRange(from, to);
    }

    if (pages.length === 0) return false;
    for (const page of pages) this.ensurePagePopulated(page);
    return true;
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
    this.collabReady = ready;
    if (ready) {
      // The document that just synced is not the one this coordinator was
      // constructed with — an empty placeholder usually — so its faces are
      // only knowable now, and this is still before the document has been
      // shown. `holdForDocumentFonts` declines once it has.
      this.holdForDocumentFonts();
      this.reveal();
    } else {
      this.cancelIdleLayout();
      this.layoutIsPartial = false;
    }
  }

  /**
   * Lay the document out and paint it, now that nothing is holding it back.
   * A no-op while the other gate is still closed, so whichever finishes last
   * is the one that shows the document.
   */
  private reveal(): void {
    if (!this.ready) return;
    this.shownOnce = true;
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
  }


  /** Cancel all pending async work. Call from Editor.destroy(). */
  destroy(): void {
    this.disposed = true;
    if (this.fontWaitTimer !== null) {
      clearTimeout(this.fontWaitTimer);
      this.fontWaitTimer = null;
    }
    this.unsubscribeFonts?.();
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
    // Every layout assignment routes through here, so this is the one place
    // the charmap's generation can be kept honest. Pages populate lazily
    // afterwards, but they can only populate from this layout — `clear()`
    // above each assignment took the previous one's geometry with it.
    this.charMap.setGeneration(this.layout.version);

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

  private pagesTouchingRange(from: number, to: number): number[] {
    const pages = new Set<number>();
    for (const entry of this.fragmentIndex) {
      const touches =
        from === to
          ? entry.start <= from && entry.end >= from
          : entry.end >= from && entry.start <= to;
      if (touches) pages.add(entry.page);
    }
    return [...pages];
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
    queueMicrotask(() => { void this.prepareFonts(); });
    return runPipeline(this.opts.getDoc(), {
      pageConfig: this.opts.pageConfig,
      fontConfig: this.opts.fontConfig,
      measurer: this.opts.measurer,
      fontModifiers: this.opts.fontModifiers,
      measureCache: this.measureCache,
      ...(this.fontResolverValue ? { fonts: this.fontResolverValue } : {}),
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
