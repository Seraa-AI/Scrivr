import { Extension } from "@scrivr/core";
import type { IBaseEditor } from "@scrivr/core";

/** One reading fact, timestamped in epoch milliseconds. Pages are 1-based. */
export type ReadingEvent =
  | { type: "pageEntered"; page: number; at: number }
  | { type: "pageLeft"; page: number; at: number }
  | { type: "furthestPage"; page: number; at: number }
  | { type: "reachedEnd"; at: number };

export interface ReadingProgressOptions {
  /** Receives every reading fact as it happens. Scrivr keeps none of them. */
  onReading: (event: ReadingEvent) => void;
}

/**
 * Turns the pages on screen into reading evidence — what a signing host stores
 * to show the document was read before it was signed. Page-level by design:
 * finer dwell tracking is surveillance, not evidence.
 */
export const ReadingProgress = Extension.create<ReadingProgressOptions>({
  name: "readingProgress",

  defaultOptions: {
    onReading: () => {},
  },

  onEditorReady(editor: IBaseEditor) {
    const { onReading } = this.options;
    let inView = new Set<number>();
    let furthest = 0;
    let reachedEnd = false;

    const off = editor.on("pagesInView", ({ first, last, pageCount, complete }) => {
      const at = Date.now();
      const next = new Set<number>();
      for (let page = first; page <= last; page++) next.add(page);

      for (const page of inView) if (!next.has(page)) onReading({ type: "pageLeft", page, at });
      for (const page of next) if (!inView.has(page)) onReading({ type: "pageEntered", page, at });
      inView = next;

      if (last > furthest) {
        furthest = last;
        onReading({ type: "furthestPage", page: last, at });
      }
      if (!reachedEnd && complete && last === pageCount) {
        reachedEnd = true;
        onReading({ type: "reachedEnd", at });
      }
    });

    return () => {
      off();
      const at = Date.now();
      for (const page of inView) onReading({ type: "pageLeft", page, at });
    };
  },
});
