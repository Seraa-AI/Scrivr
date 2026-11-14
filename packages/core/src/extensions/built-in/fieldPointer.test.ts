/**
 * What the pointer says over a field. An author sees an arrow over a signer's
 * box — a click selects it, nothing types into it — and text keeps its I-beam.
 * Something painted over the page, like a sealed viewer's fields, can say more.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestEditor } from "../../test-utils";
import { StarterKit } from "../StarterKit";
import { DefaultContent } from "./DefaultContent";
import { Field } from "./Field";
import { defaultPageConfig } from "../../layout/PageLayout";
import { PointerController, type PointerControllerDeps } from "../../renderer/PointerController";
import type { Editor } from "../../Editor";

const pointerMove = (x: number, y: number) =>
  new (globalThis.PointerEvent ?? MouseEvent)("pointermove", { clientX: x, clientY: y, pointerId: 1, bubbles: true });

const contract = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Signed: " },
        { type: "field", attrs: { nodeId: "sign-here", kind: "signature", fill: "signer", role: "client", width: 180, height: 44 } },
      ],
    },
  ],
};

let editor: Editor;
afterEach(() => editor.destroy());

function mount(sealed = false) {
  editor = createTestEditor({
    pageConfig: defaultPageConfig,
    sealed,
    extensions: [StarterKit, Field, DefaultContent.configure({ json: contract })],
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 1200, width: 800, height: 1200, toJSON: () => ({}),
  });
  const deps: PointerControllerDeps = {
    editor, tilesContainer: container, pool: [],
    slotHeight: () => 1224, tileHeight: () => 1200, isPageless: () => false, scheduleUpdate: () => {},
  };
  new PointerController(deps).attach();
  editor.ensurePagePopulated(1);
  const box = editor.charMap.getObjectRect(9)!;
  const hover = (x: number, y: number) => {
    document.dispatchEvent(pointerMove(x, y));
    return container.style.cursor;
  };
  return { box, hover };
}

describe("the pointer over a field", () => {
  it("is an arrow over a signer's box while authoring, and an I-beam over text", () => {
    const { box, hover } = mount();

    expect(hover(box.x + box.width / 2, box.y + box.height / 2)).toBe("default");
    expect(hover(box.x - 20, box.y + box.height - 4)).toBe("text");
  });

  it("is what something painted over the page says it is", () => {
    const { box, hover } = mount(true);
    editor.addPointerCursor(({ objectPos }) => (objectPos === 9 ? "pointer" : null));

    expect(hover(box.x + box.width / 2, box.y + box.height / 2)).toBe("pointer");
  });
});
