import type * as Y from "yjs";
import { contentHashOf, type IBaseEditor } from "@scrivr/core";
import { readRevisionStamp, type EditableStamp, type RevisionStamp, type SealedStamp } from "./revision";

export interface RevisionCallbacks {
  /** The room was sealed, and this client holds exactly what was sealed. */
  onSealed?: (stamp: SealedStamp) => void;
  /**
   * The room was sealed, and this client holds work the seal does not — edits
   * the server never received or refused. `content` is this client's document,
   * for the host to keep as a fork of `stamp.revisionId` or let go. The editor
   * is sealed either way; reload the room to show what was sealed.
   */
  onStaleEdits?: (stale: { stamp: SealedStamp; content: Record<string, unknown> }) => void;
  /**
   * The room moved to a new editable revision. A sealed editor stays sealed —
   * a sealed revision is never edited in place — so mount a fresh one.
   */
  onRevision?: (stamp: EditableStamp) => void;
}

export interface RevisionWatcher {
  /** Judge the current stamp again — call once the room has synced. */
  check(): void;
  dispose(): void;
}

const sameStamp = (a: RevisionStamp | null, b: RevisionStamp | null): boolean =>
  a?.mode === b?.mode && a?.revisionId === b?.revisionId;

/**
 * Follow a room's revision stamp. When the room is sealed the editor seals at
 * once, so nothing more is typed into a revision someone approved; whether it
 * holds what was sealed is judged only after the room has synced, because the
 * document's attributes arrive with the sync.
 *
 * A host stamps a room after its content is in, and one connection delivers
 * updates in order, so a client holding the stamp holds the sealed content: a
 * difference is this client's own work.
 */
export function watchRevision(
  ydoc: Y.Doc,
  editor: IBaseEditor,
  callbacks: RevisionCallbacks,
  isSynced: () => boolean,
): RevisionWatcher {
  let seen: RevisionStamp | null = null;
  let judged: RevisionStamp | null = null;
  let disposed = false;

  const judge = (stamp: SealedStamp) => {
    if (!isSynced() || sameStamp(judged, stamp)) return;
    judged = stamp;
    const doc = editor.getState().doc;
    void contentHashOf(doc).then((hash) => {
      if (disposed) return;
      if (hash === stamp.contentHash) callbacks.onSealed?.(stamp);
      else callbacks.onStaleEdits?.({ stamp, content: doc.toJSON() });
    });
  };

  const check = () => {
    const stamp = readRevisionStamp(ydoc);
    if (!sameStamp(seen, stamp)) {
      // Only leaving a seal is news: a client opening an editable room has
      // nothing to replace, and a host that remounted on it would loop.
      const leftSeal = seen?.mode === "sealed";
      seen = stamp;
      if (stamp?.mode === "sealed") editor.seal();
      if (stamp?.mode === "editable" && leftSeal) callbacks.onRevision?.(stamp);
    }
    if (stamp?.mode === "sealed") judge(stamp);
  };

  ydoc.on("afterTransaction", check);
  check();
  return {
    check,
    dispose: () => {
      disposed = true;
      ydoc.off("afterTransaction", check);
    },
  };
}
