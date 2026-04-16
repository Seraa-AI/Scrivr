import { describe, it, expect, vi } from "vitest";
import { Schema } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";
import { EditorSurface } from "./EditorSurface";

// Minimal schema isolated from the main editor schema — these tests exercise
// surface mechanics only, not real document semantics.
const miniSchema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", group: "block" },
    text: {},
  },
});

const emptyDocJSON = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

function makeSurface(id = "test:1", owner = "test"): EditorSurface {
  return new EditorSurface({ id, owner, schema: miniSchema, initialDocJSON: emptyDocJSON });
}

// ── Construction ──────────────────────────────────────────────────────────────

describe("EditorSurface — construction", () => {
  it("exposes id, owner, schema from init", () => {
    const s = makeSurface("headerFooter:default", "headerFooter");
    expect(s.id).toBe("headerFooter:default");
    expect(s.owner).toBe("headerFooter");
    expect(s.schema).toBe(miniSchema);
  });

  it("builds EditorState from initialDocJSON", () => {
    const s = makeSurface();
    expect(s.state.doc.type.name).toBe("doc");
    expect(s.state.doc.childCount).toBe(1); // one paragraph
  });

  it("starts clean and with an empty charMap", () => {
    const s = makeSurface();
    expect(s.isDirty).toBe(false);
    expect(s.charMap).toBeDefined();
  });
});

// ── Dispatch + isDirty ────────────────────────────────────────────────────────

describe("EditorSurface — dispatch", () => {
  it("flips isDirty on docChanged transaction", () => {
    const s = makeSurface();
    const tr = s.state.tr.insertText("hello");
    s.dispatch(tr);
    expect(s.isDirty).toBe(true);
  });

  it("does NOT flip isDirty on selection-only transaction", () => {
    const s = makeSurface();
    const tr = s.state.tr.setSelection(TextSelection.create(s.state.doc, 1));
    s.dispatch(tr);
    expect(s.isDirty).toBe(false);
  });

  it("markClean() clears the dirty flag", () => {
    const s = makeSurface();
    s.dispatch(s.state.tr.insertText("hi"));
    expect(s.isDirty).toBe(true);
    s.markClean();
    expect(s.isDirty).toBe(false);
  });

  it("dispatch advances state (content reflects the transaction)", () => {
    const s = makeSurface();
    s.dispatch(s.state.tr.insertText("hello"));
    expect(s.state.doc.textContent).toBe("hello");
  });
});

// ── _committing re-entry guard ────────────────────────────────────────────────

describe("EditorSurface — commit guard", () => {
  it("dispatch throws when _committing is set", () => {
    const s = makeSurface();
    s._committing = true;
    expect(() => s.dispatch(s.state.tr.insertText("x"))).toThrow(
      /dispatch\(\) called on "test:1" during its own onCommit/,
    );
  });

  it("dispatch works again once _committing is cleared", () => {
    const s = makeSurface();
    s._committing = true;
    expect(() => s.dispatch(s.state.tr.insertText("x"))).toThrow();
    s._committing = false;
    expect(() => s.dispatch(s.state.tr.insertText("y"))).not.toThrow();
  });
});

// ── toDocJSON ─────────────────────────────────────────────────────────────────

describe("EditorSurface — toDocJSON", () => {
  it("round-trips JSON → surface → toDocJSON", () => {
    const s = makeSurface();
    s.dispatch(s.state.tr.insertText("round trip"));
    const json = s.toDocJSON();

    const s2 = new EditorSurface({
      id: "r:2",
      owner: "test",
      schema: miniSchema,
      initialDocJSON: json,
    });
    expect(s2.state.doc.textContent).toBe("round trip");
  });
});

// ── onUpdate subscription ────────────────────────────────────────────────────

describe("EditorSurface — onUpdate", () => {
  it("fires synchronously after dispatch with a SurfaceUpdate payload", () => {
    const s = makeSurface();
    const spy = vi.fn();
    s.onUpdate(spy);
    const tr = s.state.tr.insertText("a");
    s.dispatch(tr);
    expect(spy).toHaveBeenCalledTimes(1);
    const update = spy.mock.calls[0]![0];
    expect(update.docChanged).toBe(true);
    expect(update.tr).toBe(tr);
    expect(update.state).toBe(s.state);
  });

  it("fires for selection-only transactions with docChanged:false", () => {
    // Renderers care about selection changes (cursor re-paint) even when
    // the doc hasn't changed — and need to distinguish from content changes.
    const s = makeSurface();
    const spy = vi.fn();
    s.onUpdate(spy);
    s.dispatch(s.state.tr.setSelection(TextSelection.create(s.state.doc, 1)));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].docChanged).toBe(false);
  });

  it("unsubscribe stops notifications", () => {
    const s = makeSurface();
    const spy = vi.fn();
    const unsub = s.onUpdate(spy);
    s.dispatch(s.state.tr.insertText("a"));
    unsub();
    s.dispatch(s.state.tr.insertText("b"));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("multiple subscribers all fire", () => {
    const s = makeSurface();
    const a = vi.fn();
    const b = vi.fn();
    s.onUpdate(a);
    s.onUpdate(b);
    s.dispatch(s.state.tr.insertText("x"));
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
  });

  it("re-dispatch from inside a listener runs synchronously and notifies", () => {
    // Contract: listeners may trigger further dispatches. Each dispatch
    // runs to completion before the outer dispatch returns — matches
    // BaseEditor's subscriber model. Uncaught exceptions would propagate.
    const s = makeSurface();
    const seen: number[] = [];
    let once = true;
    s.onUpdate((u) => {
      seen.push(u.state.doc.content.size);
      if (once) {
        once = false;
        s.dispatch(s.state.tr.insertText("!"));
      }
    });
    s.dispatch(s.state.tr.insertText("a"));
    // Two notifications: the outer "a" insert and the nested "!" insert.
    expect(seen.length).toBe(2);
    expect(seen[1]).toBeGreaterThan(seen[0]!);
  });
});
