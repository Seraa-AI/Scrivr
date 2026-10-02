/**
 * Headless collaboration: the Collaboration extension must wire its Y binding
 * and provider on `onEditorReady`, which fires in both browser `Editor` and
 * headless `ServerEditor`. Before this, setup lived in `onViewReady` — never
 * fired without a view — so `ServerEditor` never connected.
 */
import { describe, it, expect, vi } from "vitest";

// Stub the provider so the test never opens a real WebSocket.
vi.mock("@hocuspocus/provider", () => ({
  HocuspocusProvider: class {
    constructor(_opts: unknown) {}
    destroy(): void {}
  },
}));

import { ServerEditor, StarterKit } from "@scrivr/core";
import { Collaboration } from "./Collaboration";
import { collaborationRegistry } from "./collaborationState";

describe("Collaboration — headless (ServerEditor)", () => {
  it("wires the Y binding + provider on onEditorReady, with no view", () => {
    const editor = new ServerEditor({
      content: "hello",
      extensions: [
        StarterKit.configure({ history: false }),
        Collaboration.configure({ url: "ws://test", name: "room-1" }),
      ],
    });

    // onEditorReady fires synchronously during construction — the provider and
    // Y.Doc register even though there is no view (onViewReady never fires
    // headless). setReady is skipped (guarded) since ServerEditor has none.
    const state = collaborationRegistry.get(editor);
    expect(state).toBeDefined();
    expect(state?.provider).toBeDefined();
    expect(state?.ydoc).toBeDefined();

    editor.destroy();
  });
});

describe("Collaboration — one configured extension, two editors", () => {
  /** The natural split-view shape: configure once, mount twice. */
  const shared = () => Collaboration.configure({ url: "ws://test", name: "room-1" });

  const editorWith = (ext: ReturnType<typeof shared>) =>
    new ServerEditor({
      content: "hello",
      extensions: [StarterKit.configure({ history: false }), ext],
    });

  it("gives each editor its own binding", () => {
    const ext = shared();
    const a = editorWith(ext);
    const b = editorWith(ext);

    const bindingA = collaborationRegistry.get(a)?.binding;
    const bindingB = collaborationRegistry.get(b)?.binding;

    expect(bindingA).toBeTruthy();
    expect(bindingB).toBeTruthy();
    expect(bindingA).not.toBe(bindingB);
  });

  it("leaves the first editor's binding in place when a second is built", () => {
    // Seeding was keyed on the extension's options, so constructing the second
    // editor reset the entry the first was reading — undo and redo went dead
    // in a pane nobody had touched.
    const ext = shared();
    const a = editorWith(ext);
    const beforeSecond = collaborationRegistry.get(a)?.binding;

    editorWith(ext);

    expect(collaborationRegistry.get(a)?.binding).toBe(beforeSecond);
    expect(collaborationRegistry.get(a)?.binding).toBeTruthy();
  });

  it("leaves the first editor's binding in place when the second is destroyed", () => {
    // Teardown nulled the shared entry, so closing one pane disarmed the other.
    const ext = shared();
    const a = editorWith(ext);
    const b = editorWith(ext);
    const bindingA = collaborationRegistry.get(a)?.binding;

    b.destroy();

    expect(collaborationRegistry.get(a)?.binding).toBe(bindingA);
    expect(collaborationRegistry.get(b)).toBeUndefined();
  });
});
