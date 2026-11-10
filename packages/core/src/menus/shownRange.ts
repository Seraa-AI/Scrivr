import type { IEditor } from "../extensions/types";
import { mapRange, type DocRange } from "../hover/types";

/**
 * The range a popover shows, carried through edits (`mapRange`). A
 * collaborator typing above it, or an edit that changes it in place — a
 * resized image, a column added to a table — leaves it the same target
 * (`onMove`); a different one is shown anew (`onShow`).
 */
export interface ShownRange {
  /** Whether `[from, to)` is what is shown: it overlaps the mapped range. */
  is(from: number, to: number): boolean;
  set(range: DocRange | null): void;
  dispose(): void;
}

export function trackShownRange(editor: IEditor): ShownRange {
  let shown: DocRange | null = null;
  const dispose = editor.on("update", ({ mapping }) => {
    if (shown) shown = mapRange(shown, mapping);
  });
  return {
    is: (from, to) => shown !== null && from < shown.to && to > shown.from,
    set: (range) => { shown = range; },
    dispose,
  };
}
