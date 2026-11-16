import type { IEditor } from "../extensions/types";
import { mapHoverTarget, type HoverTarget } from "../hover/types";

/** How a popover is showing: a compact read-only peek from hover, or full from selection. */
export type PopoverPresentation = "peek" | "full";

export interface HoverDelays {
  /** Pointer must rest on a target this long before its peek shows. Default 350 ms. */
  showDelay?: number;
  /** Grace period to cross from the target into the peek. Default 150 ms. */
  hideDelay?: number;
}

/** A controller's `hover` option: `true` or delays turn peeks on, `false` turns them off. */
export type HoverOption = boolean | HoverDelays;

export const DEFAULT_HOVER_SHOW_DELAY = 350;
export const DEFAULT_HOVER_HIDE_DELAY = 150;

export interface SubscribeHoverTargetOptions {
  /** `false` subscribes to nothing. Default true. */
  hover?: HoverOption | undefined;
  /** The popover's root; while the pointer is over it, the peek stays open. */
  getPopoverElement?: (() => HTMLElement | null) | undefined;
}

/**
 * Debounced hover for one target kind. Calls `fn` with the innermost target of
 * that kind once the pointer has rested on it for `showDelay`, and with null
 * once it has been off it for `hideDelay` — unless the pointer is over the
 * popover itself, which keeps the peek open.
 *
 * Resting is per target, not per event: moving across a table's cells changes
 * the stack on every cell but never leaves the table, so the table's wait runs
 * on. Moving onto another target of the kind while a peek is open swaps after
 * `hideDelay`, and not while the pointer is on the peek: it may only be
 * crossing that target on its way in. An edit carries what is shown and waited
 * on (`mapHoverTarget`), wherever the pointer is: the same target at new
 * positions. One the edit deletes, or a keyboard dismissal, closes the peek
 * at once, even under the pointer.
 */
export function subscribeHoverTarget(
  editor: IEditor,
  kind: string,
  fn: (target: HoverTarget | null) => void,
  opts: SubscribeHoverTargetOptions = {},
): () => void {
  const hover = opts.hover ?? true;
  if (hover === false) return () => {};
  const delays = hover === true ? {} : hover;
  const showDelay = delays.showDelay ?? DEFAULT_HOVER_SHOW_DELAY;
  const hideDelay = delays.hideDelay ?? DEFAULT_HOVER_HIDE_DELAY;

  let shown: HoverTarget | null = null;
  /** The target the show timer is waiting on. */
  let pending: HoverTarget | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pending = null;
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

  // What is shown and waited on is carried through each edit here, not read
  // back from the pointer's stack: the pointer may have crossed other text,
  // or another target, on its way into the peek.
  const offEdit = editor.on("update", ({ mapping }) => {
    if (pending) {
      const mapped = mapHoverTarget(pending, mapping);
      if (mapped) pending = mapped;
      else clearTimer();
    }
    if (!shown) return;
    const mapped = mapHoverTarget(shown, mapping);
    if (!mapped) {
      // Deleted: waiting would leave the peek on positions that now belong to
      // whatever the edit shifted into them.
      clearTimer();
      shown = null;
      fn(null);
    } else if (!sameTarget(mapped, shown) || mapped.at !== shown.at) {
      shown = mapped;
      fn(mapped);
    }
  });

  const off = editor.on("hover", ({ targets, fromEdit, dismissed }) => {
    // An edit moved the stack, not the pointer: the edit listener carries what
    // this subscription holds.
    if (fromEdit) return;
    const target = targets.find((t) => t.kind === kind) ?? null;

    if (!target && shown && dismissed) {
      // The reader asked for it gone, even under the pointer.
      clearTimer();
      shown = null;
      fn(null);
      return;
    }
    if (!target) {
      if (shown) scheduleHide();
      else clearTimer();
      return;
    }
    if (shown) {
      if (sameTarget(shown, target)) clearTimer();
      else wait(target, hideDelay);
      return;
    }
    wait(target, showDelay);
  });

  /** Show `target` once the pointer has stayed on it for `delay`. */
  function wait(target: HoverTarget, delay: number): void {
    if (pending && sameTarget(pending, target)) return;
    clearTimer();
    pending = target;
    const expire = (): void => {
      // The pointer reached the open peek while crossing this target: the peek
      // stays while it is there, and the swap goes on if it comes back out.
      if (shown && overPopover()) {
        timer = setTimeout(expire, delay);
        return;
      }
      timer = null;
      const waited = pending;
      pending = null;
      if (!waited) return;
      // The peek opens where the pointer rests now, not where it first arrived.
      shown = editor.getHoverTargets().find((t) => sameTarget(t, waited)) ?? waited;
      fn(shown);
    };
    timer = setTimeout(expire, delay);
  }

  return () => {
    off();
    offEdit();
    clearTimer();
    shown = null;
  };
}

function sameTarget(a: HoverTarget, b: HoverTarget): boolean {
  return a.surfaceId === b.surfaceId && a.pos === b.pos && a.end === b.end;
}
