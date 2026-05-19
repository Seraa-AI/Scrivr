/**
 * YBinding — custom Y.js ↔ ProseMirror sync binding.
 *
 * Follows the same pattern as y-codemirror: observers wired together with a
 * mutex to prevent sync loops. Uses y-prosemirror's conversion utilities
 * (which internally call updateYFragment for proper tree-diffing) but
 * bypasses ProsemirrorBinding entirely — no EditorView shim required.
 *
 *   typeObserver    Y.XmlFragment       → PM content   (remote content arrives)
 *   attrsObserver   Y.Map("prose_doc_attrs") → PM attrs  (remote attrs arrive)
 *   targetObserver  PM doc + attrs      → Y.js          (local edits depart)
 *
 * Doc-level attributes (e.g. headerFooter policy) sync through a sibling
 * Y.Map keyed by attr name; values are wrapped in a `DocAttrEnvelope` so
 * future schema upgrades have a place to add metadata without breaking the
 * wire format. Yjs is authoritative for conflict resolution — the envelope's
 * `localSeq` is a local dedup hint only.
 *
 * Only attrs declared via `Extension.addDocAttrs()` (read from
 * `editor.getDocAttrNames()`) cross the wire. Foreign or undeclared keys in
 * the Y.Map are silently ignored — protects against schema drift between
 * peers loading different extension sets.
 *
 * Undo/redo is handled by Y.UndoManager, which scopes both the content
 * fragment and the attrs map under LOCAL_ORIGIN so a header policy change
 * is undoable like any other document edit.
 */
import * as Y from "yjs";
import { yXmlFragmentToProseMirrorRootNode, prosemirrorToYXmlFragment } from "y-prosemirror";
import type { Node } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import type { IBaseEditor } from "@scrivr/core";

/**
 * Wire format for a single doc-level attribute in `Y.Map("prose_doc_attrs")`.
 *
 * `localSeq` is a per-key counter incremented by the local peer on every
 * write. It is NOT a conflict resolver — Yjs has already decided which
 * concurrent write wins. The counter exists purely so future tooling can
 * detect "this is the same write we just made" without a structural compare.
 * Today's PM→Y dedup uses `lastWrittenValue` (structural equality); the
 * envelope shape is forward-compatibility for richer dedup if we need it.
 */
export interface DocAttrEnvelope<T = unknown> {
  localSeq: number;
  value: T;
}

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
   * Structural snapshot of the last value we wrote to (or read from) the
   * attrs Y.Map for each whitelisted attr. Compared via JSON.stringify
   * during PM→Y dedup so we don't echo a remote change back across the wire.
   *
   * v1 limitation: JSON.stringify is order-sensitive. Acceptable for the
   * flat policy POJOs in scope today; swap for a canonical serializer if
   * a future attr stores objects whose key order varies across peers.
   */
  private readonly lastWrittenValue: Record<string, unknown> = {};

  /**
   * Per-attr local sequence counter. Incremented on each PM→Y write of that
   * key so the envelope stamps a unique localSeq per write.
   */
  private readonly seq: Record<string, number> = {};

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
   * Y.js-aware undo manager. Tracks LOCAL_ORIGIN transactions on both the
   * content fragment AND the attrs map, so undo reverses content edits and
   * doc-attr policy changes alike.
   */
  readonly undoManager: Y.UndoManager;

  private unbindEditor: (() => void) | null = null;

  constructor(
    private readonly editor: IBaseEditor,
    private readonly ydoc: Y.Doc,
    private readonly type: Y.XmlFragment,
    private readonly attrsMap: Y.Map<DocAttrEnvelope>,
  ) {
    this.undoManager = new Y.UndoManager([type, attrsMap], {
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
      this.editor.applyTransaction(tr);
    });
  };

  /**
   * Called by Y.js whenever the attrs Y.Map changes (local or remote).
   * Routes each whitelisted, structurally-changed envelope into a
   * `tr.setDocAttribute` on the PM state.
   *
   * Defensive layering — drops anything that doesn't fit the contract so a
   * malformed peer write can't crash the editor:
   *   1. Whitelist: keys not in `editor.getDocAttrNames()` are ignored.
   *   2. Envelope shape: bare values or missing `value` field are ignored.
   *   3. Structural equality: skip when the PM attr already matches.
   */
  private readonly attrsObserver = (): void => {
    if (!this.synced) return;
    this.mux(() => {
      this.applyAttrsFromMap();
    });
  };

  private applyAttrsFromMap(): void {
    const state = this.editor.getState();
    const docSpecAttrs = state.schema.nodes["doc"]?.spec.attrs ?? {};

    for (const key of this.editor.getDocAttrNames()) {
      const envelope = this.attrsMap.get(key);

      // Key absent in Y.Map → reset PM to the schema default. This is the
      // delete-side of the wire: an undo that removed the key on peer A
      // must clear the attr on peer B too.
      if (envelope === undefined) {
        const defaultValue = docSpecAttrs[key]?.default ?? null;
        if (!structuralEqual(state.doc.attrs[key], defaultValue)) {
          this.editor.applyTransaction(
            state.tr.setDocAttribute(key, defaultValue),
          );
        }
        this.lastWrittenValue[key] = defaultValue;
        continue;
      }

      // Defensive: malformed envelope from an old peer or hand-written write.
      if (!isDocAttrEnvelope(envelope)) continue;

      const current = state.doc.attrs[key];
      if (!structuralEqual(current, envelope.value)) {
        this.editor.applyTransaction(state.tr.setDocAttribute(key, envelope.value));
      }
      // Mark this value as known so the subsequent targetObserver pass
      // doesn't echo it back to the Y.Map under our own LOCAL_ORIGIN.
      this.lastWrittenValue[key] = envelope.value;
    }
  }

  // ── PM → Y.js ───────────────────────────────────────────────────────────────

  /**
   * Called by the editor after every state change.
   * Syncs both doc content (Y.XmlFragment) and doc attrs (attrs Y.Map) in a
   * single LOCAL_ORIGIN transact so peers receive them as one update.
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
      const contentChanged = currentDoc !== this.prevDoc;
      const attrsToWrite = this.collectChangedAttrs(currentDoc);

      if (!contentChanged && attrsToWrite.length === 0) return;
      this.prevDoc = currentDoc;

      this.ydoc.transact(() => {
        if (contentChanged) {
          prosemirrorToYXmlFragment(currentDoc, this.type);
        }
        for (const { key, value } of attrsToWrite) {
          const localSeq = (this.seq[key] ?? 0) + 1;
          this.seq[key] = localSeq;
          this.lastWrittenValue[key] = value;
          this.attrsMap.set(key, { localSeq, value });
        }
      }, LOCAL_ORIGIN);
    });
  };

  /**
   * Walk the whitelist and pick out attrs whose PM value differs structurally
   * from `lastWrittenValue`. The whitelist comes from `addDocAttrs()` so
   * private fields and foreign extension state never leave the local editor.
   */
  private collectChangedAttrs(doc: Node): Array<{ key: string; value: unknown }> {
    const out: Array<{ key: string; value: unknown }> = [];
    for (const key of this.editor.getDocAttrNames()) {
      const value = doc.attrs[key];
      if (structuralEqual(value, this.lastWrittenValue[key])) continue;
      out.push({ key, value });
    }
    return out;
  }

  /**
   * Called by Collaboration.onEditorReady once the HocusPocus provider fires
   * its onSynced event. Applies any pre-existing attrs from the Y.Map onto
   * the PM state, seeds the dedup tables, and then enables the PM→Y.js
   * direction so a late-joining peer sees the room's current header policy
   * but doesn't immediately push its local defaults over it.
   */
  markSynced(): void {
    // synced is still false here — applyAttrsFromMap() can dispatch
    // transactions safely; targetObserver early-returns on !synced so we
    // won't bounce anything back to the wire. applyAttrsFromMap seeds
    // lastWrittenValue for every whitelist key (including absent ones,
    // which it reads from the schema default), so the first PM->Y pass
    // doesn't emit a wasted default envelope on every fresh peer.
    this.mux(() => {
      this.applyAttrsFromMap();
    });
    this.prevDoc = this.editor.getState().doc;
    this.synced = true;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  bind(): void {
    this.type.observeDeep(this.typeObserver);
    this.attrsMap.observe(this.attrsObserver);
    this.unbindEditor = this.editor.subscribe(this.targetObserver);
  }

  destroy(): void {
    this.type.unobserveDeep(this.typeObserver);
    this.attrsMap.unobserve(this.attrsObserver);
    this.unbindEditor?.();
    this.unbindEditor = null;
    this.undoManager.destroy();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isDocAttrEnvelope(value: unknown): value is DocAttrEnvelope {
  if (value === null || typeof value !== "object") return false;
  return "value" in value && "localSeq" in value;
}

/**
 * Structural equality for doc-attr POJOs. Wraps JSON.stringify so the dedup
 * paths read clearly — see the `lastWrittenValue` field comment for the
 * known limitation.
 */
function structuralEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}
