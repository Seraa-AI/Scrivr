/**
 * Module-level WeakMap that shares state between the Collaboration extension
 * (which creates the Y.Doc and provider) and the CollaborationCursor extension
 * (which reads awareness from the same provider).
 *
 * Keyed by the editor instance — garbage collected when the editor is destroyed.
 */
import type { HocuspocusProvider } from "@hocuspocus/provider";
import type * as Y from "yjs";
import type { IEditor } from "@scrivr/core";

export interface CollabState {
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
}

export const collaborationRegistry = new WeakMap<IEditor, CollabState>();
