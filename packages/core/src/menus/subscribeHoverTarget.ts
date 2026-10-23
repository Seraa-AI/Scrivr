import type { IEditor } from "../extensions/types";
import type { HoverTarget } from "../hover/types";

/** How a popover is showing: a compact read-only peek from hover, or full from selection. */
export type PopoverPresentation = "peek" | "full";

export interface HoverDelays {
  /** Pointer must rest on a target this long before its peek shows. Default 350 ms. */
  showDelay?: number;
  /** Grace period to cross from the target into the peek. Default 150 ms. */
  hideDelay?: number;
}

/** A controller's `hover` option: on by default, `false` disables peeks. */
export type HoverOption = boolean | HoverDelays;

export const DEFAULT_HOVER_SHOW_DELAY = 350;
export const DEFAULT_HOVER_HIDE_DELAY = 150;

export interface SubscribeHoverTargetOptions extends HoverDelays {
  /** The popover's root; while the pointer is over it, the peek stays open. */
  getPopoverElement?: () => HTMLElement | null;
}

/**
 * Debounced hover for one target kind. Calls `fn` with the innermost target of
 * that kind once the pointer has rested on it for `showDelay`, and with null
 * once it has been off it for `hideDelay` — unless the pointer is over the
 * popover itself, which keeps the peek open.
 *
 * Moving from one target of the kind straight onto another swaps immediately:
 * the peek is already open, so there is nothing to wait for.
 */
export function subscribeHoverTarget(
  editor: IEditor,
  kind: string,
  fn: (target: HoverTarget | null) => void,
  opts: SubscribeHoverTargetOptions = {},
): () => void {
  const showDelay = opts.showDelay ?? DEFAULT_HOVER_SHOW_DELAY;
  const hideDelay = opts.hideDelay ?? DEFAULT_HOVER_HIDE_DELAY;

  let shown: HoverTarget | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const overPopover = (): boolean => {
    const el = opts.getPopoverElement?.();
    if (!el) return false;
    try {
      return el.matches(":hover");
    } catch {
      return false;
    }
  };

  const scheduleHide = (): void => {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      if (overPopover()) {
        scheduleHide();
        return;
      }
      shown = null;
      fn(null);
    }, hideDelay);
  };

  const off = editor.on("hover", ({ targets }) => {
    const target = targets.find((t) => t.kind === kind) ?? null;

    if (!target) {
      if (shown) scheduleHide();
      else clearTimer();
      return;
    }
    if (shown && sameTarget(shown, target)) {
      clearTimer();
      return;
    }
    if (shown) {
      clearTimer();
      shown = target;
      fn(target);
      return;
    }
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      shown = target;
      fn(target);
    }, showDelay);
  });

  return () => {
    off();
    clearTimer();
    shown = null;
  };
}

/** Resolve a controller's `hover` option to delays, or null when hover is off. */
export function resolveHoverOption(option: HoverOption | undefined): HoverDelays | null {
  if (option === false) return null;
  if (option === undefined || option === true) return {};
  return option;
}

function sameTarget(a: HoverTarget, b: HoverTarget): boolean {
  return a.surfaceId === b.surfaceId && a.pos === b.pos && a.end === b.end;
}
