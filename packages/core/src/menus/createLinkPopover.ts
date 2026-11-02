/**
 * createLinkPopover — framework-agnostic controller for a link editing popover.
 *
 * Shows in two presentations:
 *   - "full" while the caret (the selection's head) is in a link — the
 *     consumer renders "Open / Edit / Remove".
 *   - "peek" when the pointer rests on a link — compact and read-only.
 * Selection wins: while the caret is in a link, hover is ignored. Peek → full
 * keeps the popover (onMove, not onShow), so it grows in place.
 *
 * @example — vanilla JS
 *   const place = (rect, { href }) => {
 *     popover.style.cssText = `display:block;left:${rect.left}px;top:${rect.bottom + 8}px`;
 *     popover.querySelector("a").href = href;
 *   };
 *   const cleanup = createLinkPopover(editor, {
 *     onShow: place,
 *     onMove: place,
 *     onHide: () => { popover.style.display = "none" },
 *   });
 */
import type { IEditor } from "../extensions/types";
import type { HoverTarget } from "../hover/types";
import { linkAt, type LinkRange } from "../extensions/built-in/Link";
import { subscribeViewUpdates } from "./subscribeViewUpdates";
import { subscribeEditorFocusOutside } from "./subscribeEditorFocusOutside";
import { isAnchorInsideContainer } from "./anchorVisibility";
import {
  subscribeHoverTarget,
  type HoverOption,
  type PopoverPresentation,
} from "./subscribeHoverTarget";

export interface LinkPopoverInfo {
  /** The href of the link. */
  href: string;
  /** Doc position where the link starts. */
  from: number;
  /** Doc position where the link ends. */
  to: number;
  /** "peek" when shown from hover, "full" when the caret is in the link. */
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
  getPopoverElement?: (() => HTMLElement | null) | undefined;
  /** Hover peeks. Default true; false shows the popover from the selection only. */
  hover?: HoverOption | undefined;
}

export function createLinkPopover(editor: IEditor, options: LinkPopoverOptions): () => void {
  const { onShow, onHide, onMove } = options;

  let visible = false;
  let rafId: number | null = null;
  let hovered: HoverTarget | null = null;

  function hide() {
    if (visible) { visible = false; onHide(); }
  }

  /** The link the caret is in — the full presentation. */
  function selectedLink(): LinkRange | null {
    const state = editor.getState();
    const linkType = state.schema.marks["link"];
    return linkType ? linkAt(state.doc, state.selection.head, linkType) : null;
  }

  /** The hovered link, re-resolved against current state — the peek. */
  function hoveredLink(): LinkRange | null {
    if (!hovered) return null;
    const state = editor.getState();
    const linkType = state.schema.marks["link"];
    if (!linkType || hovered.end > state.doc.content.size) return null;
    // The link on the target's first character: a caret just after it.
    return linkAt(state.doc, hovered.pos + 1, linkType);
  }

  function update() {
    const selected = selectedLink();
    // Selection wins: a link with the caret in it shows full and hover is ignored.
    const link = selected ?? hoveredLink();
    if (!link) { hide(); return; }

    const rect = editor.getViewportRect(link.from, link.to);
    if (!rect || !isAnchorInsideContainer(rect, editor.getScrollContainerRect())) {
      hide();
      return;
    }

    const info: LinkPopoverInfo = {
      href: link.href,
      from: link.from,
      to: link.to,
      presentation: selected ? "full" : "peek",
    };

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
  const offHover = subscribeHoverTarget(
    editor,
    "link",
    (target) => { hovered = target; scheduleUpdate(); },
    { hover: options.hover ?? true, getPopoverElement: options.getPopoverElement },
  );
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
