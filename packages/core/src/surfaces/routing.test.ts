import { describe, it, expect, beforeEach, vi } from "vitest";
import { Editor } from "../Editor";
import { Extension } from "../extensions/Extension";
import { StarterKit } from "../extensions/StarterKit";
import { EditorSurface } from "./EditorSurface";
import type { SurfaceOwnerRegistration } from "./types";

// ── Test harness ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    measureText: vi.fn((text: string) => ({
      width: text.length * 8,
      actualBoundingBoxAscent: 12,
      actualBoundingBoxDescent: 3,
      fontBoundingBoxAscent: 12,
      fontBoundingBoxDescent: 3,
    })),
    font: "",
  } as unknown as CanvasRenderingContext2D);
});

function mountEditor(extraExtensions: Extension[] = []): {
  editor: Editor;
  container: HTMLDivElement;
  type: (text: string) => void;
  cleanup: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  // Always bundle StarterKit so the schema is buildable — tests only add
  // their own extensions on top for lifecycle / lane coverage.
  const editor = new Editor({ extensions: [StarterKit, ...extraExtensions] });
  editor.mount(container);
  const type = (text: string): void => {
    const ta = container.querySelector("textarea")!;
    ta.value = text;
    ta.dispatchEvent(new Event("input"));
  };
  const cleanup = (): void => {
    editor.destroy();
    container.remove();
  };
  return { editor, container, type, cleanup };
}

function makeSurface(editor: Editor, id: string, owner: string): EditorSurface {
  return new EditorSurface({
    id,
    owner,
    schema: editor.schema,
    initialDocJSON: {
      type: "doc",
      content: [{ type: "paragraph" }],
    },
  });
}

// ── Body-active default ───────────────────────────────────────────────────────

describe("routing — body is the default active surface", () => {
  it("freshly-constructed Editor has null activeId and null activeSurface", () => {
    const { editor, cleanup } = mountEditor();
    expect(editor.surfaces.activeId).toBeNull();
    expect(editor.surfaces.activeSurface).toBeNull();
    cleanup();
  });

  it("textarea input dispatches into the flow doc when no surface is active", () => {
    const { editor, type, cleanup } = mountEditor();
    type("hello");
    expect(editor.getState().doc.textContent).toBe("hello");
    cleanup();
  });
});

// ── Surface-active routing ────────────────────────────────────────────────────

describe("routing — surface-active", () => {
  it("textarea input lands on the surface, not the flow doc", () => {
    const { editor, type, cleanup } = mountEditor();
    const surface = makeSurface(editor, "test:1", "test");
    editor.surfaces.register(surface);
    editor.surfaces.activate("test:1");

    const flowBefore = editor.getState().doc.toJSON();
    type("hello");

    expect(editor.getState().doc.toJSON()).toEqual(flowBefore); // Invariant 5
    expect(surface.state.doc.textContent).toBe("hello");
    cleanup();
  });

  it("activate(null) restores routing to the flow doc", () => {
    const { editor, type, cleanup } = mountEditor();
    const surface = makeSurface(editor, "test:1", "test");
    editor.surfaces.register(surface);
    editor.surfaces.activate("test:1");
    type("surface text");
    editor.surfaces.activate(null);
    type("body text");

    expect(surface.state.doc.textContent).toBe("surface text");
    expect(editor.getState().doc.textContent).toBe("body text");
    cleanup();
  });
});

// ── Invariant 5: editor.state always returns flow state ──────────────────────

describe("routing — Invariant 5 (editor.state is flow-bound)", () => {
  it("editor.getState() returns flow state while a surface is active", () => {
    const { editor, type, cleanup } = mountEditor();
    type("flow content");
    const flowState = editor.getState();

    const surface = makeSurface(editor, "test:1", "test");
    editor.surfaces.register(surface);
    editor.surfaces.activate("test:1");

    // editor.getState() should return the flow state unchanged.
    expect(editor.getState()).toBe(flowState);
    expect(editor.getState().doc.textContent).toBe("flow content");
    cleanup();
  });

  it("commands via editor.commands target the flow doc even when a surface is active", () => {
    const { editor, type, cleanup } = mountEditor();
    type("body content");
    const surface = makeSurface(editor, "test:1", "test");
    editor.surfaces.register(surface);
    editor.surfaces.activate("test:1");

    // Mutate flow via a dispatched tr bypassing surface routing.
    const tr = editor.getState().tr.insertText("!", 1);
    editor._applyTransaction(tr);
    expect(editor.getState().doc.textContent).toBe("!body content");
    expect(surface.state.doc.textContent).toBe(""); // untouched
    cleanup();
  });

  it("external _applyTransaction always hits flow state, never active surface", () => {
    const { editor, cleanup } = mountEditor();
    const surface = makeSurface(editor, "test:1", "test");
    editor.surfaces.register(surface);
    editor.surfaces.activate("test:1");

    const tr = editor.getState().tr.insertText("external");
    editor._applyTransaction(tr);

    expect(editor.getState().doc.textContent).toBe("external");
    expect(surface.state.doc.textContent).toBe("");
    cleanup();
  });
});

// ── Dirty flag behaviour ──────────────────────────────────────────────────────

describe("routing — dirty tracking", () => {
  it("typing into an active surface flips isDirty, markClean() clears it", () => {
    const { editor, type, cleanup } = mountEditor();
    const surface = makeSurface(editor, "test:1", "test");
    editor.surfaces.register(surface);
    editor.surfaces.activate("test:1");

    expect(surface.isDirty).toBe(false);
    type("hi");
    expect(surface.isDirty).toBe(true);
    surface.markClean();
    expect(surface.isDirty).toBe(false);
    cleanup();
  });
});

// ── Owner lifecycle via extensions ────────────────────────────────────────────

describe("routing — owner lifecycle fires via extension", () => {
  it("activating a surface fires the extension's onActivate hook", () => {
    const onActivate = vi.fn();
    const TestExt = Extension.create({
      name: "testSurfaceExt",
      addSurfaceOwner(): SurfaceOwnerRegistration {
        return { owner: "test", onActivate };
      },
    });
    const { editor, cleanup } = mountEditor([TestExt]);
    const surface = makeSurface(editor, "test:1", "test");
    editor.surfaces.register(surface);
    editor.surfaces.activate("test:1");
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith(surface);
    cleanup();
  });

  it("activate→activate(null) fires onCommit (if dirty) then onDeactivate in order", () => {
    const calls: string[] = [];
    const TestExt = Extension.create({
      name: "testSurfaceExt",
      addSurfaceOwner(): SurfaceOwnerRegistration {
        return {
          owner: "test",
          onActivate: () => calls.push("activate"),
          onCommit: () => calls.push("commit"),
          onDeactivate: () => calls.push("deactivate"),
        };
      },
    });
    const { editor, type, cleanup } = mountEditor([TestExt]);
    const surface = makeSurface(editor, "test:1", "test");
    editor.surfaces.register(surface);
    editor.surfaces.activate("test:1");
    type("dirty it");
    editor.surfaces.activate(null);
    expect(calls).toEqual(["activate", "commit", "deactivate"]);
    cleanup();
  });

  it("activate→activate(null) without dirty skips onCommit", () => {
    const calls: string[] = [];
    const TestExt = Extension.create({
      name: "testSurfaceExt",
      addSurfaceOwner(): SurfaceOwnerRegistration {
        return {
          owner: "test",
          onActivate: () => calls.push("activate"),
          onCommit: () => calls.push("commit"),
          onDeactivate: () => calls.push("deactivate"),
        };
      },
    });
    const { editor, cleanup } = mountEditor([TestExt]);
    const surface = makeSurface(editor, "test:1", "test");
    editor.surfaces.register(surface);
    editor.surfaces.activate("test:1");
    editor.surfaces.activate(null);
    expect(calls).toEqual(["activate", "deactivate"]);
    cleanup();
  });
});

// ── Collision detection at construction ──────────────────────────────────────

describe("routing — addSurfaceOwner collision detection", () => {
  it("two extensions claiming the same owner throw at Editor construction", () => {
    const A = Extension.create({
      name: "extA",
      addSurfaceOwner: () => ({ owner: "shared" }),
    });
    const B = Extension.create({
      name: "extB",
      addSurfaceOwner: () => ({ owner: "shared" }),
    });
    expect(() => new Editor({ extensions: [StarterKit, A, B] })).toThrow(
      /Surface owner "shared" is contributed by both "extA" and "extB"/,
    );
  });
});

// ── Error isolation ──────────────────────────────────────────────────────────

describe("routing — error isolation in lifecycle", () => {
  it("throwing onDeactivate does not block activation", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const TestExt = Extension.create({
      name: "testSurfaceExt",
      addSurfaceOwner: () => ({
        owner: "test",
        onDeactivate: () => { throw new Error("cleanup failed"); },
      }),
    });
    const { editor, cleanup } = mountEditor([TestExt]);
    editor.surfaces.register(makeSurface(editor, "a", "test"));
    editor.surfaces.register(makeSurface(editor, "b", "test"));
    editor.surfaces.activate("a");
    editor.surfaces.activate("b");
    expect(editor.surfaces.activeId).toBe("b");
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
    cleanup();
  });

  it("throwing onCommit aborts activation (state preserved)", () => {
    const TestExt = Extension.create({
      name: "testSurfaceExt",
      addSurfaceOwner: () => ({
        owner: "test",
        onCommit: () => { throw new Error("persist failed"); },
      }),
    });
    const { editor, type, cleanup } = mountEditor([TestExt]);
    const surface = makeSurface(editor, "test:1", "test");
    editor.surfaces.register(surface);
    editor.surfaces.activate("test:1");
    type("dirty");
    expect(() => editor.surfaces.activate(null)).toThrow(/persist failed/);
    expect(editor.surfaces.activeId).toBe("test:1"); // activation aborted
    cleanup();
  });
});

// ── Unregister-while-active ──────────────────────────────────────────────────

describe("routing — unregister while active", () => {
  it("unregistering the active surface nulls activeId and fires onSurfaceChange", () => {
    const { editor, cleanup } = mountEditor();
    editor.surfaces.register(makeSurface(editor, "test:1", "test"));
    editor.surfaces.activate("test:1");
    const spy = vi.fn();
    editor.surfaces.onSurfaceChange(spy);
    editor.surfaces.unregister("test:1");
    expect(editor.surfaces.activeId).toBeNull();
    expect(spy).toHaveBeenCalledWith("test:1", null);
    cleanup();
  });
});

// ── syncInputBridge defensive gate ───────────────────────────────────────────

describe("routing — syncInputBridge gates on active surface", () => {
  it("skips textarea positioning while a surface is active", () => {
    // Rationale: syncPosition resolves selection.head via flow-layout
    // coordinates. When a surface is active, head is a surface-doc position
    // and would resolve to garbage in flow space. Until PR 7 wires a
    // surface-aware viewport lookup, syncInputBridge is a no-op in the
    // active-surface case rather than producing wrong coordinates.
    const { editor, container, cleanup } = mountEditor();
    const textarea = container.querySelector("textarea")!;
    const topBefore = textarea.style.top;

    const surface = makeSurface(editor, "test:1", "test");
    editor.surfaces.register(surface);
    editor.surfaces.activate("test:1");
    surface.dispatch(surface.state.tr.insertText("hello"));
    editor.syncInputBridge();

    // Style unchanged — syncPosition was not called.
    expect(textarea.style.top).toBe(topBefore);
    cleanup();
  });
});
