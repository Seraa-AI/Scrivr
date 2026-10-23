/**
 * createLinkPopover — framework-agnostic controller for a link editing popover.
 *
 * Shows in two presentations (docs/hover-popovers-rfc.md §5):
 *   - "full" when the cursor (or selection) overlaps a `link` mark — the
 *     consumer renders "Open / Edit / Remove".
 *   - "peek" when the pointer rests on a link — compact and read-only.
 * Selection wins: while a link is selected, hover is ignored. Peek → full
 * keeps the popover (onMove, not onShow), so it grows in place.
 *
 * @example — vanilla JS
 *   const cleanup = createLinkPopover(editor, {
 *     onShow: (rect, href, range) => {
 *       popover.style.cssText = `display:block;left:${rect.left}px;top:${rect.bottom + 8}px`;
 *       popover.querySelector("a").href = href;
 *     },
 *     onHide: () => { popover.style.display = "none" },
 *   });
 */
import type { IEditor } from "../extensions/types";
import type { HoverTarget } from "../hover/types";
import { findMarkRange } from "../model/findMarkRange";
import { subscribeViewUpdates } from "./subscribeViewUpdates";
import { subscribeEditorFocusOutside } from "./subscribeEditorFocusOutside";
import { isAnchorInsideContainer } from "./anchorVisibility";
import {
  resolveHoverOption,
  subscribeHoverTarget,
  type HoverOption,
  type PopoverPresentation,
} from "./subscribeHoverTarget";

export interface LinkPopoverInfo {
  /** The href attribute of the link mark under the cursor. */
  href: string;
  /** Doc position where the link mark starts. */
  from: number;
  /** Doc position where the link mark ends. */
  to: number;
  /** "peek" when shown from hover, "full" when the selection is in the link. */
  presentation: PopoverPresentation;
}

export interface LinkPopoverCallbacks {
  onShow: (rect: DOMRect, info: LinkPopoverInfo) => void;
  onHide: () => void;
  onMove: (rect: DOMRect, info: LinkPopoverInfo) => void;
}

export interface LinkPopoverOptions extends LinkPopoverCallbacks {
  /**
   * Accessor returning the popover's root DOM element (or null if unmounted).
   * Threaded into the focus-outside check; see createBubbleMenu for context.
   * Also keeps a hover peek open while the pointer is over it.
   */
  getPopoverElement?: () => HTMLElement | null;
  /** Hover peeks. Default true; false shows the popover from the selection only. */
  hover?: HoverOption;
}

export function createLinkPopover(editor: IEditor, options: LinkPopoverOptions): () => void {
  const { onShow, onHide, onMove } = options;

  let visible = false;
  let rafId: number | null = null;
  let hovered: HoverTarget | null = null;

  function hide() {
    if (visible) { visible = false; onHide(); }
  }

  /** The link the selection is in — the full presentation. */
  function selectedLink(): Omit<LinkPopoverInfo, "presentation"> | null {
    const state    = editor.getState();
    const { head } = state.selection;
    const $pos     = state.doc.resolve(head);
    const linkMark = state.schema.marks["link"];
    if (!linkMark) return null;

    const markInstance = $pos.marks().find((m) => m.type === linkMark)
      ?? state.doc.resolve(Math.max(0, head - 1)).marks().find((m) => m.type === linkMark);
    if (!markInstance) return null;

    // Walk outward from cursor to find the full extent of this mark
    const { from, to } = findMarkRange(state.doc, head, markInstance.type);
    const href = markInstance.attrs["href"] as string;
    return { href, from, to };
  }

  /** The hovered link, re-resolved against current state — the peek. */
  function hoveredLink(): Omit<LinkPopoverInfo, "presentation"> | null {
    if (!hovered) return null;
    const state = editor.getState();
    const linkMark = state.schema.marks["link"];
    if (!linkMark || hovered.end > state.doc.content.size) return null;
    const text = state.doc.nodeAt(hovered.pos);
    const mark = text?.marks.find((m) => m.type === linkMark);
    if (!mark) return null;
    const href: unknown = mark.attrs["href"];
    if (typeof href !== "string") return null;
    return { href, from: hovered.pos, to: hovered.end };
  }

  function update() {
    const selected = selectedLink();
    // Selection wins: a selected link shows full and hover is ignored.
    const link = selected ?? hoveredLink();
    if (!link) { hide(); return; }

    const rect = editor.getViewportRect(link.from, link.to);
    if (!rect || !isAnchorInsideContainer(rect, editor.getScrollContainerRect())) {
      hide();
      return;
    }

    const info: LinkPopoverInfo = { ...link, presentation: selected ? "full" : "peek" };

    if (visible) {
      onMove(rect, info);
    } else {
      visible = true;
      onShow(rect, info);
    }
  }

  function scheduleUpdate() {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => { rafId = null; update(); });
  }

  const unsubscribe = subscribeViewUpdates(editor, scheduleUpdate);
  const hoverDelays = resolveHoverOption(options.hover);
  const offHover = hoverDelays
    ? subscribeHoverTarget(
        editor,
        "link",
        (target) => { hovered = target; scheduleUpdate(); },
        { ...hoverDelays, ...(options.getPopoverElement ? { getPopoverElement: options.getPopoverElement } : {}) },
      )
    : () => {};
  const offFocusOutside = subscribeEditorFocusOutside(
    editor,
    () => {
      // A peek is pointer-driven, not focus-driven: losing focus to elsewhere
      // on the page hides the full popover only.
      if (hovered && !selectedLink()) return;
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      hide();
    },
    options.getPopoverElement ? { getPopoverElement: options.getPopoverElement } : {},
  );

  return () => {
    unsubscribe();
    offHover();
    offFocusOutside();
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    hide();
  };
}
