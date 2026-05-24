/**
 * HeaderFooter extension — adds configurable headers and footers to Scrivr.
 *
 * Registers:
 *   - doc attr "headerFooter" (HeaderFooterPolicy | null)
 *   - Inline atom nodes: pageNumber, totalPages, date
 *   - Page chrome contribution (measure + render)
 *   - Commands: setHeaderFooter, updateHeaderFooter, removeHeaderFooter
 *
 * Feature flag is extension presence — when absent, zero overhead.
 */

import { Extension, renderCursor } from "@scrivr/core";
import type { IBaseEditor, IEditor, EditorSurface } from "@scrivr/core";
import { TextSelection } from "prosemirror-state";
import type { HeaderFooterPolicy, HeaderFooterDefinition } from "./types";
import { getHeaderFooterPolicy } from "./getPolicy";
import { resolveChrome } from "./resolveChrome";
import type { ResolvedHeaderFooter } from "./resolveChrome";
import { drawPageChrome } from "./drawPageChrome";
import { pageNumberNode, totalPagesNode, dateNode } from "./tokens";
import {
  renderHeaderFooterPdf,
  renderPageNumberPdf,
  renderTotalPagesPdf,
  renderDatePdf,
} from "./pdfExport";
import { pageNumberStrategy, totalPagesStrategy, dateStrategy } from "./tokenStrategies";
import { HeaderFooterSurfaceCache } from "./surfaces";
import type { SlotKey } from "./surfaces";
import { ensurePolicy } from "./HeaderFooterController";

interface CursorManagerLike { isVisible: boolean; resetSilent(): void }

function isCursorManagerLike(value: unknown): value is CursorManagerLike {
  if (typeof value !== "object" || value === null) return false;
  return (
    "isVisible" in value && typeof (value as { isVisible: unknown }).isVisible === "boolean" &&
    "resetSilent" in value && typeof (value as { resetSilent: unknown }).resetSilent === "function"
  );
}

function getCursorManager(editor: IBaseEditor): CursorManagerLike | null {
  if (!("cursorManager" in editor)) return null;
  const cm = editor.cursorManager;
  return isCursorManagerLike(cm) ? cm : null;
}

function isCursorVisible(editor: IBaseEditor): boolean {
  return getCursorManager(editor)?.isVisible ?? true;
}

/**
 * Cached active surface info — set by onUpdate/onSurfaceChange, read by
 * measure() so live header/footer edits affect chrome height without being
 * committed on every keystroke.
 */
type LiveSurface = { slotKey: SlotKey; surface: EditorSurface };

function createEmptySlot(): HeaderFooterDefinition {
  return {
    content: { type: "doc", content: [{ type: "paragraph" }] },
  };
}

function updateLiveSurfaceCache(editor: IEditor): void {
  const entry = editorEntries.get(editor);
  if (!entry) return;

  const surface = editor.surfaces.activeSurface;
  if (surface && surface.owner === "headerFooter") {
    const slotKey = HeaderFooterSurfaceCache.slotKeyFromId(surface.id);
    entry.liveSurface = slotKey ? { slotKey, surface } : null;
    return;
  }

  entry.liveSurface = null;
}

function liveSurfaceForDoc(doc: unknown): LiveSurface | null {
  for (const entry of editorEntries.values()) {
    if (entry.editor.getState().doc === doc) return entry.liveSurface;
  }
  return null;
}

/**
 * If a header/footer surface is active, replace its slot's content in the
 * policy with the live surface doc. This makes measure() compute the correct
 * height as the user types — the band grows instead of clipping.
 *
 * Ribbon-height gap reservation lives in `resolveChrome.measureSlot` so the
 * body sits at the same position whether or not a surface is active —
 * activating the band no longer pushes content down.
 */
function policyWithLiveSurface(policy: HeaderFooterPolicy, doc: unknown): HeaderFooterPolicy {
  const liveSurface = liveSurfaceForDoc(doc);
  if (!liveSurface) return policy;

  const currentSlot = policy[liveSurface.slotKey];
  if (!currentSlot) return policy;

  return {
    ...policy,
    [liveSurface.slotKey]: {
      ...currentSlot,
      content: liveSurface.surface.state.doc.toJSON(),
    },
  };
}

function slotBand(slotKey: SlotKey): "header" | "footer" {
  return slotKey.includes("Header") ? "header" : "footer";
}

function slotForPage(
  policy: HeaderFooterPolicy,
  page: number,
  band: "header" | "footer",
): SlotKey {
  // differentOddEven is reserved in the policy model but has no slot storage
  // in v1. Keep routing explicit until odd/even slots are added end-to-end.
  const useFirstPage = page === 1 && policy.differentFirstPage;
  if (band === "header") return useFirstPage ? "firstPageHeader" : "defaultHeader";
  return useFirstPage ? "firstPageFooter" : "defaultFooter";
}

function sameContent(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function surfaceContent(surface: EditorSurface): HeaderFooterDefinition["content"] {
  return surface.toDocJSON() as unknown as HeaderFooterDefinition["content"];
}

function syncSurfaceContent(
  surface: EditorSurface,
  content: HeaderFooterDefinition["content"],
): void {
  if (sameContent(surface.toDocJSON(), content)) return;

  const nextDoc = surface.schema.nodeFromJSON(content);
  let tr = surface.state.tr.replaceWith(0, surface.state.doc.content.size, nextDoc.content);
  const head = Math.min(surface.state.selection.head, tr.doc.content.size);
  tr = tr
    .setSelection(TextSelection.near(tr.doc.resolve(head)))
    .setMeta("addToHistory", false);
  surface.dispatch(tr);
  surface.markClean();
}

function updateHeaderFooterPolicy(
  editor: IEditor,
  updater: (policy: HeaderFooterPolicy) => HeaderFooterPolicy | null,
): boolean {
  const state = editor.getState();
  const policy = getHeaderFooterPolicy(state.doc);
  if (!policy) return false;

  const nextPolicy = updater(policy);
  if (!nextPolicy) return false;

  editor.applyTransaction(state.tr.setDocAttribute("headerFooter", nextPolicy));
  return true;
}

function isResolvedHeaderFooter(value: unknown): value is ResolvedHeaderFooter {
  if (typeof value !== "object" || value === null) return false;
  return "policy" in value && "slots" in value;
}

/**
 * Placeholder policy used to reserve a clickable strip at the top + bottom
 * of every page when the extension is loaded but no real policy has been
 * written to the doc yet. Mirrors Word/Docs: the band is visibly empty but
 * present, so the user can see where to double-click. The first margin
 * double-click upgrades this ghost into a real policy via ensurePolicy().
 */
const GHOST_POLICY: HeaderFooterPolicy = {
  enabled: true,
  differentFirstPage: false,
  differentOddEven: false,
  defaultHeader: { content: { type: "doc", content: [{ type: "paragraph" }] } },
  defaultFooter: { content: { type: "doc", content: [{ type: "paragraph" }] } },
};

export interface HeaderFooterOptions {
  /**
   * Pixels reserved between header/footer content and body for an
   * editing affordance (e.g. the React `HeaderFooterRibbon`).
   *
   * **Applied once at layout time, not at render time.** The value
   * flows through `resolveChrome.measureSlot` and is baked into
   * `slot.reservedHeight` + `metrics.contentTop` when the layout is
   * built. Every downstream consumer — canvas paint, PDF chrome
   * render, anything reading `editor.layout` — sees the same baked
   * value. There is no per-render override: to change the gap you
   * change this option and re-layout (which happens automatically
   * when an extension is reconfigured at editor construction).
   *
   * Acts as a floor on `slot.margin`. Slot margins smaller than this
   * are clamped up at measure time so activating a surface does not
   * push body content down. Margins larger than the gap are honored
   * as-is.
   *
   * Pick the value at editor construction:
   *
   *   React, default `HeaderFooterRibbon`   → 28 (default)
   *   React, custom ribbon                  → ribbon height
   *   Headless `ServerEditor` for PDF /     → 0 (no UI to reserve for,
   *     non-React render                      no whitespace in print)
   *
   * **Dual-use editor caveat.** A single browser `Editor` used for
   * both interactive editing *and* PDF export can only carry one
   * value — the same layout drives both. Configure for the editing
   * case (so the ribbon doesn't push content) and accept the same
   * gap in the exported PDF. Consumers that need a ribbon-friendly
   * editor *and* a tight printed PDF should run PDF export against a
   * separate `ServerEditor` constructed with `activeEditingGap: 0`,
   * sharing the same doc JSON.
   *
   * **Single source of truth.** The `@scrivr/react` `HeaderFooterRibbon`
   * sizes itself from this value (via `useHeaderFooterRibbon`, which
   * calls `editor.findExtension("headerFooter")` and reads
   * `options.activeEditingGap`). Change the option and the ribbon's
   * `height` + the body's reserved gap move together — no separate
   * hardcoded constant to keep in sync. A custom React ribbon
   * consumer that wants a different height passes it here; the React
   * hook propagates it.
   */
  activeEditingGap: number;
}

const DEFAULT_ACTIVE_EDITING_GAP = 28;

declare module "@scrivr/core" {
  interface Commands<ReturnType> {
    headerFooter: {
      /** Set the full header/footer policy. */
      setHeaderFooter: (policy: HeaderFooterPolicy) => ReturnType;
      /** Merge a partial update into the current policy. No-op if no policy is set. */
      updateHeaderFooter: (partial: Partial<HeaderFooterPolicy>) => ReturnType;
      /** Remove the header/footer policy entirely. */
      removeHeaderFooter: () => ReturnType;
      /** Insert a page number token at the cursor. Only works in an active surface. */
      insertPageNumber: () => ReturnType;
      /** Insert a total pages token at the cursor. Only works in an active surface. */
      insertTotalPages: () => ReturnType;
      /** Insert a date token at the cursor. Only works in an active surface. */
      insertDate: () => ReturnType;
    };
  }

  interface NodeAttributes {
    doc: { headerFooter: HeaderFooterPolicy | null };
  }
}

/**
 * Position the cursor in a surface near the given click coordinates.
 * Polls rAF until the charMap is populated by the paint cycle (max 10 frames).
 */
function placeCursorAfterPaint(
  surface: EditorSurface,
  x: number,
  y: number,
  page: number,
): void {
  let attempts = 0;
  const fallback = () => {
    const pos = Math.min(1, surface.state.doc.content.size);
    const $pos = surface.state.doc.resolve(pos);
    surface.dispatch(surface.state.tr.setSelection(TextSelection.near($pos)));
  };

  const poll = () => {
    const pos = surface.charMap.posAtCoords(x, y, page);
    if (pos > 0) {
      const clamped = Math.min(pos, surface.state.doc.content.size);
      const $pos = surface.state.doc.resolve(clamped);
      surface.dispatch(surface.state.tr.setSelection(TextSelection.near($pos)));
      return;
    }

    if (attempts++ < 10) {
      requestAnimationFrame(poll);
      return;
    }

    fallback();
  };
  requestAnimationFrame(poll);
}

/** Per-editor state. Uses a Map (not WeakMap) because onCommit needs iteration. */
interface EditorEntry {
  editor: IEditor;
  cache: HeaderFooterSurfaceCache;
  /** The page where the header/footer is being edited. Only this page shows the live surface. */
  activePage: number;
  liveSurface: LiveSurface | null;
}
const editorEntries = new Map<IEditor, EditorEntry>();


export const HeaderFooter = Extension.create<HeaderFooterOptions>({
  name: "headerFooter",

  defaultOptions: {
    activeEditingGap: DEFAULT_ACTIVE_EDITING_GAP,
  },

  addDocAttrs() {
    return {
      headerFooter: { default: null },
    };
  },

  addExports() {
    return {
      pdf: {
        nodes: {
          pageNumber: renderPageNumberPdf,
          totalPages: renderTotalPagesPdf,
          date: renderDatePdf,
        },
        chrome: {
          headerFooter: renderHeaderFooterPdf,
        },
      },
    };
  },

  addNodes() {
    return {
      pageNumber: pageNumberNode,
      totalPages: totalPagesNode,
      date: dateNode,
    };
  },

  addInlineHandlers() {
    return {
      pageNumber: pageNumberStrategy,
      totalPages: totalPagesStrategy,
      date: dateStrategy,
    };
  },

  addPageChrome() {
    // Capture in the closure — `measure` is a sub-method whose `this`
    // is the returned chrome object, not the extension context.
    const { activeEditingGap } = this.options;
    return {
      name: "headerFooter",

      measure(input, ctx) {
        if (input.pageConfig.pageless) {
          return { topForPage: () => 0, bottomForPage: () => 0, stable: true };
        }
        const policy = getHeaderFooterPolicy(input.doc);
        if (policy?.enabled) {
          // If a surface is active, build a policy with the live content so
          // the reserved height grows as the user types.
          const livePolicy = policyWithLiveSurface(policy, input.doc);
          return resolveChrome(livePolicy, input, ctx, activeEditingGap);
        }
        // No real policy yet — reserve a default empty-slot band so the
        // affordance is visible and clickable. The first margin double-click
        // upgrades this ghost into a real policy via ensurePolicy().
        return resolveChrome(GHOST_POLICY, input, ctx, activeEditingGap);
      },

      render(ctx) {
        if (!isResolvedHeaderFooter(ctx.payload)) return;
        let activeSurface = null;
        let activePage = 0;
        for (const entry of editorEntries.values()) {
          const surface = entry.editor.surfaces.activeSurface;
          if (surface && surface.owner === "headerFooter") {
            activeSurface = surface;
            activePage = entry.activePage;
            break;
          }
        }
        drawPageChrome({ ctx, resolved: ctx.payload, activeSurface, activePage });
      },
    };
  },

  addCommands() {
    return {
      setHeaderFooter: (policy: HeaderFooterPolicy) => (state, dispatch) => {
        if (dispatch) dispatch(state.tr.setDocAttribute("headerFooter", policy));
        return true;
      },

      updateHeaderFooter: (partial: Partial<HeaderFooterPolicy>) => (state, dispatch) => {
        const current = getHeaderFooterPolicy(state.doc);
        if (!current) return false;
        if (dispatch)
          dispatch(state.tr.setDocAttribute("headerFooter", { ...current, ...partial }));
        return true;
      },

      removeHeaderFooter: () => (state, dispatch) => {
        if (dispatch) dispatch(state.tr.setDocAttribute("headerFooter", null));
        return true;
      },

      insertPageNumber: () => (state, dispatch) => {
        const nodeType = state.schema.nodes["pageNumber"];
        if (!nodeType) return false;
        if (dispatch) dispatch(state.tr.replaceSelectionWith(nodeType.create()));
        return true;
      },

      insertTotalPages: () => (state, dispatch) => {
        const nodeType = state.schema.nodes["totalPages"];
        if (!nodeType) return false;
        if (dispatch) dispatch(state.tr.replaceSelectionWith(nodeType.create()));
        return true;
      },

      insertDate: () => (state, dispatch) => {
        const nodeType = state.schema.nodes["date"];
        if (!nodeType) return false;
        if (dispatch) dispatch(state.tr.replaceSelectionWith(nodeType.create()));
        return true;
      },
    };
  },

  addSurfaceOwner() {
    return {
      owner: "headerFooter",
      onCommit(surface) {
        const slotKey = HeaderFooterSurfaceCache.slotKeyFromId(surface.id);
        if (!slotKey) return;

        for (const entry of editorEntries.values()) {
          const existing = entry.cache.get(slotKey);
          if (existing !== surface) continue;

          const policy = getHeaderFooterPolicy(entry.editor.getState().doc);
          if (!policy) return;

          const updatedContent = surface.toDocJSON();
          updateHeaderFooterPolicy(entry.editor, (currentPolicy) => {
            const currentSlot = currentPolicy[slotKey];
            if (!currentSlot) return null;
            return {
              ...currentPolicy,
              [slotKey]: { ...currentSlot, content: updatedContent },
            };
          });
          surface.markClean();
          return;
        }
      },
    };
  },

  onViewReady(editor: IEditor) {
    // Header/footer surface activation needs overlay rendering + the
    // surface registry + chrome-band click routing — all view-only.
    const cache = new HeaderFooterSurfaceCache(editor.schema);
    editorEntries.set(editor, { editor, cache, activePage: 0, liveSurface: null });

    const registerSurfaceIfNeeded = (slotKey: SlotKey, def: HeaderFooterDefinition): EditorSurface => {
      const existing = cache.get(slotKey);
      if (existing) return existing;

      const surface = cache.getOrCreate(slotKey, def);
      surface.onUpdate(({ docChanged }) => {
        getCursorManager(editor)?.resetSilent();
        updateLiveSurfaceCache(editor);
        if (docChanged) {
          editor.invalidateLayout();
        } else {
          editor.redraw();
        }
      });
      editor.surfaces.register(surface);
      return surface;
    };

    let reconcilingSurface = false;
    const reconcileActiveSurface = (): void => {
      if (reconcilingSurface) return;

      const active = editor.surfaces.activeSurface;
      if (!active || active.owner !== "headerFooter") return;

      const entry = editorEntries.get(editor);
      const activeSlot = HeaderFooterSurfaceCache.slotKeyFromId(active.id);
      const policy = getHeaderFooterPolicy(editor.getState().doc);
      if (!entry || !activeSlot || !policy?.enabled) return;

      const desiredSlot = slotForPage(policy, entry.activePage, slotBand(activeSlot));
      if (desiredSlot === activeSlot) return;

      reconcilingSurface = true;
      try {
        const liveContent = surfaceContent(active);
        const currentDef = policy[desiredSlot] ?? createEmptySlot();
        let desiredDef = currentDef;

        if (!sameContent(currentDef.content, liveContent)) {
          updateHeaderFooterPolicy(editor, (currentPolicy) => {
            const latestDef = currentPolicy[desiredSlot] ?? createEmptySlot();
            desiredDef = { ...latestDef, content: liveContent };
            return {
              ...currentPolicy,
              [desiredSlot]: desiredDef,
            };
          });
        }

        const nextSurface = registerSurfaceIfNeeded(desiredSlot, desiredDef);
        syncSurfaceContent(nextSurface, desiredDef.content);
        editor.surfaces.activate(nextSurface.id);
        updateLiveSurfaceCache(editor);
        editor.invalidateLayout();
      } finally {
        reconcilingSurface = false;
      }
    };

    // Overlay handler — draws the blinking cursor in the active header/footer band.
    // Runs on the overlay canvas which repaints on blink ticks, so the cursor blinks.
    // CharMap coords are in page space (same as body) — no offset needed.
    const unsubOverlay = editor.addOverlayRenderHandler((ctx, pageNumber, _pageConfig, _charMap, theme) => {
      const active = editor.surfaces.activeSurface;
      if (!active || active.owner !== "headerFooter") return;

      const entry = editorEntries.get(editor);
      if (!entry || pageNumber !== entry.activePage) return;

      if (!isCursorVisible(editor)) return;

      const head = active.state.selection.head;
      const coords = active.charMap.coordsAtPos(head, pageNumber);
      if (!coords) return;

      renderCursor(ctx, coords, theme.cursor);
    });

    // Listen for clicks in chrome bands to activate header/footer editing
    const unsubChromeClick = editor.on("chromeClick", ({ band, page, x, y, clickCount }) => {
      // Only double-click activates. Single clicks in an active surface fall
      // through to PointerController's normal click/drag logic, which routes
      // through editor.charMap and editor.selection (both surface-aware).
      // Single clicks in the margin with no surface active are also a no-op —
      // we don't want to spawn a band on accidental single clicks.
      if (clickCount !== 2) return;

      // Bootstrap a policy on first margin double-click (Word/Docs UX). When
      // the doc has no policy yet, TileManager widens the hit test to fall
      // back to the page's layout margins so this event still fires.
      const existing = getHeaderFooterPolicy(editor.getState().doc);
      let policy: HeaderFooterPolicy;
      if (existing?.enabled) {
        policy = existing;
      } else {
        // ensurePolicy returns the existing policy unchanged when present, so
        // force enabled: true if a disabled policy is lingering on the doc.
        const ensured = ensurePolicy(editor);
        if (!ensured.enabled) {
          policy = { ...ensured, enabled: true };
          const tr = editor.getState().tr.setDocAttribute("headerFooter", policy);
          editor.applyTransaction(tr);
        } else {
          policy = ensured;
        }
      }

      const slotKey = slotForPage(policy, page, band);

      let def = policy[slotKey];
      if (!def) {
        // First-page slot wasn't pre-seeded — create a default empty doc and
        // write it back so the surface cache + activation flow has something
        // to anchor to.
        def = createEmptySlot();
        policy = { ...policy, [slotKey]: def };
        const tr = editor.getState().tr.setDocAttribute("headerFooter", policy);
        editor.applyTransaction(tr);
      }

      const surface = registerSurfaceIfNeeded(slotKey, def);

      editor.surfaces.activate(surface.id);
      const entry = editorEntries.get(editor);
      if (entry) entry.activePage = page;
      updateLiveSurfaceCache(editor);
      editor.redraw();

      placeCursorAfterPaint(surface, x, y, page);
    });

    const unsubSurfaceChange = editor.surfaces.onSurfaceChange((prevId, nextId) => {
      const touchedHeaderFooter =
        (prevId !== null && HeaderFooterSurfaceCache.slotKeyFromId(prevId) !== null) ||
        (nextId !== null && HeaderFooterSurfaceCache.slotKeyFromId(nextId) !== null);
      if (!touchedHeaderFooter) return;
      updateLiveSurfaceCache(editor);
      editor.invalidateLayout();
    });
    const unsubEditor = editor.subscribe(reconcileActiveSurface);

    return () => {
      unsubOverlay();
      unsubChromeClick();
      unsubSurfaceChange();
      unsubEditor();
      for (const surface of cache.all()) {
        editor.surfaces.unregister(surface.id);
      }
      editorEntries.delete(editor);
    };
  },

  addKeymap() {
    return {
      Escape: () => {
        for (const entry of editorEntries.values()) {
          const active = entry.editor.surfaces.activeSurface;
          if (!active || active.owner !== "headerFooter") continue;
          // Deactivate — triggers onCommit if dirty
          entry.editor.surfaces.activate(null);
          updateLiveSurfaceCache(entry.editor);
          return true;
        }
        return false;
      },
    };
  },
});
