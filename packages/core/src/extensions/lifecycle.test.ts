/**
 * Lifecycle split test — proves the `onEditorReady` / `onViewReady` contract:
 *
 *   1. `ServerEditor` calls `onEditorReady` (engine setup runs headlessly).
 *   2. `ServerEditor` never calls `onViewReady` (view-only setup is skipped).
 *   3. `Editor` calls both, in order: `onEditorReady` then `onViewReady`.
 *   4. Cleanup fns from both hooks run on `destroy()`.
 *   5. A view-only extension that uses `addOverlayRenderHandler` inside
 *      `onViewReady` loads in `ServerEditor` without crash (no guard, no
 *      cast — the hook simply never fires).
 *   6. A mixed extension can run engine setup on the server and view setup
 *      only in the browser.
 *
 * No mocks: instantiates real `ServerEditor` and real `Editor` with the
 * canvas-test setup wired in `vitest.setup.ts`.
 */
import { describe, it, expect, vi } from "vitest";
import { Editor } from "../Editor";
import { ServerEditor } from "../ServerEditor";
import { Extension } from "./Extension";
import { StarterKit } from "./StarterKit";

describe("extension lifecycle — onEditorReady + onViewReady", () => {
  it("ServerEditor calls onEditorReady but not onViewReady", () => {
    const editorReady = vi.fn();
    const viewReady = vi.fn();
    const ext = Extension.create({
      name: "lifecycle_server_test",
      onEditorReady: editorReady,
      onViewReady: viewReady,
    });

    const editor = new ServerEditor({ extensions: [StarterKit, ext] });

    expect(editorReady).toHaveBeenCalledTimes(1);
    expect(viewReady).not.toHaveBeenCalled();
    editor.destroy();
  });

  it("Editor calls onEditorReady first, then onViewReady", () => {
    const order: string[] = [];
    const ext = Extension.create({
      name: "lifecycle_order_test",
      onEditorReady() {
        order.push("editor");
      },
      onViewReady() {
        order.push("view");
      },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = new Editor({ extensions: [StarterKit, ext] });
    editor.mount(container);

    expect(order).toEqual(["editor", "view"]);

    editor.destroy();
    container.remove();
  });

  it("cleanup fns from both hooks run on destroy()", () => {
    const editorReadyCleanup = vi.fn();
    const viewReadyCleanup = vi.fn();
    const ext = Extension.create({
      name: "lifecycle_cleanup_test",
      onEditorReady() {
        return editorReadyCleanup;
      },
      onViewReady() {
        return viewReadyCleanup;
      },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = new Editor({ extensions: [StarterKit, ext] });
    editor.mount(container);

    expect(editorReadyCleanup).not.toHaveBeenCalled();
    expect(viewReadyCleanup).not.toHaveBeenCalled();

    editor.destroy();

    expect(editorReadyCleanup).toHaveBeenCalledTimes(1);
    expect(viewReadyCleanup).toHaveBeenCalledTimes(1);
    container.remove();
  });

  it("ServerEditor cleanup only runs the onEditorReady cleanup", () => {
    const editorReadyCleanup = vi.fn();
    const viewReadyCleanup = vi.fn();
    const ext = Extension.create({
      name: "lifecycle_server_cleanup_test",
      onEditorReady() {
        return editorReadyCleanup;
      },
      onViewReady() {
        return viewReadyCleanup;
      },
    });

    const editor = new ServerEditor({ extensions: [StarterKit, ext] });
    editor.destroy();

    expect(editorReadyCleanup).toHaveBeenCalledTimes(1);
    expect(viewReadyCleanup).not.toHaveBeenCalled();
  });

  it("a view-only extension calling addOverlayRenderHandler loads in ServerEditor without crash", () => {
    // Before the split this was the documented crash case — the extension
    // declared `onEditorReady(editor: IEditor)` and reached for
    // `editor.addOverlayRenderHandler(...)`, which doesn't exist on
    // headless. With the split, view-only setup belongs in `onViewReady`
    // and ServerEditor never fires it. No guard required.
    const handler = vi.fn();
    const ext = Extension.create({
      name: "lifecycle_view_only_test",
      onViewReady(editor) {
        // This call would throw on ServerEditor if the hook ran there.
        return editor.addOverlayRenderHandler(handler);
      },
    });

    expect(() => {
      const editor = new ServerEditor({ extensions: [StarterKit, ext] });
      editor.destroy();
    }).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it("a mixed extension runs engine setup on server and view setup only in browser", () => {
    const engineRan = vi.fn();
    const viewRan = vi.fn();
    const ext = Extension.create({
      name: "lifecycle_mixed_test",
      onEditorReady() {
        engineRan();
      },
      onViewReady() {
        viewRan();
      },
    });

    // Headless run — engine only.
    const server = new ServerEditor({ extensions: [StarterKit, ext] });
    expect(engineRan).toHaveBeenCalledTimes(1);
    expect(viewRan).not.toHaveBeenCalled();
    server.destroy();

    // Browser run — both.
    engineRan.mockClear();
    viewRan.mockClear();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = new Editor({ extensions: [StarterKit, ext] });
    editor.mount(container);

    expect(engineRan).toHaveBeenCalledTimes(1);
    expect(viewRan).toHaveBeenCalledTimes(1);

    editor.destroy();
    container.remove();
  });
});
