/**
 * A room's revision, as a host's server sees it. The host owns the seal — its
 * lock, its record, its auth; these are what it calls from its own hooks so
 * the boundary is the same in every client and in its own cache.
 */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { prosemirrorToYXmlFragment } from "y-prosemirror";
import { BUILT_IN_FIELD_KINDS, Field, ServerEditor, StarterKit, createSnapshot } from "@scrivr/core";
import {
  isSealed,
  matchesSnapshot,
  readRevisionStamp,
  resetToSnapshot,
  seedDocAttrs,
  snapshotFromYDoc,
  stampEditable,
  stampSeal,
  REVISION_MAP_NAME,
} from "../index";

const contract = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Net 30." }] },
    {
      type: "paragraph",
      content: [{ type: "field", attrs: { nodeId: "f1", kind: "signature", fill: "signer", role: "client", required: true } }],
    },
  ],
};

const editor = new ServerEditor({ extensions: [StarterKit, Field], content: contract });
const { schema } = editor;

/** A room holding `doc`, as a host's server would load it. */
function room(doc = editor.getState().doc): Y.Doc {
  const ydoc = new Y.Doc();
  prosemirrorToYXmlFragment(doc, ydoc.getXmlFragment("prosemirror"));
  seedDocAttrs(ydoc, doc.attrs, editor.getDocAttrNames());
  return ydoc;
}

describe("snapshotFromYDoc", () => {
  it("seals the room's document as the editor would", async () => {
    const fromRoom = await snapshotFromYDoc(room(), schema, { kinds: BUILT_IN_FIELD_KINDS, assignedRoles: ["client"] });
    const fromEditor = await createSnapshot(editor.getState().doc, { kinds: BUILT_IN_FIELD_KINDS, assignedRoles: ["client"] });

    expect(fromRoom).toEqual(fromEditor);
  });

  it("includes the room's document attributes", async () => {
    const attr = editor.getDocAttrNames()[0]!;
    const withPolicy = editor.getState().tr.setDocAttribute(attr, { changed: true }).doc;

    const plain = await snapshotFromYDoc(room(), schema, { kinds: BUILT_IN_FIELD_KINDS, assignedRoles: ["client"] });
    const changed = await snapshotFromYDoc(room(withPolicy), schema, { kinds: BUILT_IN_FIELD_KINDS, assignedRoles: ["client"] });

    expect(plain.ok && changed.ok && plain.snapshot.contentHash !== changed.snapshot.contentHash).toBe(true);
  });
});

describe("the revision stamp", () => {
  it("is read as sealed once stamped, by every peer that syncs the room", () => {
    const server = room();
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(server));
    expect(isSealed(peer)).toBe(false);

    stampSeal(server, { revisionId: "rev-1", contentHash: "sha256:abc", sealedAt: "2026-11-11T09:00:00.000Z" });
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(server));

    expect(isSealed(peer)).toBe(true);
    expect(readRevisionStamp(peer)).toEqual({
      mode: "sealed",
      revisionId: "rev-1",
      contentHash: "sha256:abc",
      sealedAt: "2026-11-11T09:00:00.000Z",
    });
  });

  it("unseals as a new revision that descends from the sealed one", () => {
    const ydoc = room();
    stampSeal(ydoc, { revisionId: "rev-1", contentHash: "sha256:abc", sealedAt: "2026-11-11T09:00:00.000Z" });

    stampEditable(ydoc, { revisionId: "rev-2", parentRevisionId: "rev-1" });

    expect(isSealed(ydoc)).toBe(false);
    expect(readRevisionStamp(ydoc)).toEqual({ mode: "editable", revisionId: "rev-2", parentRevisionId: "rev-1" });
  });

  it("is absent from a room that was never stamped, and ignored when malformed", () => {
    const ydoc = room();
    expect(readRevisionStamp(ydoc)).toBeNull();

    ydoc.getMap(REVISION_MAP_NAME).set("stamp", { mode: "sealed", revisionId: 7 });

    expect(readRevisionStamp(ydoc)).toBeNull();
    expect(isSealed(ydoc)).toBe(false);
  });
});

describe("a room that drifted from its seal", () => {
  it("is caught, and put back to exactly what was sealed", async () => {
    const ydoc = room();
    const sealed = await snapshotFromYDoc(ydoc, schema, { kinds: BUILT_IN_FIELD_KINDS, assignedRoles: ["client"] });
    if (!sealed.ok) throw new Error("expected a snapshot");
    const { content, contentHash } = sealed.snapshot;

    // An edit that reached the room's cache after the seal.
    const paragraph = ydoc.getXmlFragment("prosemirror").get(0);
    if (!(paragraph instanceof Y.XmlElement)) throw new Error("expected a paragraph");
    const text = paragraph.get(0);
    if (!(text instanceof Y.XmlText)) throw new Error("expected text");
    text.insert(4, "6");

    expect(await matchesSnapshot(ydoc, schema, contentHash)).toBe(false);

    resetToSnapshot(ydoc, schema, content);

    expect(await matchesSnapshot(ydoc, schema, contentHash)).toBe(true);
  });
});
