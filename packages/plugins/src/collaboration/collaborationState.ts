/**
 * Module-level WeakMap that shares state between the Collaboration extension
 * (which creates the Y.Doc and provider) and the CollaborationCursor extension
 * (which reads awareness from the same provider).
 *
 * Keyed by the editor instance — garbage collected when the editor is destroyed.
 */
import type { HocuspocusProvider } from "@hocuspocus/provider";
import type * as Y from "yjs";
import type { IBaseEditor } from "@scrivr/core";

export interface CollabState {
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
}

// Keyed by `IBaseEditor` so headless `ServerEditor` collaboration registers
// here too. A browser `Editor` is both `IEditor` and `IBaseEditor` (same object
// reference), so CollaborationCursor's `get(editor)` with an `IEditor` resolves
// the entry the Collaboration extension wrote with an `IBaseEditor`.
export const collaborationRegistry = new WeakMap<IBaseEditor, CollabState>();
