import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { TextSelection } from "prosemirror-state";
import { ServerEditor, Extension, StarterKit } from "@scrivr/core";
import { YBinding } from "./YBinding";
import type { DocAttrEnvelope } from "./YBinding";

// ── Helpers ───────────────────────────────────────────────────────────────────
//
// Tests drive a real `ServerEditor` (BaseEditor) — its `getState`, `subscribe`,
// and `applyTransaction` are the same surface YBinding consumes in production.
// No `as unknown as IEditor` fake editor shape.

function makeEditor(text: string, cursorPos?: number): ServerEditor {
  const editor = new ServerEditor({
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: text ? [{ type: "text", text }] : [] },
      ],
    },
  });
  if (cursorPos !== undefined) {
    const state = editor.getState();
    editor.applyTransaction(
      state.tr.setSelection(TextSelection.create(state.doc, cursorPos)),
    );
  }
  return editor;
}

/**
 * Minimal extension that declares one or more doc-level attrs. Substitutes
 * for the real HeaderFooter extension so these tests don't couple to its
 * surface or commands — we only care that the attrs reach the whitelist.
 */
function makeDocAttrContributor(
  name: string,
  attrs: Record<string, unknown>,
) {
  return Extension.create({
    name,
    addDocAttrs() {
      const out: Record<string, { default: unknown }> = {};
      for (const [key, defaultValue] of Object.entries(attrs)) {
        out[key] = { default: defaultValue };
      }
      return out;
    },
  });
}

/** Spin up a ServerEditor + paired YBinding for one peer. */
interface PeerOptions {
  extensions?: Extension[];
}
function makePeer(options: PeerOptions = {}): {
  editor: ServerEditor;
  ydoc: Y.Doc;
  type: Y.XmlFragment;
  attrsMap: Y.Map<DocAttrEnvelope>;
  binding: YBinding;
} {
  const editor = new ServerEditor({
    extensions: options.extensions ?? [StarterKit],
    content: { type: "doc", content: [{ type: "paragraph" }] },
  });
  const ydoc = new Y.Doc();
  const type = ydoc.getXmlFragment("prosemirror");
  const attrsMap = ydoc.getMap<DocAttrEnvelope>("prose_doc_attrs");
  const binding = new YBinding(editor, ydoc, type, attrsMap);
  binding.bind();
  return { editor, ydoc, type, attrsMap, binding };
}

/**
 * Relay updates between two Y.Docs to simulate a connected pair of peers.
 * Filters on origin to break the echo loop. Returns an unsubscribe fn.
 */
function pairDocs(a: Y.Doc, b: Y.Doc): () => void {
  const SYNC_ORIGIN = "test-relay";
  const aListener = (update: Uint8Array, origin: unknown): void => {
    if (origin === SYNC_ORIGIN) return;
    Y.applyUpdate(b, update, SYNC_ORIGIN);
  };
  const bListener = (update: Uint8Array, origin: unknown): void => {
    if (origin === SYNC_ORIGIN) return;
    Y.applyUpdate(a, update, SYNC_ORIGIN);
  };
  a.on("update", aListener);
  b.on("update", bListener);
  return () => {
    a.off("update", aListener);
    b.off("update", bListener);
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("YBinding — markSynced cursor placement", () => {
  it("preserves cursor at start of document after first sync", () => {
    // typeObserver clamps cursor to Math.min(head, maxPos) — for an initial
    // empty-doc cursor at pos 2, this leaves it at pos 2 (start of content).
    const editor = makeEditor("Hello world from the server", 2);
    expect(editor.getState().selection.head).toBe(2);

    const ydoc      = new Y.Doc();
    const type      = ydoc.getXmlFragment("prosemirror");
    const attrsMap  = ydoc.getMap<DocAttrEnvelope>("prose_doc_attrs");
    const binding   = new YBinding(editor, ydoc, type, attrsMap);
    binding.bind();

    binding.markSynced();

    // Cursor stays where typeObserver left it — at the start of the content
    expect(editor.getState().selection.head).toBe(2);

    binding.destroy();
  });

  it("preserves cursor position across reconnects", () => {
    const editor = makeEditor("Hello world", 2);

    const ydoc      = new Y.Doc();
    const type      = ydoc.getXmlFragment("prosemirror");
    const attrsMap  = ydoc.getMap<DocAttrEnvelope>("prose_doc_attrs");
    const binding   = new YBinding(editor, ydoc, type, attrsMap);
    binding.bind();

    binding.markSynced();

    // User moves cursor to middle
    const midPos = 4;
    const beforeMove = editor.getState();
    editor.applyTransaction(
      beforeMove.tr.setSelection(TextSelection.create(beforeMove.doc, midPos)),
    );
    expect(editor.getState().selection.head).toBe(midPos);

    // Reconnect — markSynced does not move cursor
    binding.markSynced();
    expect(editor.getState().selection.head).toBe(midPos);

    binding.destroy();
  });

  it("cursor remains within document bounds after sync", () => {
    const editor = makeEditor("Some text here", 2);

    const ydoc      = new Y.Doc();
    const type      = ydoc.getXmlFragment("prosemirror");
    const attrsMap  = ydoc.getMap<DocAttrEnvelope>("prose_doc_attrs");
    const binding   = new YBinding(editor, ydoc, type, attrsMap);
    binding.bind();
    binding.markSynced();

    const state   = editor.getState();
    const sel     = state.selection;
    const docSize = state.doc.content.size;
    expect(sel.head).toBeGreaterThan(0);
    expect(sel.head).toBeLessThanOrEqual(docSize);

    binding.destroy();
  });
});

// ── Doc-attr sync (PM → Y.Map) ────────────────────────────────────────────────

describe("YBinding — doc-attr sync (PM → Y)", () => {
  const HeaderFooter = makeDocAttrContributor("headerFooter", {
    headerFooter: null,
  });

  it("setDocAttribute writes a DocAttrEnvelope to the attrs Y.Map", () => {
    const { editor, attrsMap, binding } = makePeer({
      extensions: [StarterKit, HeaderFooter],
    });
    binding.markSynced();

    const policy = { enabled: true, headerHeight: 36 };
    editor.applyTransaction(editor.getState().tr.setDocAttribute("headerFooter", policy));

    const envelope = attrsMap.get("headerFooter");
    expect(envelope).toBeDefined();
    expect(envelope?.localSeq).toBe(1);
    expect(envelope?.value).toEqual(policy);

    binding.destroy();
  });

  it("re-writing the same value does not bump localSeq (structural dedup)", () => {
    const { editor, attrsMap, binding } = makePeer({
      extensions: [StarterKit, HeaderFooter],
    });
    binding.markSynced();

    const policy = { enabled: true };
    editor.applyTransaction(editor.getState().tr.setDocAttribute("headerFooter", policy));
    editor.applyTransaction(
      editor.getState().tr.setDocAttribute("headerFooter", { ...policy }),
    );

    expect(attrsMap.get("headerFooter")?.localSeq).toBe(1);

    binding.destroy();
  });

  it("each structural change bumps localSeq", () => {
    const { editor, attrsMap, binding } = makePeer({
      extensions: [StarterKit, HeaderFooter],
    });
    binding.markSynced();

    editor.applyTransaction(editor.getState().tr.setDocAttribute("headerFooter", { v: 1 }));
    expect(attrsMap.get("headerFooter")?.localSeq).toBe(1);

    editor.applyTransaction(editor.getState().tr.setDocAttribute("headerFooter", { v: 2 }));
    expect(attrsMap.get("headerFooter")?.localSeq).toBe(2);

    editor.applyTransaction(editor.getState().tr.setDocAttribute("headerFooter", { v: 3 }));
    expect(attrsMap.get("headerFooter")?.localSeq).toBe(3);

    binding.destroy();
  });

  it("does not write to the Y.Map before markSynced", () => {
    // Pre-sync writes would clobber the room's policy with our local defaults.
    const { editor, attrsMap, binding } = makePeer({
      extensions: [StarterKit, HeaderFooter],
    });
    // Note: no binding.markSynced() yet.

    editor.applyTransaction(
      editor.getState().tr.setDocAttribute("headerFooter", { enabled: true }),
    );

    expect(attrsMap.has("headerFooter")).toBe(false);

    binding.destroy();
  });

  it("default-null attrs do not write to the Y.Map on first edit", () => {
    // markSynced seeds lastWrittenValue from PM, so the schema default
    // (null) is recognised as "no change" rather than emitting null over
    // the wire. Verified by triggering a doc edit that does NOT touch the
    // attr — the attrs Y.Map should remain empty.
    const { editor, attrsMap, binding } = makePeer({
      extensions: [StarterKit, HeaderFooter],
    });
    binding.markSynced();

    // Type a character — content changes, attr does not.
    const state = editor.getState();
    editor.applyTransaction(state.tr.insertText("x", 1));

    expect(attrsMap.size).toBe(0);

    binding.destroy();
  });
});

// ── Doc-attr sync (Y.Map → PM) ────────────────────────────────────────────────

describe("YBinding — doc-attr sync (Y → PM)", () => {
  const HeaderFooter = makeDocAttrContributor("headerFooter", {
    headerFooter: null,
  });

  it("applies a Y.Map envelope to PM doc.attrs after markSynced", () => {
    const { editor, ydoc, attrsMap, binding } = makePeer({
      extensions: [StarterKit, HeaderFooter],
    });

    const policy = { enabled: true, headerHeight: 36 };
    ydoc.transact(() => {
      attrsMap.set("headerFooter", { localSeq: 1, value: policy });
    });

    // Before markSynced, Y→PM is gated off.
    expect(editor.getState().doc.attrs.headerFooter).toBeNull();

    binding.markSynced();

    expect(editor.getState().doc.attrs.headerFooter).toEqual(policy);

    binding.destroy();
  });

  it("a subsequent envelope overwrites the PM attr", () => {
    const { editor, ydoc, attrsMap, binding } = makePeer({
      extensions: [StarterKit, HeaderFooter],
    });
    binding.markSynced();

    ydoc.transact(() => {
      attrsMap.set("headerFooter", { localSeq: 1, value: { v: 1 } });
    });
    expect(editor.getState().doc.attrs.headerFooter).toEqual({ v: 1 });

    ydoc.transact(() => {
      attrsMap.set("headerFooter", { localSeq: 2, value: { v: 2 } });
    });
    expect(editor.getState().doc.attrs.headerFooter).toEqual({ v: 2 });

    binding.destroy();
  });

  it("applied remote envelopes do not echo back to the Y.Map", () => {
    // applyAttrsFromMap updates lastWrittenValue so the subsequent
    // targetObserver pass sees the value as already-written.
    const { ydoc, attrsMap, binding } = makePeer({
      extensions: [StarterKit, HeaderFooter],
    });
    binding.markSynced();

    ydoc.transact(() => {
      attrsMap.set("headerFooter", { localSeq: 42, value: { remote: true } });
    });

    // Remote localSeq must be preserved — we did not stomp it with a new
    // local write under our own seq.
    expect(attrsMap.get("headerFooter")?.localSeq).toBe(42);

    binding.destroy();
  });
});

// ── Whitelist defense ────────────────────────────────────────────────────────

describe("YBinding — whitelist defense", () => {
  it("undeclared keys in the Y.Map are not applied to PM", () => {
    // Editor only declares headerFooter. Y.Map contains a foreign key
    // (e.g. from a peer running a newer extension set) — must be ignored.
    const HeaderFooter = makeDocAttrContributor("headerFooter", { headerFooter: null });
    const { editor, ydoc, attrsMap, binding } = makePeer({
      extensions: [StarterKit, HeaderFooter],
    });

    ydoc.transact(() => {
      attrsMap.set("footnotes", { localSeq: 1, value: { list: [] } });
    });

    binding.markSynced();

    // PM never grew a footnotes attr (it isn't in the schema).
    expect("footnotes" in editor.getState().doc.attrs).toBe(false);

    binding.destroy();
  });

  it("malformed envelopes (bare values, missing fields) are skipped", () => {
    const HeaderFooter = makeDocAttrContributor("headerFooter", { headerFooter: null });
    const { editor, ydoc, attrsMap, binding } = makePeer({
      extensions: [StarterKit, HeaderFooter],
    });

    // Inject a few shapes that aren't valid envelopes.
    ydoc.transact(() => {
      // Bare value (POC-style raw write from an older peer).
      attrsMap.set("headerFooter", { enabled: true } as unknown as DocAttrEnvelope);
    });
    binding.markSynced();
    expect(editor.getState().doc.attrs.headerFooter).toBeNull();

    binding.destroy();
  });
});

// ── Two-peer sync ────────────────────────────────────────────────────────────

describe("YBinding — two-peer sync", () => {
  const HeaderFooter = makeDocAttrContributor("headerFooter", { headerFooter: null });

  it("peer A's policy change propagates to peer B", () => {
    const a = makePeer({ extensions: [StarterKit, HeaderFooter] });
    const b = makePeer({ extensions: [StarterKit, HeaderFooter] });
    const unpair = pairDocs(a.ydoc, b.ydoc);
    a.binding.markSynced();
    b.binding.markSynced();

    const policy = { enabled: true, headerHeight: 36 };
    a.editor.applyTransaction(
      a.editor.getState().tr.setDocAttribute("headerFooter", policy),
    );

    expect(b.editor.getState().doc.attrs.headerFooter).toEqual(policy);

    unpair();
    a.binding.destroy();
    b.binding.destroy();
  });

  it("concurrent writes converge — both peers end up with the same value (Yjs LWW)", () => {
    const a = makePeer({ extensions: [StarterKit, HeaderFooter] });
    const b = makePeer({ extensions: [StarterKit, HeaderFooter] });
    a.binding.markSynced();
    b.binding.markSynced();

    // Concurrent edits while disconnected.
    a.editor.applyTransaction(
      a.editor.getState().tr.setDocAttribute("headerFooter", { from: "A" }),
    );
    b.editor.applyTransaction(
      b.editor.getState().tr.setDocAttribute("headerFooter", { from: "B" }),
    );

    // Now connect and exchange state.
    const unpair = pairDocs(a.ydoc, b.ydoc);
    Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc), "test-relay");
    Y.applyUpdate(a.ydoc, Y.encodeStateAsUpdate(b.ydoc), "test-relay");

    // Both peers converge — Yjs picks one winner per CRDT rules.
    expect(a.editor.getState().doc.attrs.headerFooter).toEqual(
      b.editor.getState().doc.attrs.headerFooter,
    );

    unpair();
    a.binding.destroy();
    b.binding.destroy();
  });
});

// ── Late join ────────────────────────────────────────────────────────────────

describe("YBinding — late join", () => {
  const HeaderFooter = makeDocAttrContributor("headerFooter", { headerFooter: null });

  it("a peer joining a room with an existing policy adopts it on markSynced", () => {
    const a = makePeer({ extensions: [StarterKit, HeaderFooter] });
    a.binding.markSynced();

    const policy = { enabled: true, fromHistory: true };
    a.editor.applyTransaction(
      a.editor.getState().tr.setDocAttribute("headerFooter", policy),
    );

    // Spin up B as a fresh peer that receives A's state — like a HocusPocus
    // provider firing onSynced with the persisted update.
    const b = makePeer({ extensions: [StarterKit, HeaderFooter] });
    Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc));

    // Before markSynced, B's PM has not yet adopted the policy.
    expect(b.editor.getState().doc.attrs.headerFooter).toBeNull();

    b.binding.markSynced();
    expect(b.editor.getState().doc.attrs.headerFooter).toEqual(policy);

    a.binding.destroy();
    b.binding.destroy();
  });

  it("late joiner does not stomp the existing policy with its local default", () => {
    const a = makePeer({ extensions: [StarterKit, HeaderFooter] });
    a.binding.markSynced();
    const policy = { enabled: true };
    a.editor.applyTransaction(
      a.editor.getState().tr.setDocAttribute("headerFooter", policy),
    );

    const b = makePeer({ extensions: [StarterKit, HeaderFooter] });
    Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc));
    b.binding.markSynced();

    // After markSynced, B's first edit should not have overwritten the policy.
    expect(b.attrsMap.get("headerFooter")?.value).toEqual(policy);

    a.binding.destroy();
    b.binding.destroy();
  });
});

// ── Undo with attrs in scope ─────────────────────────────────────────────────

describe("YBinding — undo manager covers doc-attr changes", () => {
  const HeaderFooter = makeDocAttrContributor("headerFooter", { headerFooter: null });

  it("undo reverses a setDocAttribute on both PM and Y.Map", () => {
    // Y.UndoManager merges rapid transactions into one capture group
    // (default 500ms window). stopCapturing() between dispatches makes
    // each set its own undo step — matches the user-visible "policy
    // change" granularity rather than per-keystroke granularity.
    const { editor, attrsMap, binding } = makePeer({
      extensions: [StarterKit, HeaderFooter],
    });
    binding.markSynced();

    editor.applyTransaction(
      editor.getState().tr.setDocAttribute("headerFooter", { v: 1 }),
    );
    expect(attrsMap.get("headerFooter")?.value).toEqual({ v: 1 });

    binding.undoManager.stopCapturing();
    editor.applyTransaction(
      editor.getState().tr.setDocAttribute("headerFooter", { v: 2 }),
    );
    expect(attrsMap.get("headerFooter")?.value).toEqual({ v: 2 });

    binding.undoManager.undo();
    expect(attrsMap.get("headerFooter")?.value).toEqual({ v: 1 });
    expect(editor.getState().doc.attrs.headerFooter).toEqual({ v: 1 });

    binding.undoManager.undo();
    expect(attrsMap.has("headerFooter")).toBe(false);
    expect(editor.getState().doc.attrs.headerFooter).toBeNull();

    binding.destroy();
  });
});
