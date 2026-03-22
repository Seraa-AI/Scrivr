/**
 * YBinding — custom Y.js ↔ ProseMirror sync binding.
 *
 * Follows the same pattern as y-codemirror: two observers wired together
 * with a mutex to prevent sync loops. Uses y-prosemirror's conversion
 * utilities (which internally call updateYFragment for proper tree-diffing)
 * but bypasses ProsemirrorBinding entirely — no EditorView shim required.
 *
 *   typeObserver   Y.XmlFragment → PM doc   (remote changes arrive)
 *   targetObserver PM doc → Y.XmlFragment   (local edits depart)
 *
 * Undo/redo is handled by Y.UndoManager, which only tracks the local
 * client's own changes (origin === LOCAL_ORIGIN) so remote peers'
 * edits are never un-done.
 */
import * as Y from "yjs";
import { yXmlFragmentToProseMirrorRootNode, prosemirrorToYXmlFragment } from "y-prosemirror";
import type { Node } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import type { IEditor } from "@inscribe/core";

// ── Inline mutex (from lib0/mutex — avoids an unlisted direct dep) ────────────

/**
 * A mutex that runs `f` only when no other call is in progress.
 * If already locked, `f` is silently dropped (same semantics as lib0/mutex).
 */
type MuxFn = (f: () => void) => void;

function createMutex(): MuxFn {
  let locked = false;
  return (f) => {
    if (!locked) {
      locked = true;
      try { f(); } finally { locked = false; }
    }
  };
}

// ── YBinding ──────────────────────────────────────────────────────────────────

/**
 * Sentinel origin used for local PM→Y.js transactions.
 * The UndoManager tracks only this origin so remote changes are never undone.
 */
const LOCAL_ORIGIN = "y-binding-local";

export class YBinding {
  private readonly mux: MuxFn = createMutex();

  /**
   * The last PM doc we pushed to Y.js (or received from Y.js).
   * Used to skip no-op targetObserver calls (doc reference unchanged).
   */
  private prevDoc: Node | null = null;

  /**
   * Gate for the PM→Y.js direction.
   *
   * False until markSynced() is called (i.e. until the provider has finished
   * sending the stored document to this client). Without this gate,
   * targetObserver fires on the very first dispatch and pushes the editor's
   * default empty paragraph to Y.js — overwriting the server's saved content
   * before it has arrived.
   */
  private synced = false;

  /**
   * Y.js-aware undo manager. Tracks only LOCAL_ORIGIN transactions so
   * remote peers' changes are never included in the local undo stack.
   */
  readonly undoManager: Y.UndoManager;

  private unbindEditor: (() => void) | null = null;

  constructor(
    private readonly editor: IEditor,
    private readonly ydoc: Y.Doc,
    private readonly type: Y.XmlFragment,
  ) {
    this.undoManager = new Y.UndoManager(type, {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
    });
  }

  // ── Y.js → PM ───────────────────────────────────────────────────────────────

  /**
   * Called by Y.js whenever the XmlFragment changes (local or remote).
   * Converts the current Y.js tree to a PM doc and replaces the editor state.
   */
  private readonly typeObserver = (): void => {
    this.mux(() => {
      // Guard: an empty fragment can't produce a schema-valid doc (doc requires block+)
      if (this.type.length === 0) return;

      const state = this.editor.getState();

      let newDoc: Node;
      try {
        newDoc = yXmlFragmentToProseMirrorRootNode(this.type, state.schema);
      } catch {
        // Malformed Y.js tree (e.g. during incremental server sync) — skip
        return;
      }

      let tr = state.tr.replaceWith(0, state.doc.content.size, newDoc.content);

      // Clamp selection to the new doc bounds
      const maxPos = tr.doc.content.size;
      const { anchor, head } = state.selection;
      tr = tr.setSelection(
        TextSelection.create(
          tr.doc,
          Math.min(anchor, maxPos),
          Math.min(head, maxPos),
        ),
      );

      this.prevDoc = tr.doc;
      this.editor._applyTransaction(tr);
    });
  };

  // ── PM → Y.js ───────────────────────────────────────────────────────────────

  /**
   * Called by the editor after every state change.
   * If the PM doc changed (local edit), pushes the diff to Y.XmlFragment.
   * prosemirrorToYXmlFragment internally uses updateYFragment which computes
   * the minimal set of Y.js operations — it is CRDT-correct, not a full replace.
   */
  private readonly targetObserver = (): void => {
    // Block until the provider has synced the stored document.
    // Without this, the first dispatch pushes the editor's default empty
    // paragraph to Y.js before the server's content arrives.
    if (!this.synced) return;

    this.mux(() => {
      const currentDoc = this.editor.getState().doc;
      if (currentDoc === this.prevDoc) return; // no doc change
      this.prevDoc = currentDoc;

      this.ydoc.transact(() => {
        prosemirrorToYXmlFragment(currentDoc, this.type);
      }, LOCAL_ORIGIN);
    });
  };

  /**
   * Called by Collaboration.onEditorReady once the HocusPocus provider fires
   * its onSynced event. Enables the PM→Y.js direction of the binding.
   *
   * Also syncs prevDoc to the current state so the first edit after sync
   * compares against the loaded document, not null.
   */
  markSynced(): void {
    this.prevDoc = this.editor.getState().doc;
    this.synced = true;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  bind(): void {
    this.type.observeDeep(this.typeObserver);
    this.unbindEditor = this.editor.subscribe(this.targetObserver);
  }

  destroy(): void {
    this.type.unobserveDeep(this.typeObserver);
    this.unbindEditor?.();
    this.unbindEditor = null;
    this.undoManager.destroy();
  }
}
