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
import { Extension } from "@scrivr/core";
import type { IEditor } from "@scrivr/core";
import { YBinding } from "./YBinding";
import type { DocAttrEnvelope } from "./YBinding";
import { collaborationRegistry } from "./collaborationState";

interface CollaborationOptions {
  /** WebSocket URL of the HocusPocus server. Default: "ws://localhost:1234" */
  url?: string;
  /** Document / room name — all clients with the same name share the document. */
  name?: string;
  /** Authentication token sent to the server's onAuthenticate hook. */
  token?: string | (() => string) | (() => Promise<string>);
  /** Called when the WebSocket connection is established. */
  onConnect?: () => void;
  /** Called when the WebSocket connection is closed. */
  onDisconnect?: () => void;
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

  onViewReady(editor: IEditor) {
    // Today Collaboration's runtime depends on `setReady(false/true)` to
    // suppress layout/paint during Y.js initial sync — that's view-only.
    // The Y binding itself is engine-state work and could move to
    // `onEditorReady`; splitting the two is a follow-up so headless
    // ServerEditor collaboration becomes a first-class case.
    const inst = instanceState.get(this.options);
    if (!inst) return;

    const ydoc = new Y.Doc();
    const type = ydoc.getXmlFragment("prosemirror");
    // Sibling map for doc-level attrs (e.g. headerFooter policy). Lives next
    // to the content fragment on the same Y.Doc so a single update batch can
    // carry both content and attr changes atomically.
    const attrsMap = ydoc.getMap<DocAttrEnvelope>("prose_doc_attrs");
    const { url = "ws://localhost:1234", name = "default" } = this.options;

    // Suppress all layout/paint flushes while Y.js syncs the document.
    // Hundreds of typeObserver events will fire during initial sync — without
    // this, each one triggers a full layout+paint, causing O(N²) total work.
    // setReady(true) in onSynced does one fast chunked layout of the final doc.
    editor.setReady(false);

    const binding = new YBinding(editor, ydoc, type, attrsMap);
    inst.binding = binding;
    binding.bind();

    const provider = new HocuspocusProvider({
      url,
      name,
      document: ydoc,
      token: this.options.token ?? null,
      onSynced: () => {
        binding.markSynced();
        editor.setReady(true);
      },
      ...(this.options.onConnect ? { onConnect: this.options.onConnect } : {}),
      ...(this.options.onDisconnect
        ? { onDisconnect: this.options.onDisconnect }
        : {}),
    });

    // Store provider so CollaborationCursor can read awareness
    collaborationRegistry.set(editor, { ydoc, provider });

    return () => {
      binding.destroy();
      provider.destroy();
      ydoc.destroy();
      inst.binding = null;
    };
  },
});
