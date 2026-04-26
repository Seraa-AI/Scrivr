import { history, undo, redo } from "prosemirror-history";
import { Extension } from "../Extension";

interface HistoryOptions {
  /** Maximum number of undo steps. Default: 100 */
  depth: number;
  /** Milliseconds within which typing is grouped into one undo step. Default: 500 */
  newGroupDelay: number;
}

/**
 * History — undo/redo via prosemirror-history.
 *
 * Already wired into EditorState by default, but defining it as an extension
 * lets consumers disable it (e.g. for collaborative editing where the server
 * manages undo history).
 *
 * @example
 * StarterKit.configure({ history: false })   // disable history entirely
 * StarterKit.configure({ history: { depth: 50 } })
 */
export const History = Extension.create<HistoryOptions>({
  name: "history",

  defaultOptions: {
    depth: 100,
    newGroupDelay: 500,
  },

  addProseMirrorPlugins() {
    return [
      history({
        depth: this.options.depth,
        newGroupDelay: this.options.newGroupDelay,
      }),
    ];
  },

  addKeymap() {
    return {
      "Mod-z": undo,
      "Mod-Shift-z": redo,
      // Windows/Linux convention
      "Mod-y": redo,
    };
  },

  addCommands() {
    return {
      undo: () => undo,
      redo: () => redo,
    };
  },
});

declare module "@scrivr/core" {
  interface Commands<ReturnType> {
    history: {
      /** Undo the last change. */
      undo: () => ReturnType;
      /** Redo the last undone change. */
      redo: () => ReturnType;
    };
  }
}
