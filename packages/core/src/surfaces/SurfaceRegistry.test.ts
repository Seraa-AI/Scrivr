import { describe, it, expect, vi } from "vitest";
import { Schema } from "prosemirror-model";
import { EditorSurface } from "./EditorSurface";
import { SurfaceRegistry, type SurfaceOwnerMediator } from "./SurfaceRegistry";

const miniSchema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", group: "block" },
    text: {},
  },
});
const emptyDocJSON = { type: "doc", content: [{ type: "paragraph" }] };

function makeSurface(id: string, owner = "test"): EditorSurface {
  return new EditorSurface({ id, owner, schema: miniSchema, initialDocJSON: emptyDocJSON });
}

function makeMediator(): {
  mediator: SurfaceOwnerMediator;
  calls: Array<{ type: "commit" | "deactivate" | "activate"; id: string }>;
} {
  const calls: Array<{ type: "commit" | "deactivate" | "activate"; id: string }> = [];
  return {
    calls,
    mediator: {
      commit: (s) => calls.push({ type: "commit", id: s.id }),
      deactivate: (s) => calls.push({ type: "deactivate", id: s.id }),
      activate: (s) => calls.push({ type: "activate", id: s.id }),
    },
  };
}

// ── Registration ──────────────────────────────────────────────────────────────

describe("SurfaceRegistry — registration", () => {
  it("register/get round-trip", () => {
    const r = new SurfaceRegistry();
    const s = makeSurface("a");
    r.register(s);
    expect(r.get("a")).toBe(s);
  });

  it("get returns null for unknown id", () => {
    const r = new SurfaceRegistry();
    expect(r.get("missing")).toBeNull();
  });

  it("duplicate id throws", () => {
    const r = new SurfaceRegistry();
    r.register(makeSurface("dup"));
    expect(() => r.register(makeSurface("dup"))).toThrow(/already registered/);
  });

  it("getByOwner returns all surfaces for an owner", () => {
    const r = new SurfaceRegistry();
    r.register(makeSurface("a:1", "alpha"));
    r.register(makeSurface("a:2", "alpha"));
    r.register(makeSurface("b:1", "beta"));
    expect(r.getByOwner("alpha")).toHaveLength(2);
    expect(r.getByOwner("beta")).toHaveLength(1);
    expect(r.getByOwner("gamma")).toHaveLength(0);
  });

  it("unregister removes the surface", () => {
    const r = new SurfaceRegistry();
    r.register(makeSurface("a"));
    r.unregister("a");
    expect(r.get("a")).toBeNull();
  });
});

// ── Initial state ─────────────────────────────────────────────────────────────

describe("SurfaceRegistry — initial state", () => {
  it("activeId is null at construction (body is active)", () => {
    const r = new SurfaceRegistry();
    expect(r.activeId).toBeNull();
    expect(r.activeSurface).toBeNull();
  });
});

// ── Activation ────────────────────────────────────────────────────────────────

describe("SurfaceRegistry — activation", () => {
  it("activate(id) sets activeId and activeSurface", () => {
    const r = new SurfaceRegistry();
    const s = makeSurface("a");
    r.register(s);
    r.activate("a");
    expect(r.activeId).toBe("a");
    expect(r.activeSurface).toBe(s);
  });

  it("activate(null) returns to body", () => {
    const r = new SurfaceRegistry();
    r.register(makeSurface("a"));
    r.activate("a");
    r.activate(null);
    expect(r.activeId).toBeNull();
    expect(r.activeSurface).toBeNull();
  });

  it("activate(currentId) is a no-op (no callbacks fire)", () => {
    const r = new SurfaceRegistry();
    const { mediator, calls } = makeMediator();
    r._setOwnerMediator(mediator);
    r.register(makeSurface("a"));
    r.activate("a");
    calls.length = 0;
    r.activate("a"); // no-op
    expect(calls).toEqual([]);
  });

  it("activate(unknownId) throws", () => {
    const r = new SurfaceRegistry();
    expect(() => r.activate("nope")).toThrow(/no such surface/);
  });
});

// ── Owner mediator lifecycle ──────────────────────────────────────────────────

describe("SurfaceRegistry — owner lifecycle", () => {
  it("activate(id) from null fires only activate(next)", () => {
    const r = new SurfaceRegistry();
    const { mediator, calls } = makeMediator();
    r._setOwnerMediator(mediator);
    r.register(makeSurface("a"));
    r.activate("a");
    expect(calls).toEqual([{ type: "activate", id: "a" }]);
  });

  it("activate(null) from id fires deactivate(prev) only (no commit if clean)", () => {
    const r = new SurfaceRegistry();
    const { mediator, calls } = makeMediator();
    r._setOwnerMediator(mediator);
    r.register(makeSurface("a"));
    r.activate("a");
    calls.length = 0;
    r.activate(null);
    expect(calls).toEqual([{ type: "deactivate", id: "a" }]);
  });

  it("activate(null) from dirty id fires commit then deactivate (in order)", () => {
    const r = new SurfaceRegistry();
    const { mediator, calls } = makeMediator();
    r._setOwnerMediator(mediator);
    const s = makeSurface("a");
    r.register(s);
    r.activate("a");
    s.dispatch(s.state.tr.insertText("dirty")); // flip isDirty
    calls.length = 0;
    r.activate(null);
    expect(calls).toEqual([
      { type: "commit", id: "a" },
      { type: "deactivate", id: "a" },
    ]);
  });

  it("activate(b) from dirty a fires commit(a) → deactivate(a) → activate(b)", () => {
    const r = new SurfaceRegistry();
    const { mediator, calls } = makeMediator();
    r._setOwnerMediator(mediator);
    const a = makeSurface("a");
    r.register(a);
    r.register(makeSurface("b"));
    r.activate("a");
    a.dispatch(a.state.tr.insertText("x"));
    calls.length = 0;
    r.activate("b");
    expect(calls).toEqual([
      { type: "commit", id: "a" },
      { type: "deactivate", id: "a" },
      { type: "activate", id: "b" },
    ]);
  });

  it("commit throw aborts activation", () => {
    const r = new SurfaceRegistry();
    const s = makeSurface("a");
    r.register(s);
    r._setOwnerMediator({
      commit: () => { throw new Error("persist failed"); },
      deactivate: () => {},
      activate: () => {},
    });
    r.activate("a");
    s.dispatch(s.state.tr.insertText("x"));
    expect(() => r.activate(null)).toThrow(/persist failed/);
    // activeId stays the same — abort preserves state.
    expect(r.activeId).toBe("a");
  });

  it("deactivate throw is logged but does not block activation", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = new SurfaceRegistry();
    r.register(makeSurface("a"));
    r.register(makeSurface("b"));
    r._setOwnerMediator({
      commit: () => {},
      deactivate: () => { throw new Error("boom"); },
      activate: () => {},
    });
    r.activate("a");
    r.activate("b");
    expect(r.activeId).toBe("b");
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("activate throw is logged but activeId is already updated", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = new SurfaceRegistry();
    r.register(makeSurface("a"));
    r._setOwnerMediator({
      commit: () => {},
      deactivate: () => {},
      activate: () => { throw new Error("boom"); },
    });
    r.activate("a");
    expect(r.activeId).toBe("a");
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("commit clears _committing even when it throws", () => {
    const r = new SurfaceRegistry();
    const s = makeSurface("a");
    r.register(s);
    r._setOwnerMediator({
      commit: () => { throw new Error("fail"); },
      deactivate: () => {},
      activate: () => {},
    });
    r.activate("a");
    s.dispatch(s.state.tr.insertText("x"));
    expect(() => r.activate(null)).toThrow();
    expect(s._committing).toBe(false);
  });
});

// ── Re-entrancy ──────────────────────────────────────────────────────────────

describe("SurfaceRegistry — re-entrancy", () => {
  it("onActivate calling activate(otherId) nests and leaves otherId active", () => {
    const r = new SurfaceRegistry();
    r.register(makeSurface("a"));
    r.register(makeSurface("b"));
    r._setOwnerMediator({
      commit: () => {},
      deactivate: () => {},
      activate: (s) => {
        if (s.id === "a") r.activate("b");
      },
    });
    r.activate("a");
    expect(r.activeId).toBe("b");
  });
});

// ── onSurfaceChange ──────────────────────────────────────────────────────────

describe("SurfaceRegistry — onSurfaceChange", () => {
  it("fires after activation with (prev, next) ids", () => {
    const r = new SurfaceRegistry();
    r.register(makeSurface("a"));
    const spy = vi.fn();
    r.onSurfaceChange(spy);
    r.activate("a");
    expect(spy).toHaveBeenCalledWith(null, "a");
  });

  it("fires with (id, null) when returning to body", () => {
    const r = new SurfaceRegistry();
    r.register(makeSurface("a"));
    r.activate("a");
    const spy = vi.fn();
    r.onSurfaceChange(spy);
    r.activate(null);
    expect(spy).toHaveBeenCalledWith("a", null);
  });

  it("does not fire on no-op activate", () => {
    const r = new SurfaceRegistry();
    r.register(makeSurface("a"));
    r.activate("a");
    const spy = vi.fn();
    r.onSurfaceChange(spy);
    r.activate("a"); // no-op
    expect(spy).not.toHaveBeenCalled();
  });

  it("unsubscribe stops notifications", () => {
    const r = new SurfaceRegistry();
    r.register(makeSurface("a"));
    const spy = vi.fn();
    const unsub = r.onSurfaceChange(spy);
    r.activate("a");
    unsub();
    r.activate(null);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

// ── Unregister-while-active ──────────────────────────────────────────────────

describe("SurfaceRegistry — unregister while active", () => {
  it("unregistering the active surface clears activeId and fires onSurfaceChange", () => {
    const r = new SurfaceRegistry();
    r.register(makeSurface("a"));
    r.activate("a");
    const spy = vi.fn();
    r.onSurfaceChange(spy);
    r.unregister("a");
    expect(r.activeId).toBeNull();
    expect(r.get("a")).toBeNull();
    expect(spy).toHaveBeenCalledWith("a", null);
  });

  it("unregistering a non-active surface does not touch activeId", () => {
    const r = new SurfaceRegistry();
    r.register(makeSurface("a"));
    r.register(makeSurface("b"));
    r.activate("a");
    r.unregister("b");
    expect(r.activeId).toBe("a");
  });

  it("unregister of unknown id is a no-op", () => {
    const r = new SurfaceRegistry();
    expect(() => r.unregister("missing")).not.toThrow();
  });
});
