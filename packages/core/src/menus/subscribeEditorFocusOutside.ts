import type { IBaseEditor } from "../extensions/types";

/**
 * Fallback marker attribute. The primary "is focus inside the popover"
 * check is the `getPopoverElement` option passed by the controller — this
 * attribute only matters for vanilla / third-party popovers that don't
 * have access to their own root element accessor.
 *
 * Convention: set the attribute to the popover's name (e.g. `bubble-menu`,
 * `link-popover`, `slash-menu`). The helper checks for presence, not value,
 * but a meaningful value makes DOM inspection self-documenting.
 */
export const POPOVER_MARKER = "data-scrivr-popover";

export interface SubscribeEditorFocusOutsideOptions {
  /**
   * Returns the popover's root DOM element (or null if not yet mounted).
   * When focus moves into this element on editor blur, `onHide` is suppressed
   * so users can interact with the popover without dismissing it.
   *
   * Preferred over the `[data-scrivr-popover]` marker for internal popovers —
   * uses the actual ref tree, so a missing marker can't accidentally cause
   * the popover to close on its own button clicks.
   */
  getPopoverElement?: () => HTMLElement | null;
}

/**
 * Fires `onHide` when the editor loses DOM focus to something that is NOT
 * the editor itself and NOT inside the popover.
 *
 * Complements `subscribeViewUpdates`, which fires on state / viewport changes.
 * Editor blur produces neither — DOM focus moving to a sidebar button or the
 * browser address bar leaves the ProseMirror selection untouched, so popovers
 * subscribed only to view updates would stay anchored to an invisible state.
 *
 * Timing: the check is deferred one microtask so a click *into* a popover
 * (which blurs the editor then focuses an input inside the popover, all in
 * the same tick) settles before we inspect `document.activeElement`. A
 * focus event that arrives during the same tick cancels the hide.
 *
 * Popover detection: in priority order,
 *   1. `options.getPopoverElement()` — used by internal controllers that own
 *      a ref to their portal. Bulletproof — no marker attribute required.
 *   2. `[data-scrivr-popover]` ancestor — fallback for popovers without a
 *      ref accessor (vanilla consumers, third-party menus).
 *
 * @example
 *   const off = subscribeEditorFocusOutside(editor, () => controller.hide(), {
 *     getPopoverElement: () => rootRef.current,
 *   });
 */
export function subscribeEditorFocusOutside(
  editor: IBaseEditor,
  onHide: () => void,
  options: SubscribeEditorFocusOutsideOptions = {},
): () => void {
  // Tracks whether a deferred hide is already queued. Multiple blur events
  // within one tick coalesce into a single onHide call.
  let pendingCheck = false;
  // Tracks whether the editor re-focused between the blur and the check —
  // happens whenever a click leaves the textarea and immediately returns
  // (e.g. clicking the editor body twice in rapid succession).
  let refocusedDuringPending = false;

  const offFocus = editor.on("focus", () => {
    if (pendingCheck) refocusedDuringPending = true;
  });

  const offBlur = editor.on("blur", () => {
    if (pendingCheck) return;
    pendingCheck = true;
    refocusedDuringPending = false;
    queueMicrotask(() => {
      const refocused = refocusedDuringPending;
      pendingCheck = false;
      refocusedDuringPending = false;
      if (refocused) return;
      if (typeof document === "undefined") return; // SSR / ServerEditor — no DOM
      const active = document.activeElement;
      if (!active) {
        onHide();
        return;
      }
      // Primary: ref accessor wins when provided. Bulletproof for internal
      // popovers — no marker attribute required.
      const popoverEl = options.getPopoverElement?.();
      if (popoverEl && popoverEl.contains(active)) return;
      // Fallback: marker attribute for vanilla / third-party popovers that
      // don't thread a ref through the controller.
      if (active.closest(`[${POPOVER_MARKER}]`)) return;
      onHide();
    });
  });

  return () => {
    offFocus();
    offBlur();
  };
}
