/**
 * HeaderFooterController — framework-agnostic headless controller for
 * building header/footer settings UI (ribbons, modals, panels).
 *
 * @example
 *   const controller = createHeaderFooterController(editor);
 *   controller.getState();               // current policy + active band
 *   controller.setHeaderMarginTop(48);   // update margin from page edge
 *   controller.toggleFirstPage();        // toggle differentFirstPage
 *   controller.subscribe((state) => {}); // react to changes
 *   controller.destroy();                // cleanup
 */

import type { IBaseEditor } from "@scrivr/core";
import type { HeaderFooterPolicy, HeaderFooterDefinition } from "./types";
import { getPolicyFromEditor } from "./getPolicy";
import { HeaderFooterSurfaceCache } from "./surfaces";

// ── State ────────────────────────────────────────────────────────────────────

/** Read-only snapshot of the header/footer state. */
export interface HeaderFooterState {
  /** The full policy, or null when no policy exists yet. */
  policy: HeaderFooterPolicy | null;
  /** Whether the policy exists and is enabled. */
  isEnabled: boolean;
  /** Whether a header/footer surface is currently being edited. */
  isSurfaceActive: boolean;
  /** Which band is being edited: "header", "footer", or null. */
  activeBand: "header" | "footer" | null;
  /** The page where the active band is being edited, or null. */
  activePage: number | null;
  /** Increments on every state rebuild — used for render gating. */
  version: number;
}

// ── Controller interface ─────────────────────────────────────────────────────

export interface HeaderFooterController {
  /** Get the current state snapshot. */
  getState(): HeaderFooterState;

  /** Enable or disable headers and footers entirely. */
  setEnabled(enabled: boolean): void;

  /** Toggle the "different first page" flag. */
  toggleFirstPage(): void;

  /** Set the top margin for headers (distance from page edge to header content). */
  setHeaderMarginTop(value: number): void;

  /** Set the bottom margin for footers (distance from page bottom to footer content). */
  setFooterMarginBottom(value: number): void;

  /** Set the gap between header band and body content. */
  setHeaderMargin(value: number): void;

  /** Set the gap between footer band and body content. */
  setFooterMargin(value: number): void;

  /** Update any field on the default header definition. */
  updateDefaultHeader(partial: Partial<HeaderFooterDefinition>): void;

  /** Update any field on the default footer definition. */
  updateDefaultFooter(partial: Partial<HeaderFooterDefinition>): void;

  /**
   * Apply multiple updates in a single transaction. Avoids intermediate
   * re-layouts when changing several fields at once (e.g. a settings modal).
   */
  batch(updater: (policy: HeaderFooterPolicy) => HeaderFooterPolicy): void;

  /** Remove the header slots (keeps footer if present). */
  removeHeader(): void;

  /** Remove the footer slots (keeps header if present). */
  removeFooter(): void;

  /** Subscribe to state changes. Returns unsubscribe function. */
  subscribe(callback: (state: HeaderFooterState) => void): () => void;

  /** Cleanup all subscriptions. */
  destroy(): void;
}

// ── Internals ────────────────────────────────────────────────────────────────

const DEFAULT_POLICY: HeaderFooterPolicy = {
  enabled: true,
  differentFirstPage: false,
  differentOddEven: false,
  defaultHeader: {
    content: { type: "doc", content: [{ type: "paragraph" }] },
  },
  defaultFooter: {
    content: { type: "doc", content: [{ type: "paragraph" }] },
  },
};

function getPolicy(editor: IBaseEditor): HeaderFooterPolicy | null {
  return getPolicyFromEditor(editor);
}

/**
 * Ensure a policy exists on the doc. Creates DEFAULT_POLICY if none exists.
 * Returns the existing policy unchanged when one is present (including when
 * `enabled: false`) — callers that need to force-enable should set
 * `enabled: true` themselves after this returns.
 *
 * Exported so the chrome-click handler can bootstrap a policy on
 * double-click-in-margin (Word/Docs UX).
 */
export function ensurePolicy(editor: IBaseEditor): HeaderFooterPolicy {
  const existing = getPolicy(editor);
  if (existing) return existing;

  const policy = { ...DEFAULT_POLICY };
  const tr = editor.getState().tr.setDocAttribute("headerFooter", policy);
  editor._applyTransaction(tr);
  return policy;
}

function applyPolicy(editor: IBaseEditor, policy: HeaderFooterPolicy): void {
  const tr = editor.getState().tr.setDocAttribute("headerFooter", policy);
  editor._applyTransaction(tr);
}

function updatePolicy(editor: IBaseEditor, updater: (current: HeaderFooterPolicy) => HeaderFooterPolicy): void {
  const current = ensurePolicy(editor);
  applyPolicy(editor, updater(current));
}

function updateSlot(
  editor: IBaseEditor,
  slotKey: "defaultHeader" | "defaultFooter",
  partial: Partial<HeaderFooterDefinition>,
): void {
  updatePolicy(editor, (policy) => {
    const current = policy[slotKey];
    if (!current) {
      // Auto-create the slot with default content + the partial update
      return {
        ...policy,
        [slotKey]: {
          content: { type: "doc", content: [{ type: "paragraph" }] },
          ...partial,
        },
      };
    }
    return { ...policy, [slotKey]: { ...current, ...partial } };
  });
}

/**
 * Parse the active band and page from a surface ID.
 * Surface IDs follow the pattern: "headerFooter:defaultHeader"
 */
interface SurfacesLike {
  activeSurface: { id: string; owner: string } | null;
  onSurfaceChange: (h: () => void) => () => void;
  activate: (id: string | null) => void;
}

function hasSurfaces(editor: IBaseEditor): editor is IBaseEditor & { surfaces: SurfacesLike } {
  if (!("surfaces" in editor)) return false;
  const s = editor.surfaces;
  return typeof s === "object" && s !== null && "activeSurface" in s && "onSurfaceChange" in s && "activate" in s;
}

function parseActiveBand(editor: IBaseEditor): { band: "header" | "footer"; page: number } | null {
  if (!hasSurfaces(editor)) return null;
  const active = editor.surfaces.activeSurface;
  if (!active || active.owner !== "headerFooter") return null;

  const slotKey = HeaderFooterSurfaceCache.slotKeyFromId(active.id);
  if (!slotKey) return null;

  const band = slotKey.includes("Header") ? "header" as const : "footer" as const;
  return { band, page: 1 };
}

function buildState(editor: IBaseEditor, version: number): HeaderFooterState {
  const policy = getPolicy(editor);
  const activeInfo = parseActiveBand(editor);
  return {
    policy,
    isEnabled: policy?.enabled ?? false,
    isSurfaceActive: activeInfo !== null,
    activeBand: activeInfo?.band ?? null,
    activePage: activeInfo?.page ?? null,
    version,
  };
}

function shallowEqual(a: HeaderFooterState, b: HeaderFooterState): boolean {
  return (
    a.policy === b.policy &&
    a.isEnabled === b.isEnabled &&
    a.isSurfaceActive === b.isSurfaceActive &&
    a.activeBand === b.activeBand &&
    a.activePage === b.activePage
  );
}

// ── Factory ──────────────────────────────────────────────────────────────────

/** Deactivate the active surface if it belongs to a slot being removed. */
function deactivateIfSlotActive(editor: IBaseEditor, bandKeyword: string): void {
  if (!hasSurfaces(editor)) return;
  const active = editor.surfaces.activeSurface;
  if (!active || active.owner !== "headerFooter") return;
  if (active.id.includes(bandKeyword)) {
    editor.surfaces.activate(null);
  }
}

export function createHeaderFooterController(editor: IBaseEditor): HeaderFooterController {
  const listeners = new Set<(state: HeaderFooterState) => void>();
  let version = 0;
  let lastState = buildState(editor, version);

  const notify = () => {
    const next = buildState(editor, ++version);
    // Skip notification when nothing meaningful changed. The version field
    // always increments, but we compare semantic fields to avoid UI churn.
    if (shallowEqual(lastState, next)) return;
    lastState = next;
    listeners.forEach((cb) => cb(next));
  };

  // Force-notify: always push to listeners (used for layout-dependent updates
  // where metrics change but policy/active state doesn't).
  const forceNotify = () => {
    lastState = buildState(editor, ++version);
    listeners.forEach((cb) => cb(lastState));
  };

  const offUpdate = editor.on("update", () => notify());
  const offChromeClick = editor.on("chromeClick", () => forceNotify());

  const offSurfaceChange = hasSurfaces(editor)
    ? editor.surfaces.onSurfaceChange(() => forceNotify())
    : null;

  return {
    getState: () => buildState(editor, version),

    setEnabled(enabled) {
      if (enabled) {
        const current = getPolicy(editor);
        if (current) {
          applyPolicy(editor, { ...current, enabled: true });
        } else {
          applyPolicy(editor, { ...DEFAULT_POLICY });
        }
      } else {
        const current = getPolicy(editor);
        if (current) applyPolicy(editor, { ...current, enabled: false });
      }
    },

    toggleFirstPage() {
      updatePolicy(editor, (p) => {
        const enabling = !p.differentFirstPage;
        if (enabling) {
          const result = { ...p, differentFirstPage: true as const };
          if (!p.firstPageHeader && p.defaultHeader) {
            result.firstPageHeader = { ...p.defaultHeader };
          }
          if (!p.firstPageFooter && p.defaultFooter) {
            result.firstPageFooter = { ...p.defaultFooter };
          }
          return result;
        }
        return { ...p, differentFirstPage: false };
      });
    },

    setHeaderMarginTop(value) {
      updateSlot(editor, "defaultHeader", { marginTop: value });
    },

    setFooterMarginBottom(value) {
      updateSlot(editor, "defaultFooter", { marginBottom: value });
    },

    setHeaderMargin(value) {
      updateSlot(editor, "defaultHeader", { margin: value });
    },

    setFooterMargin(value) {
      updateSlot(editor, "defaultFooter", { margin: value });
    },

    updateDefaultHeader(partial) {
      updateSlot(editor, "defaultHeader", partial);
    },

    updateDefaultFooter(partial) {
      updateSlot(editor, "defaultFooter", partial);
    },

    batch(updater) {
      updatePolicy(editor, updater);
    },

    removeHeader() {
      deactivateIfSlotActive(editor, "Header");
      updatePolicy(editor, (p) => ({
        ...p,
        defaultHeader: undefined,
        firstPageHeader: undefined,
      }));
    },

    removeFooter() {
      deactivateIfSlotActive(editor, "Footer");
      updatePolicy(editor, (p) => ({
        ...p,
        defaultFooter: undefined,
        firstPageFooter: undefined,
      }));
    },

    subscribe(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },

    destroy() {
      offUpdate();
      offChromeClick();
      offSurfaceChange?.();
      listeners.clear();
    },
  };
}
