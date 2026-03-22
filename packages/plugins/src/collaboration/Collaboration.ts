/**
 * Collaboration — real-time multi-user editing via Y.js + HocusPocus.
 *
 * Uses a custom YBinding (see extensions/YBinding.ts) instead of y-prosemirror's
 * ySyncPlugin. This avoids the EditorView dependency — ySyncPlugin calls
 * EditorView methods (hasFocus, _root, etc.) that our canvas editor doesn't have.
 *
 * Usage:
 *   new Editor({
 *     extensions: [
 *       StarterKit.configure({ history: false }), // disable PM history — Y.UndoManager replaces it
 *       Collaboration.configure({ url: "ws://localhost:1234", name: "my-room" }),
 *       CollaborationCursor.configure({ user: { name: "Alice", color: "#ef4444" } }),
 *     ],
 *   })
 */
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { Extension } from "@inscribe/core";
import type { IEditor } from "@inscribe/core";
import { YBinding } from "./YBinding";
import { collaborationRegistry } from "./collaborationState";

interface CollaborationOptions {
  /** WebSocket URL of the HocusPocus server. Default: "ws://localhost:1234" */
  url?: string;
  /** Document / room name — all clients with the same name share the document. */
  name?: string;
}

/**
 * Per-instance state shared between addCommands/addKeymap and onEditorReady.
 * Keyed by the options object (unique per configured Extension instance).
 */
interface InstanceState {
  binding: YBinding | null; // set in onEditorReady, null until then
}
const instanceState = new WeakMap<object, InstanceState>();

export const Collaboration = Extension.create<CollaborationOptions>({
  name: "collaboration",

  defaultOptions: {
    url: "ws://localhost:1234",
    name: "default",
  },

  // Seed instanceState early so addKeymap/addCommands closures can reference it.
  addProseMirrorPlugins() {
    instanceState.set(this.options, { binding: null });
    return [];
  },

  addKeymap() {
    return {
      "Mod-z": (_state, dispatch) => {
        const binding = instanceState.get(this.options)?.binding;
        if (!binding?.undoManager.canUndo()) return false;
        if (dispatch) binding.undoManager.undo();
        return true;
      },
      "Mod-y": (_state, dispatch) => {
        const binding = instanceState.get(this.options)?.binding;
        if (!binding?.undoManager.canRedo()) return false;
        if (dispatch) binding.undoManager.redo();
        return true;
      },
      "Mod-Shift-z": (_state, dispatch) => {
        const binding = instanceState.get(this.options)?.binding;
        if (!binding?.undoManager.canRedo()) return false;
        if (dispatch) binding.undoManager.redo();
        return true;
      },
    };
  },

  addCommands() {
    return {
      undo: () => (_state, dispatch) => {
        const binding = instanceState.get(this.options)?.binding;
        if (!binding?.undoManager.canUndo()) return false;
        if (dispatch) binding.undoManager.undo();
        return true;
      },
      redo: () => (_state, dispatch) => {
        const binding = instanceState.get(this.options)?.binding;
        if (!binding?.undoManager.canRedo()) return false;
        if (dispatch) binding.undoManager.redo();
        return true;
      },
    };
  },

  onEditorReady(editor: IEditor) {
    const inst = instanceState.get(this.options);
    if (!inst) return;

    const ydoc = new Y.Doc();
    const type = ydoc.getXmlFragment("prosemirror");
    const { url = "ws://localhost:1234", name = "default" } = this.options;

    const binding = new YBinding(editor, ydoc, type);
    inst.binding = binding;
    binding.bind();

    const provider = new HocuspocusProvider({
      url,
      name,
      document: ydoc,
      onSynced: () => binding.markSynced(),
    });

    // Store provider so CollaborationCursor can read awareness
    collaborationRegistry.set(editor, { ydoc, provider });

    return () => {
      binding.destroy();
      provider.destroy();
      inst.binding = null;
    };
  },
});
