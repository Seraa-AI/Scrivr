/**
 * The hover stack is what the pointer is engaged with. Crossing from the page
 * onto a popover that serves it keeps it, so the editor goes on mapping it
 * through edits; leaving for anywhere else, or typing, ends it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { makePointerControllerSetup, type PointerControllerSetup } from "../test-utils";
import { POPOVER_MARKER } from "../hover/types";
import type { HoverEvent } from "../hover/types";

let setup: PointerControllerSetup | null = null;
afterEach(() => {
  setup?.cleanup();
  setup = null;
});

const linkOver = { kind: "link", surfaceId: "body", pos: 1, end: 4, at: 1 };

function hovering(): PointerControllerSetup {
  setup = makePointerControllerSetup();
  setup.editor.reportHover({ targets: [linkOver], point: null });
  return setup;
}

function popover(): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute(POPOVER_MARKER, "");
  el.appendChild(document.createElement("a"));
  document.body.appendChild(el);
  return el;
}

const leave = (container: HTMLElement, relatedTarget: Element | null) =>
  container.dispatchEvent(new PointerEvent("pointerleave", { relatedTarget }));

describe("hover across the page edge", () => {
  it("keeps the stack when the pointer leaves the page for a popover", () => {
    const { editor, container } = hovering();
    const el = popover();
    leave(container, el.firstElementChild);
    expect(editor.getHoverTargets()).toEqual([linkOver]);
    el.remove();
  });

  it("ends the stack when the pointer leaves the page for anywhere else", () => {
    const { editor, container } = hovering();
    leave(container, document.body);
    expect(editor.getHoverTargets()).toEqual([]);
  });

  it("maps the kept stack through an edit made while the pointer is on the popover", () => {
    const { editor, container } = hovering();
    const el = popover();
    leave(container, el);
    editor.applyTransaction(editor.getState().tr.insertText("ab", 1));
    expect(editor.getHoverTargets()).toEqual([{ ...linkOver, pos: 3, end: 6, at: 3 }]);
    el.remove();
  });
});

describe("hover and edits", () => {
  it("is mapped before the editor announces the edit", () => {
    const { editor } = hovering();
    const seen: unknown[] = [];
    editor.on("update", () => seen.push(editor.getHoverTargets()));
    editor.applyTransaction(editor.getState().tr.insertText("ab", 1));
    expect(seen).toEqual([[{ ...linkOver, pos: 3, end: 6, at: 3 }]]);
  });
});

describe("keys and hover", () => {
  const events: HoverEvent[] = [];
  const press = (key: string) => document.dispatchEvent(new KeyboardEvent("keydown", { key }));

  it.each(["Shift", "Meta", "OS", "Fn", "Super", "Hyper", "NumLock"])("a lone %s is not typing", (key) => {
    const { editor } = hovering();
    press(key);
    expect(editor.getHoverTargets()).toEqual([linkOver]);
  });

  it("typing or Escape dismisses the peek at once, even under the pointer", () => {
    const { editor } = hovering();
    events.length = 0;
    editor.on("hover", (event) => events.push(event));
    press("Escape");
    expect(editor.getHoverTargets()).toEqual([]);
    expect(events.at(-1)?.dismissed).toBe(true);
  });
});
