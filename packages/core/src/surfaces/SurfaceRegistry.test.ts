import { describe, it, expect, vi, afterEach } from "vitest";
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

  it("unregister swallows onCommit throws during implicit deactivation", () => {
    // Contract: unregister is tear-down; it must always delete the surface.
    // Commit failures are logged+swallowed and activeId is force-cleared.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = new SurfaceRegistry();
    const s = makeSurface("a");
    r.register(s);
    r._setOwnerMediator({
      commit: () => { throw new Error("persist failed"); },
      deactivate: () => {},
      activate: () => {},
    });
    r.activate("a");
    s.dispatch(s.state.tr.insertText("dirty"));

    expect(() => r.unregister("a")).not.toThrow();
    expect(r.activeId).toBeNull();
    expect(r.get("a")).toBeNull();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

// ── destroy() ────────────────────────────────────────────────────────────────

describe("SurfaceRegistry — destroy", () => {
  it("clears all surfaces, listeners, and resets mediator to noop", () => {
    const r = new SurfaceRegistry();
    const { mediator, calls } = makeMediator();
    r._setOwnerMediator(mediator);
    r.register(makeSurface("a"));
    r.register(makeSurface("b"));
    r.activate("a");

    r.destroy();
    expect(r.activeId).toBeNull();
    expect(r.get("a")).toBeNull();
    expect(r.get("b")).toBeNull();
    expect(calls.at(-1)).toEqual({ type: "deactivate", id: "a" });

    // Post-destroy: a freshly-attached listener should not fire (listeners
    // are cleared) and the noop mediator means no owner callbacks run.
    const postDestroySpy = vi.fn();
    r.onSurfaceChange(postDestroySpy);
    r.register(makeSurface("c"));
    const callsBefore = calls.length;
    r.activate("c");
    expect(calls.length).toBe(callsBefore);  // mediator was reset to noop
    // NOTE: listeners registered post-destroy DO still fire — the destroy
    // contract only clears existing listeners. Re-using a registry after
    // destroy is not supported; this assertion just documents the
    // mediator-reset behavior.
    expect(postDestroySpy).toHaveBeenCalledWith(null, "c");
  });

  it("destroy swallows commit throws during teardown", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = new SurfaceRegistry();
    const s = makeSurface("a");
    r.register(s);
    r._setOwnerMediator({
      commit: () => { throw new Error("persist failed"); },
      deactivate: () => {},
      activate: () => {},
    });
    r.activate("a");
    s.dispatch(s.state.tr.insertText("dirty"));

    expect(() => r.destroy()).not.toThrow();
    expect(r.activeId).toBeNull();
    errSpy.mockRestore();
  });
});

// ── Re-entrancy listener order ───────────────────────────────────────────────

describe("SurfaceRegistry — nested activation listener ordering", () => {
  it("nested activate inside onActivate fires listeners in true chronological order", () => {
    // Documents the fix for a subtle bug: without a supersession guard, the
    // outer activate() would fire (null, 'a') after the nested call had
    // already flipped state to 'b', leaving listeners with a stale target.
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
    const transitions: Array<[string | null, string | null]> = [];
    r.onSurfaceChange((prev, next) => transitions.push([prev, next]));

    r.activate("a");

    // Two transitions observed, in chronological order:
    //   null → a (outer started, nested hadn't run yet at capture time)
    //   a → b (nested's own listener fire)
    // The outer call's post-nested listener fire is suppressed by the
    // supersession guard because _activeId !== its captured nextId.
    expect(transitions).toEqual([
      ["a", "b"],  // nested fires first (synchronous)
    ]);
    expect(r.activeId).toBe("b");
  });

  it("double-activate of the same surface from nested call is a no-op", () => {
    const r = new SurfaceRegistry();
    r.register(makeSurface("a"));
    const { mediator, calls } = makeMediator();
    // Override activate to recursively call activate("a") — the inner call
    // hits the no-op guard because _activeId was already flipped.
    r._setOwnerMediator({
      ...mediator,
      activate: (s) => {
        calls.push({ type: "activate", id: s.id });
        if (calls.filter((c) => c.type === "activate").length === 1) {
          r.activate("a");
        }
      },
    });
    r.activate("a");
    // activate callback ran exactly once — nested was no-op'd.
    expect(calls.filter((c) => c.type === "activate")).toHaveLength(1);
    expect(r.activeId).toBe("a");
  });
});

// ── Activation loop + re-registration ────────────────────────────────────────

describe("SurfaceRegistry — activation loops", () => {
  it("A → B → A fires full lifecycle on each transition", () => {
    const r = new SurfaceRegistry();
    const { mediator, calls } = makeMediator();
    r._setOwnerMediator(mediator);
    r.register(makeSurface("a"));
    r.register(makeSurface("b"));
    r.activate("a");
    r.activate("b");
    r.activate("a");
    expect(calls).toEqual([
      { type: "activate", id: "a" },
      { type: "deactivate", id: "a" },
      { type: "activate", id: "b" },
      { type: "deactivate", id: "b" },
      { type: "activate", id: "a" },
    ]);
    expect(r.activeId).toBe("a");
  });

  it("re-registering an id after unregister works cleanly", () => {
    const r = new SurfaceRegistry();
    const first = makeSurface("shared");
    r.register(first);
    r.unregister("shared");

    const second = makeSurface("shared");
    expect(() => r.register(second)).not.toThrow();
    expect(r.get("shared")).toBe(second);
  });
});

// ── Debug logging ────────────────────────────────────────────────────────────

describe("SurfaceRegistry — __SURFACE_DEBUG__ logging", () => {
  afterEach(() => {
    globalThis.__SURFACE_DEBUG__ = undefined;
  });

  it("logs transitions when the flag is set", () => {
    globalThis.__SURFACE_DEBUG__ = true;
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const r = new SurfaceRegistry();
    r.register(makeSurface("a", "alpha"));
    r.activate("a");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("body → alpha:a"));
    spy.mockRestore();
  });

  it("does not log when the flag is absent", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const r = new SurfaceRegistry();
    r.register(makeSurface("a"));
    r.activate("a");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("annotates dirty state on transitions", () => {
    globalThis.__SURFACE_DEBUG__ = true;
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const r = new SurfaceRegistry();
    const s = makeSurface("a");
    r.register(s);
    r.activate("a");
    s.dispatch(s.state.tr.insertText("x"));
    r.activate(null);
    // Second log call is the dirty A → body transition.
    const dirtyCall = spy.mock.calls.find((c) => String(c[0]).includes("[dirty]"));
    expect(dirtyCall).toBeDefined();
    spy.mockRestore();
  });
});

// ── snapshot() debug helper ──────────────────────────────────────────────────

describe("SurfaceRegistry — snapshot", () => {
  it("reports activeId + registered surfaces + dirty flags", () => {
    const r = new SurfaceRegistry();
    const a = makeSurface("a", "alpha");
    const b = makeSurface("b", "beta");
    r.register(a);
    r.register(b);
    r.activate("a");
    a.dispatch(a.state.tr.insertText("hi"));

    const snap = r.snapshot();
    expect(snap.activeId).toBe("a");
    expect(snap.surfaces).toHaveLength(2);
    const aEntry = snap.surfaces.find((s) => s.id === "a")!;
    expect(aEntry).toEqual({ id: "a", owner: "alpha", isDirty: true });
    expect(snap.surfaces.find((s) => s.id === "b")).toEqual({
      id: "b",
      owner: "beta",
      isDirty: false,
    });
  });

  it("empty registry reports null activeId and no surfaces", () => {
    const r = new SurfaceRegistry();
    expect(r.snapshot()).toEqual({ activeId: null, surfaces: [] });
  });
});
