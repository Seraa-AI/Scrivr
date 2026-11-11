/**
 * Per-editor collaboration state: the Y.Doc and provider the Collaboration
 * extension creates, the awareness CollaborationCursor reads from the same
 * provider, and the binding undo and redo drive.
 *
 * Keyed by the editor instance — garbage collected when the editor is destroyed.
 */
import type { HocuspocusProvider } from "@hocuspocus/provider";
import type * as Y from "yjs";
import type { IBaseEditor } from "@scrivr/core";
import type { YBinding } from "./YBinding";

export interface CollabState {
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
  /**
   * The binding undo and redo drive. Here rather than beside the extension's
   * options, because options identify a configured extension and one of those
   * can serve several editors — a split view undid the wrong pane, and merely
   * building the second editor left the first with no binding at all.
   */
  binding: YBinding;
}

// Keyed by `IBaseEditor` so headless `ServerEditor` collaboration registers
// here too. A browser `Editor` is both `IEditor` and `IBaseEditor` (same object
// reference), so CollaborationCursor's `get(editor)` with an `IEditor` resolves
// the entry the Collaboration extension wrote with an `IBaseEditor`.
export const collaborationRegistry = new WeakMap<IBaseEditor, CollabState>();
