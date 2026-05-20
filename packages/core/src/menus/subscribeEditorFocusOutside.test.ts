/**
 * subscribeEditorFocusOutside — fires `onHide` when the editor loses DOM
 * focus AND focus did not land inside a popover marked
 * `[data-scrivr-popover]`. Solves the "popover stays open when the user
 * clicks a sidebar / address bar" UX gap that `subscribeViewUpdates` can't
 * catch (selection doesn't change on raw DOM blur).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { subscribeEditorFocusOutside } from "./subscribeEditorFocusOutside";
import { createTestEditor } from "../test-utils";
import type { Editor } from "../Editor";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
  document.body.innerHTML = "";
});

describe("subscribeEditorFocusOutside", () => {
  it("fires onHide after editor blurs to a non-popover element", async () => {
    editor = createTestEditor();
    const onHide = vi.fn();
    subscribeEditorFocusOutside(editor, onHide);

    // Move focus to an arbitrary outside element first so activeElement is
    // not the editor at hide-check time.
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();

    editor.emit("blur", undefined);
    await Promise.resolve(); // flush microtask
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it("does not fire onHide when focus moves into a popover-marked element", async () => {
    editor = createTestEditor();
    const onHide = vi.fn();
    subscribeEditorFocusOutside(editor, onHide);

    const popover = document.createElement("div");
    popover.setAttribute("data-scrivr-popover", "test-popover");
    const input = document.createElement("input");
    popover.appendChild(input);
    document.body.appendChild(popover);
    input.focus();

    editor.emit("blur", undefined);
    await Promise.resolve();
    expect(onHide).not.toHaveBeenCalled();
  });

  it("does not fire onHide when focus is inside a descendant of a popover-marked element", async () => {
    // Focus might land on a nested form control, not the popover root itself.
    // The check has to climb the tree (closest), not look at activeElement
    // alone.
    editor = createTestEditor();
    const onHide = vi.fn();
    subscribeEditorFocusOutside(editor, onHide);

    const popover = document.createElement("div");
    popover.setAttribute("data-scrivr-popover", "test-popover");
    const inner = document.createElement("div");
    const deeper = document.createElement("button");
    inner.appendChild(deeper);
    popover.appendChild(inner);
    document.body.appendChild(popover);
    deeper.focus();

    editor.emit("blur", undefined);
    await Promise.resolve();
    expect(onHide).not.toHaveBeenCalled();
  });

  it("does not fire onHide when the editor regains focus within the same tick", async () => {
    // Click into the editor causes blur-then-focus in rapid succession.
    // The deferred check must observe the focus before firing.
    editor = createTestEditor();
    const onHide = vi.fn();
    subscribeEditorFocusOutside(editor, onHide);

    editor.emit("blur", undefined);
    editor.emit("focus", undefined); // re-focused before microtask runs
    await Promise.resolve();
    expect(onHide).not.toHaveBeenCalled();
  });

  it("fires onHide on subsequent blur cycles, not just the first", async () => {
    editor = createTestEditor();
    const onHide = vi.fn();
    subscribeEditorFocusOutside(editor, onHide);

    const outside = document.createElement("button");
    document.body.appendChild(outside);

    outside.focus();
    editor.emit("blur", undefined);
    await Promise.resolve();
    expect(onHide).toHaveBeenCalledTimes(1);

    // Re-focus the editor (logically), then blur again.
    editor.emit("focus", undefined);
    outside.focus();
    editor.emit("blur", undefined);
    await Promise.resolve();
    expect(onHide).toHaveBeenCalledTimes(2);
  });

  it("does not fire after unsubscribe", async () => {
    editor = createTestEditor();
    const onHide = vi.fn();
    const off = subscribeEditorFocusOutside(editor, onHide);
    off();

    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();

    editor.emit("blur", undefined);
    await Promise.resolve();
    expect(onHide).not.toHaveBeenCalled();
  });

  it("getPopoverElement: focus inside the popover element suppresses onHide", async () => {
    // Bulletproof path — controllers thread a ref into the helper, and the
    // helper uses element.contains() rather than relying on a marker
    // attribute the consumer might have forgotten to add.
    editor = createTestEditor();
    const onHide = vi.fn();

    const popoverEl = document.createElement("div");
    const button = document.createElement("button");
    popoverEl.appendChild(button);
    document.body.appendChild(popoverEl);

    subscribeEditorFocusOutside(editor, onHide, {
      getPopoverElement: () => popoverEl,
    });

    button.focus();
    editor.emit("blur", undefined);
    await Promise.resolve();
    expect(onHide).not.toHaveBeenCalled();
  });

  it("getPopoverElement: focus outside the ref still triggers onHide", async () => {
    editor = createTestEditor();
    const onHide = vi.fn();

    const popoverEl = document.createElement("div");
    document.body.appendChild(popoverEl);
    // Focus moves to an unrelated element, NOT inside the popover.
    const outside = document.createElement("button");
    document.body.appendChild(outside);

    subscribeEditorFocusOutside(editor, onHide, {
      getPopoverElement: () => popoverEl,
    });

    outside.focus();
    editor.emit("blur", undefined);
    await Promise.resolve();
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it("getPopoverElement returning null falls back to the marker attribute", async () => {
    // Mid-mount race or pre-mount: ref may be null. Helper should not crash,
    // and the marker fallback should still work for any other popover that
    // happens to be open.
    editor = createTestEditor();
    const onHide = vi.fn();

    const otherPopover = document.createElement("div");
    otherPopover.setAttribute("data-scrivr-popover", "test-popover");
    const input = document.createElement("input");
    otherPopover.appendChild(input);
    document.body.appendChild(otherPopover);

    subscribeEditorFocusOutside(editor, onHide, {
      getPopoverElement: () => null,
    });

    input.focus();
    editor.emit("blur", undefined);
    await Promise.resolve();
    expect(onHide).not.toHaveBeenCalled();
  });

  it("coalesces rapid blur events into one onHide per cycle", async () => {
    // Defensive: a noisy emit pattern (e.g. duplicate blur from input + Focus
    // controller) should not produce N onHide calls per tick.
    editor = createTestEditor();
    const onHide = vi.fn();
    subscribeEditorFocusOutside(editor, onHide);

    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();

    editor.emit("blur", undefined);
    editor.emit("blur", undefined);
    editor.emit("blur", undefined);
    await Promise.resolve();
    expect(onHide).toHaveBeenCalledTimes(1);
  });
});
