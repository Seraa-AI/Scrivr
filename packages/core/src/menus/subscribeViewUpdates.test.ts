/**
 * subscribeViewUpdates — regression guard for the "popover stuck on scroll" bug.
 *
 * Popovers used to only listen to "update" (state changes). Scroll / resize
 * doesn't change state, so their anchor rect went stale and they froze at
 * their last paint position. subscribeViewUpdates bridges the "viewport"
 * event that TileManager emits on scroll/resize so callbacks fire on both.
 *
 * Drives a real `Editor` so `on`/`emit` go through the real event emitter —
 * no fake editor shape, no `as unknown as IEditor`.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { subscribeViewUpdates } from "./subscribeViewUpdates";
import { createTestEditor } from "../test-utils";
import type { Editor } from "../Editor";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("subscribeViewUpdates", () => {
  it("fires the callback on both 'update' and 'viewport' events", () => {
    editor = createTestEditor();
    const cb = vi.fn();
    subscribeViewUpdates(editor, cb);

    editor.emit("update", { docChanged: false });
    expect(cb).toHaveBeenCalledTimes(1);

    editor.emit("viewport", undefined);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("unsubscribes from both events", () => {
    editor = createTestEditor();
    const cb = vi.fn();
    const off = subscribeViewUpdates(editor, cb);

    off();
    editor.emit("update", { docChanged: false });
    editor.emit("viewport", undefined);
    expect(cb).not.toHaveBeenCalled();
  });

  it("registers exactly one handler per event", () => {
    editor = createTestEditor();
    const onSpy = vi.spyOn(editor, "on");
    const cb = vi.fn();
    subscribeViewUpdates(editor, cb);

    expect(onSpy).toHaveBeenCalledWith("update", cb);
    expect(onSpy).toHaveBeenCalledWith("viewport", cb);
    expect(onSpy).toHaveBeenCalledTimes(2);
  });
});
