import type { IEditor } from "../extensions/types";

/**
 * The position that identifies what a popover shows, carried through edits.
 * A collaborator typing above it moves it, so the popover goes on showing the
 * same link or image (`onMove`) instead of mistaking it for a new one
 * (`onShow`). Null once nothing is shown, or once an edit deleted it.
 */
export interface ShownPosition {
  get(): number | null;
  set(pos: number | null): void;
  dispose(): void;
}

export function trackShownPosition(editor: IEditor): ShownPosition {
  let pos: number | null = null;
  const dispose = editor.on("update", ({ mapping }) => {
    if (pos === null) return;
    // The token after `pos` is what is shown: a link's first character, an image.
    const mapped = mapping.mapResult(pos, 1);
    pos = mapped.deleted ? null : mapped.pos;
  });
  return { get: () => pos, set: (next) => { pos = next; }, dispose };
}
