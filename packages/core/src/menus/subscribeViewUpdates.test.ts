/**
 * subscribeViewUpdates — regression guard for the "popover stuck on scroll" bug.
 *
 * Popovers used to only listen to "update" (state changes). Scroll / resize
 * doesn't change state, so their anchor rect went stale and they froze at
 * their last paint position. subscribeViewUpdates bridges the "viewport"
 * event that TileManager emits on scroll/resize so callbacks fire on both.
 */
import { describe, it, expect, vi } from "vitest";
import { subscribeViewUpdates } from "./subscribeViewUpdates";
import type { IEditor } from "../extensions/types";
import type { EditorEvents } from "../types/augmentation";

function makeFakeEditor() {
  const handlers = new Map<keyof EditorEvents, Set<() => void>>();
  const editor = {
    on: vi.fn((event: keyof EditorEvents, fn: () => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(fn);
      return () => handlers.get(event)!.delete(fn);
    }),
    emit: (event: keyof EditorEvents) => {
      handlers.get(event)?.forEach((fn) => fn());
    },
  } as unknown as IEditor & { emit: (event: keyof EditorEvents) => void };
  return { editor, handlers };
}

describe("subscribeViewUpdates", () => {
  it("fires the callback on both 'update' and 'viewport' events", () => {
    const { editor } = makeFakeEditor();
    const cb = vi.fn();
    subscribeViewUpdates(editor, cb);

    editor.emit("update");
    expect(cb).toHaveBeenCalledTimes(1);

    editor.emit("viewport");
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("unsubscribes from both events", () => {
    const { editor } = makeFakeEditor();
    const cb = vi.fn();
    const off = subscribeViewUpdates(editor, cb);

    off();
    editor.emit("update");
    editor.emit("viewport");
    expect(cb).not.toHaveBeenCalled();
  });

  it("registers exactly one handler per event", () => {
    const { editor } = makeFakeEditor();
    const cb = vi.fn();
    subscribeViewUpdates(editor, cb);

    expect(editor.on).toHaveBeenCalledWith("update", cb);
    expect(editor.on).toHaveBeenCalledWith("viewport", cb);
    expect(editor.on).toHaveBeenCalledTimes(2);
  });
});
