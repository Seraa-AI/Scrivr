/**
 * A client learning that its room was sealed. It stops editing the moment it
 * knows, and says whether what it holds is what was sealed — or work of its own
 * the server refused, handed to the host rather than lost.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { ServerEditor, StarterKit } from "@scrivr/core";
import { TextSelection } from "@scrivr/core/pm";
import { YBinding, DOC_ATTRS_MAP_NAME, type DocAttrEnvelope } from "./YBinding";
import { snapshotFromYDoc, stampEditable, stampSeal } from "./revision";
import { watchRevision, type RevisionCallbacks } from "./watchRevision";

const SYNC_ORIGIN = "test-relay";

function client(callbacks: RevisionCallbacks, synced = true) {
  const editor = new ServerEditor({
    extensions: [StarterKit],
    content: { type: "doc", content: [{ type: "paragraph" }] },
  });
  const ydoc = new Y.Doc();
  const binding = new YBinding(
    editor,
    ydoc,
    ydoc.getXmlFragment("prosemirror"),
    ydoc.getMap<DocAttrEnvelope>(DOC_ATTRS_MAP_NAME),
  );
  binding.bind();
  let isSynced = synced;
  if (synced) binding.markSynced();
  const watcher = watchRevision(ydoc, editor, callbacks, () => isSynced);
  const sync = () => {
    isSynced = true;
    binding.markSynced();
    watcher.check();
  };
  return { editor, ydoc, binding, watcher, sync };
}

/** The server's copy of the room, relaying both ways until cut. */
function connect(server: Y.Doc, peer: Y.Doc): () => void {
  const toServer = (update: Uint8Array, origin: unknown) => {
    if (origin !== SYNC_ORIGIN) Y.applyUpdate(server, update, SYNC_ORIGIN);
  };
  const toPeer = (update: Uint8Array, origin: unknown) => {
    if (origin !== SYNC_ORIGIN) Y.applyUpdate(peer, update, SYNC_ORIGIN);
  };
  Y.applyUpdate(server, Y.encodeStateAsUpdate(peer), SYNC_ORIGIN);
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(server), SYNC_ORIGIN);
  peer.on("update", toServer);
  server.on("update", toPeer);
  return () => {
    peer.off("update", toServer);
    server.off("update", toPeer);
  };
}

const type = (editor: ServerEditor, text: string) => {
  const state = editor.getState();
  editor.applyTransaction(state.tr.setSelection(TextSelection.atEnd(state.doc)).insertText(text));
};

/** What a host does: seal the room's document and stamp the room. */
async function sealRoom(server: Y.Doc, schema: ServerEditor["schema"]) {
  const result = await snapshotFromYDoc(server, schema, { assignedRoles: [] });
  if (!result.ok) throw new Error(result.refusal.reason);
  const seal = { revisionId: "rev-1", contentHash: result.snapshot.contentHash, sealedAt: "2026-11-11T09:00:00.000Z" };
  stampSeal(server, seal);
  return { mode: "sealed" as const, ...seal };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

let cleanups: Array<() => void> = [];
beforeEach(() => {
  cleanups = [];
});
afterEach(() => cleanups.forEach((c) => c()));

describe("watchRevision", () => {
  it("seals the editor when the room is sealed, and confirms it holds what was sealed", async () => {
    const callbacks = { onSealed: vi.fn(), onStaleEdits: vi.fn() };
    const peer = client(callbacks);
    const server = new Y.Doc();
    cleanups.push(connect(server, peer.ydoc), peer.watcher.dispose);
    type(peer.editor, "Net 30.");

    const stamp = await sealRoom(server, peer.editor.schema);
    await flush();

    expect(peer.editor.sealed).toBe(true);
    expect(callbacks.onSealed).toHaveBeenCalledWith(stamp);
    expect(callbacks.onStaleEdits).not.toHaveBeenCalled();
  });

  it("hands over work the server never received, instead of losing it", async () => {
    const callbacks = { onSealed: vi.fn(), onStaleEdits: vi.fn() };
    const peer = client(callbacks);
    const server = new Y.Doc();
    const disconnect = connect(server, peer.ydoc);
    cleanups.push(peer.watcher.dispose);
    type(peer.editor, "Net 30.");
    disconnect();
    type(peer.editor, " Net 60.");

    const stamp = await sealRoom(server, peer.editor.schema);
    Y.applyUpdate(peer.ydoc, Y.encodeStateAsUpdate(server), SYNC_ORIGIN);
    await flush();

    expect(peer.editor.sealed).toBe(true);
    expect(callbacks.onSealed).not.toHaveBeenCalled();
    expect(callbacks.onStaleEdits).toHaveBeenCalledWith({
      stamp,
      content: expect.objectContaining({ type: "doc" }),
    });
    const stale: unknown = callbacks.onStaleEdits.mock.calls[0]?.[0];
    expect(JSON.stringify(stale)).toContain("Net 30. Net 60.");
  });

  it("stops editing at once, but judges the document only once the room has synced", async () => {
    const callbacks = { onSealed: vi.fn(), onStaleEdits: vi.fn() };
    const server = new Y.Doc();
    const author = client({});
    cleanups.push(connect(server, author.ydoc), author.watcher.dispose);
    type(author.editor, "Net 30.");
    const stamp = await sealRoom(server, author.editor.schema);

    const late = client(callbacks, false);
    cleanups.push(late.watcher.dispose);
    Y.applyUpdate(late.ydoc, Y.encodeStateAsUpdate(server), SYNC_ORIGIN);
    await flush();

    expect(late.editor.sealed).toBe(true);
    expect(callbacks.onSealed).not.toHaveBeenCalled();

    late.sync();
    await flush();
    expect(callbacks.onSealed).toHaveBeenCalledWith(stamp);
  });

  it("says nothing of a revision a client simply opens — or a host that remounts would never stop", () => {
    const server = new Y.Doc();
    stampEditable(server, { revisionId: "rev-2", parentRevisionId: "rev-1" });
    const callbacks = { onRevision: vi.fn() };
    const peer = client(callbacks);
    cleanups.push(connect(server, peer.ydoc), peer.watcher.dispose);

    expect(callbacks.onRevision).not.toHaveBeenCalled();
    expect(peer.editor.sealed).toBe(false);
  });

  it("reports a new revision, and leaves the sealed editor sealed for the host to replace", async () => {
    const callbacks = { onRevision: vi.fn() };
    const peer = client(callbacks);
    const server = new Y.Doc();
    cleanups.push(connect(server, peer.ydoc), peer.watcher.dispose);
    await sealRoom(server, peer.editor.schema);

    stampEditable(server, { revisionId: "rev-2", parentRevisionId: "rev-1" });

    expect(callbacks.onRevision).toHaveBeenCalledWith({ mode: "editable", revisionId: "rev-2", parentRevisionId: "rev-1" });
    expect(peer.editor.sealed).toBe(true);
  });
});
