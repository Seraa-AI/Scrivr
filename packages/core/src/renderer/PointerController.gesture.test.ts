import { describe, it, expect, vi, afterEach } from "vitest";
import { createTestEditor, makeNPageDoc } from "../test-utils";
import { StarterKit } from "../extensions/StarterKit";
import { Extension } from "../extensions/Extension";
import { defaultPageConfig } from "../layout/PageLayout";
import { PointerController, type PointerControllerDeps } from "./PointerController";
import type { SelectionGesture } from "../selection/types";

/**
 * Proves the pointer-gesture seam end-to-end: an extension registers a hit
 * tester + gesture provider, and PointerController delegates a pointerdown drag
 * to it (bypassing the built-in text-selection path). This is how a table cell
 * gesture or a Seraa custom-node gesture plugs in without patching the pointer
 * controller.
 */

function pointerEvent(type: string, x: number, y: number, init: PointerEventInit = {}): Event {
  const Ctor = globalThis.PointerEvent ?? MouseEvent;
  return new Ctor(type, {
    clientX: x,
    clientY: y,
    pointerId: 1,
    bubbles: true,
    cancelable: true,
    ...init,
  });
}

interface Calls {
  begin: number;
  update: number;
  finish: number;
  cancel: number;
}

function gestureExtension(calls: Calls): Extension {
  const gesture: SelectionGesture = {
    update: () => {
      calls.update++;
    },
    finish: () => {
      calls.finish++;
    },
    cancel: () => {
      calls.cancel++;
    },
  };
  return Extension.create({
    name: "test-gesture",
    // Claim every point as a "test" target, outranking the implicit text fallback.
    addHitTester: () => [{ priority: 10, hitTest: (_x, _y, page) => ({ kind: "test", page, pos: 1 }) }],
    addSelectionGesture: () => [
      {
        beginGesture: (hit) => {
          if (hit.kind !== "test") return null;
          calls.begin++;
          return gesture;
        },
      },
    ],
  });
}

function setup(calls: Calls) {
  const editor = createTestEditor({
    pageConfig: defaultPageConfig,
    extensions: [StarterKit, gestureExtension(calls)],
    content: makeNPageDoc(1),
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 1200, width: 800, height: 1200, toJSON: () => ({}),
  });
  const deps: PointerControllerDeps = {
    editor,
    tilesContainer: container,
    pool: [],
    slotHeight: () => 1224,
    tileHeight: () => 1200,
    isPageless: () => false,
    visualYToDocY: (y) => ({ page: Math.floor(y / 1224) + 1, docY: y - Math.floor(y / 1224) * 1224 }),
    scheduleUpdate: () => {},
  };
  const controller = new PointerController(deps);
  controller.attach();
  editor.ensurePagePopulated(1);
  return {
    container,
    editor,
    cleanup: () => {
      controller.detach();
      container.remove();
      editor.destroy();
    },
  };
}

describe("PointerController — gesture seam", () => {
  let clean: (() => void) | null = null;
  afterEach(() => {
    clean?.();
    clean = null;
  });

  it("delegates a pointerdown drag to a registered gesture provider", () => {
    const calls: Calls = { begin: 0, update: 0, finish: 0, cancel: 0 };
    const s = setup(calls);
    clean = s.cleanup;

    s.container.dispatchEvent(pointerEvent("pointerdown", 120, 120));
    document.dispatchEvent(pointerEvent("pointermove", 160, 120));
    document.dispatchEvent(pointerEvent("pointermove", 200, 120));
    document.dispatchEvent(pointerEvent("pointerup", 200, 120));

    expect(calls.begin).toBe(1);
    expect(calls.update).toBe(2);
    expect(calls.finish).toBe(1);
    expect(calls.cancel).toBe(0);
  });

  it("routes pointercancel to the gesture", () => {
    const calls: Calls = { begin: 0, update: 0, finish: 0, cancel: 0 };
    const s = setup(calls);
    clean = s.cleanup;

    s.container.dispatchEvent(pointerEvent("pointerdown", 120, 120));
    document.dispatchEvent(pointerEvent("pointercancel", 120, 120));

    expect(calls.begin).toBe(1);
    expect(calls.cancel).toBe(1);
    expect(calls.finish).toBe(0);
  });

  it("gives a registered gesture priority over built-in image handling", () => {
    const calls: Calls = { begin: 0, update: 0, finish: 0, cancel: 0 };
    const s = setup(calls);
    clean = s.cleanup;
    const imageHit = vi.spyOn(s.editor.charMap, "objectRectAtPoint").mockReturnValue({
      docPos: 1,
      x: 100,
      y: 100,
      width: 80,
      height: 80,
      page: 1,
    });

    s.container.dispatchEvent(pointerEvent("pointerdown", 120, 120));

    expect(calls.begin).toBe(1);
    expect(imageHit).not.toHaveBeenCalled();
  });

  it("offers Shift and repeated clicks to the registered gesture first", () => {
    const calls: Calls = { begin: 0, update: 0, finish: 0, cancel: 0 };
    const s = setup(calls);
    clean = s.cleanup;

    s.container.dispatchEvent(pointerEvent("pointerdown", 120, 120, { shiftKey: true }));
    document.dispatchEvent(pointerEvent("pointerup", 120, 120, { shiftKey: true }));
    s.container.dispatchEvent(pointerEvent("pointerdown", 120, 120));

    expect(calls.begin).toBe(2);
  });
});
