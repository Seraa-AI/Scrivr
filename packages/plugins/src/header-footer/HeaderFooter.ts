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

import { Extension } from "@scrivr/core";
import type { IEditor, IBaseEditor, EditorSurface } from "@scrivr/core";
import type { Node } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import type { HeaderFooterPolicy } from "./types";
import { resolveChrome } from "./resolveChrome";
import type { ResolvedHeaderFooter } from "./resolveChrome";
import { drawPageChrome } from "./drawPageChrome";
import { pageNumberNode, totalPagesNode, dateNode } from "./tokens";
import { HeaderFooterSurfaceCache } from "./surfaces";
import type { SlotKey } from "./surfaces";

/** Runtime check: does this editor have surfaces + layout (view Editor, not ServerEditor)? */
function isViewEditor(editor: IBaseEditor): editor is IEditor {
  return "surfaces" in editor && "layout" in editor;
}

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
 * If a header/footer surface is active, replace its slot's content in the
 * policy with the live surface doc. This makes measure() compute the correct
 * height as the user types — the band grows instead of clipping.
 */
function policyWithLiveSurface(policy: HeaderFooterPolicy): HeaderFooterPolicy {
  for (const entry of editorEntries.values()) {
    const surface = entry.editor.surfaces.activeSurface;
    if (!surface || surface.owner !== "headerFooter") continue;

    const slotKey = HeaderFooterSurfaceCache.slotKeyFromId(surface.id);
    if (!slotKey) continue;

    const currentSlot = policy[slotKey];
    if (!currentSlot) continue;

    return {
      ...policy,
      [slotKey]: {
        ...currentSlot,
        content: surface.state.doc.toJSON(),
      },
    };
  }
  return policy;
}

function isResolvedHeaderFooter(value: unknown): value is ResolvedHeaderFooter {
  if (typeof value !== "object" || value === null) return false;
  return "policy" in value && "slots" in value;
}

/** Read the headerFooter policy from doc.attrs with shape validation. */
function getHeaderFooterPolicy(doc: Node): HeaderFooterPolicy | null {
  if (!("headerFooter" in doc.attrs)) return null;
  const val = doc.attrs["headerFooter"];
  if (typeof val !== "object" || val === null) return null;
  if (!("enabled" in val)) return null;
  return val as HeaderFooterPolicy;
}

declare module "@scrivr/core" {
  interface Commands<ReturnType> {
    headerFooter: {
      /** Set the full header/footer policy. */
      setHeaderFooter: (policy: HeaderFooterPolicy) => ReturnType;
      /** Merge a partial update into the current policy. No-op if no policy is set. */
      updateHeaderFooter: (partial: Partial<HeaderFooterPolicy>) => ReturnType;
      /** Remove the header/footer policy entirely. */
      removeHeaderFooter: () => ReturnType;
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
  const poll = () => {
    // Position 1 is the first text position (0 is the doc node boundary)
    if (surface.charMap.hasGlyph(1)) {
      const pos = surface.charMap.posAtCoords(x, y, page);
      const clamped = Math.min(pos, surface.state.doc.content.size);
      const $pos = surface.state.doc.resolve(clamped);
      surface.dispatch(surface.state.tr.setSelection(TextSelection.near($pos)));
      return;
    }
    if (attempts++ < 10) requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
}

/** Per-editor state. Uses a Map (not WeakMap) because onCommit needs iteration. */
interface EditorEntry {
  editor: IEditor;
  cache: HeaderFooterSurfaceCache;
  /** The page where the header/footer is being edited. Only this page shows the live surface. */
  activePage: number;
}
const editorEntries = new Map<IEditor, EditorEntry>();


export const HeaderFooter = Extension.create({
  name: "headerFooter",

  addDocAttrs() {
    return {
      headerFooter: { default: null },
    };
  },

  addNodes() {
    return {
      pageNumber: pageNumberNode,
      totalPages: totalPagesNode,
      date: dateNode,
    };
  },

  addPageChrome() {
    return {
      name: "headerFooter",

      measure(input, ctx) {
        const policy = getHeaderFooterPolicy(input.doc);
        if (!policy?.enabled || input.pageConfig.pageless) {
          return { topForPage: () => 0, bottomForPage: () => 0, stable: true };
        }
        // If a surface is active, build a policy with the live content so
        // the reserved height grows as the user types.
        const livePolicy = policyWithLiveSurface(policy);
        return resolveChrome(livePolicy, input, ctx);
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

          const currentSlot = policy[slotKey];
          if (!currentSlot) return;

          const updatedContent = surface.toDocJSON();
          const updatedPolicy = {
            ...policy,
            [slotKey]: { ...currentSlot, content: updatedContent },
          };

          const tr = entry.editor.getState().tr.setDocAttribute("headerFooter", updatedPolicy);
          entry.editor._applyTransaction(tr);
          surface.markClean();
          return;
        }
      },
    };
  },

  onEditorReady(baseEditor) {
    if (!isViewEditor(baseEditor)) return;
    const editor = baseEditor;
    const cache = new HeaderFooterSurfaceCache(editor.schema);
    editorEntries.set(editor, { editor, cache, activePage: 0 });

    // Overlay handler — draws the blinking cursor in the active header/footer band.
    // Runs on the overlay canvas which repaints on blink ticks, so the cursor blinks.
    // CharMap coords are in page space (same as body) — no offset needed.
    const unsubOverlay = editor.addOverlayRenderHandler((ctx, pageNumber) => {
      const active = editor.surfaces.activeSurface;
      if (!active || active.owner !== "headerFooter") return;

      const entry = editorEntries.get(editor);
      if (!entry || pageNumber !== entry.activePage) return;

      if (!isCursorVisible(editor)) return;

      const head = active.state.selection.head;
      const coords = active.charMap.coordsAtPos(head, pageNumber);
      if (!coords) return;

      ctx.fillStyle = "#1e293b";
      ctx.fillRect(coords.x, coords.y, 1.5, coords.height);
    });

    // Listen for clicks in chrome bands to activate header/footer editing
    const unsubChromeClick = editor.on("chromeClick", ({ band, page, x, y, clickCount }) => {
      const policy = getHeaderFooterPolicy(editor.getState().doc);
      if (!policy?.enabled) return;

      const isFirstPage = page === 1 && policy.differentFirstPage;
      let slotKey: SlotKey;
      if (band === "header") {
        slotKey = isFirstPage ? "firstPageHeader" : "defaultHeader";
      } else {
        slotKey = isFirstPage ? "firstPageFooter" : "defaultFooter";
      }

      const def = policy[slotKey];
      if (!def) return;

      // Only double-click activates. Single clicks in an active surface fall
      // through to PointerController's normal click/drag logic, which routes
      // through editor.charMap and editor.selection (both surface-aware).
      if (clickCount !== 2) return;

      const isNew = !cache.get(slotKey);
      const surface = cache.getOrCreate(slotKey, def);

      if (isNew) {
        surface.onUpdate(({ docChanged }) => {
          getCursorManager(editor)?.resetSilent();
          // When content changes, invalidate layout so measure() re-runs with
          // the live doc and the band height grows to fit.
          if (docChanged) {
            editor.invalidateLayout();
          } else {
            editor.redraw();
          }
        });
        editor.surfaces.register(surface);
      }

      editor.surfaces.activate(surface.id);
      const entry = editorEntries.get(editor);
      if (entry) entry.activePage = page;
      editor.redraw();

      placeCursorAfterPaint(surface, x, y, page);
    });

    return () => {
      unsubOverlay();
      unsubChromeClick();
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
          return true;
        }
        return false;
      },
    };
  },
});
