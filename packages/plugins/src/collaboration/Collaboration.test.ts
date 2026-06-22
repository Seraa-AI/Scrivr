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
