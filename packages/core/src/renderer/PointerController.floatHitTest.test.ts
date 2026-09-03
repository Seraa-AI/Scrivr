import { describe, it, expect, vi, afterEach } from "vitest";
import { NodeSelection, TextSelection } from "prosemirror-state";
import { createTestEditor } from "../test-utils";
import { StarterKit } from "../extensions/StarterKit";
import { DefaultContent } from "../extensions/built-in/DefaultContent";
import { defaultPageConfig } from "../layout/PageLayout";
import { PointerController, type PointerControllerDeps } from "./PointerController";

/**
 * Who owns a click that lands on both text and an anchored image?
 *
 * Z-order decides. A `behind` image paints under the body, so text takes the
 * point wherever text is painted; a `front` image paints over it and takes the
 * point itself. Getting this wrong is not a near-miss: the click node-selects
 * the image, and the next keystroke edits at the image's anchor instead of the
 * sentence the reader was pointing at.
 */

function pointerEvent(type: string, x: number, y: number): Event {
  const Ctor = globalThis.PointerEvent ?? MouseEvent;
  return new Ctor(type, { clientX: x, clientY: y, pointerId: 1, bubbles: true, cancelable: true });
}

const BODY = "word ".repeat(80).trim();

// A real (1x1 transparent PNG) src: the document URL gate drops an image whose
// src is empty, so the float would never reach layout.
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function docWithFloat(wrapMode: string) {
  return {
    type: "doc",
    content: [
      {
        // The float lives in its own anchor paragraph, the way the editor
        // creates one; `yOffset` drops it over the body text below.
        type: "paragraph",
        content: [
          {
            type: "image",
            attrs: {
              src: PNG,
              width: 240,
              height: 120,
              wrapMode,
              xAlign: "left",
              yOffset: 30,
            },
          },
        ],
      },
      { type: "paragraph", content: [{ type: "text", text: BODY }] },
    ],
  };
}

function setup(wrapMode: string) {
  const editor = createTestEditor({
    pageConfig: defaultPageConfig,
    extensions: [StarterKit, DefaultContent.configure({ json: docWithFloat(wrapMode) })],
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
    editor,
    container,
    float: () => editor.layout.anchoredObjects![0]!,
    clickAt: (x: number, y: number) => container.dispatchEvent(pointerEvent("pointerdown", x, y)),
    hoverAt: (x: number, y: number) => document.dispatchEvent(pointerEvent("pointermove", x, y)),
    cursor: () => container.style.cursor,
    cleanup: () => {
      controller.detach();
      container.remove();
      editor.destroy();
    },
  };
}

let clean: (() => void) | null = null;
afterEach(() => {
  clean?.();
  clean = null;
});

describe("clicking where an anchored image overlaps text", () => {
  it("behind: the text takes the click, so the caret lands in the sentence", () => {
    const h = setup("behind");
    clean = h.cleanup;

    const float = h.float();
    const x = float.x + float.width / 2;
    const y = float.y + float.height / 2;
    // The premise: this point really is over painted text, not a gap.
    expect(h.editor.charMap.hasTextAt(x, y, 1)).toBe(true);

    h.clickAt(x, y);

    const selection = h.editor.getState().selection;
    expect(selection).toBeInstanceOf(TextSelection);
    expect(selection).not.toBeInstanceOf(NodeSelection);
  });

  it("behind: the image is still grabbable where no text is painted", () => {
    const h = setup("behind");
    clean = h.cleanup;

    const float = h.float();
    // Just inside the image's right edge, past where the text was measured to
    // end on that line — the reader sees image, not words.
    let point: { x: number; y: number } | null = null;
    for (let y = float.y + 2; y < float.y + float.height; y += 4) {
      for (let x = float.x + float.width - 2; x > float.x; x -= 4) {
        if (!h.editor.charMap.hasTextAt(x, y, 1)) {
          point = { x, y };
          break;
        }
      }
      if (point) break;
    }
    expect(point).not.toBeNull();

    h.clickAt(point!.x, point!.y);
    expect(h.editor.getState().selection).toBeInstanceOf(NodeSelection);
  });

  it("front: the image takes the click, because it paints over the text", () => {
    const h = setup("front");
    clean = h.cleanup;

    const float = h.float();
    const x = float.x + float.width / 2;
    const y = float.y + float.height / 2;
    expect(h.editor.charMap.hasTextAt(x, y, 1)).toBe(true);

    h.clickAt(x, y);
    expect(h.editor.getState().selection).toBeInstanceOf(NodeSelection);
  });

  it("behind: hovering text over the image shows a text cursor, not a drag cursor", () => {
    const h = setup("behind");
    clean = h.cleanup;

    const float = h.float();
    const x = float.x + float.width / 2;
    const y = float.y + float.height / 2;
    expect(h.editor.charMap.hasTextAt(x, y, 1)).toBe(true);

    h.hoverAt(x, y);

    // The cursor is the promise the click has to keep.
    expect(h.cursor()).toBe("text");
  });

  it("front: hovering shows the drag cursor, because the image owns that point", () => {
    const h = setup("front");
    clean = h.cleanup;

    const float = h.float();
    h.hoverAt(float.x + float.width / 2, float.y + float.height / 2);
    expect(h.cursor()).toBe("move");
  });

  it("behind: the cursor flips between text and move as the pointer crosses inside the image", () => {
    const h = setup("behind");
    clean = h.cleanup;

    const float = h.float();
    const overText = { x: float.x + float.width / 2, y: float.y + float.height / 2 };
    expect(h.editor.charMap.hasTextAt(overText.x, overText.y, 1)).toBe(true);

    // A point inside the same image where no text is painted.
    let overImage: { x: number; y: number } | null = null;
    for (let y = float.y + 2; y < float.y + float.height; y += 4) {
      for (let x = float.x + float.width - 2; x > float.x; x -= 4) {
        if (!h.editor.charMap.hasTextAt(x, y, 1)) { overImage = { x, y }; break; }
      }
      if (overImage) break;
    }
    expect(overImage).not.toBeNull();

    // Both points are inside one image rect. The cursor still has to change
    // between them, because ownership does — and it has to change back.
    h.hoverAt(overText.x, overText.y);
    expect(h.cursor()).toBe("text");
    h.hoverAt(overImage!.x, overImage!.y);
    expect(h.cursor()).toBe("move");
    h.hoverAt(overText.x, overText.y);
    expect(h.cursor()).toBe("text");
  });

  it("front: the cursor reads move over the image and text below it", () => {
    const h = setup("front");
    clean = h.cleanup;

    const float = h.float();
    h.hoverAt(float.x + float.width / 2, float.y + float.height / 2);
    expect(h.cursor()).toBe("move");

    // Below the float, on ordinary body text.
    h.hoverAt(float.x + float.width / 2, float.y + float.height + 60);
    expect(h.cursor()).toBe("text");
  });
});

/**
 * The blank half of a half-full line.
 *
 * A line's box runs the full width of the content area however short its text
 * is, so a one-word paragraph claims hundreds of pixels of empty space to its
 * right. Two questions meet in that space and need different answers. The line
 * still claims it for caret placement — clicking past the end of a short line
 * puts the caret at its end, as every editor does. But nothing is painted
 * there, so it must not out-rank an image the reader can plainly see sitting
 * in the gap, or the pointer promises text where the eye sees a picture.
 */
describe("a short line's empty tail", () => {
  /** "short" on one line, with a float parked in the blank space beside it. */
  function shortLineBesideFloat(wrapMode: string) {
    const editor = createTestEditor({
      pageConfig: defaultPageConfig,
      extensions: [
        StarterKit,
        DefaultContent.configure({
          json: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "short" },
                  {
                    type: "image",
                    attrs: {
                      src: PNG, width: 200, height: 40,
                      wrapMode, xAlign: "custom", x: 300, yOffset: 0,
                    },
                  },
                ],
              },
            ],
          },
        }),
      ],
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 1200, width: 800, height: 1200, toJSON: () => ({}),
    });
    const deps: PointerControllerDeps = {
      editor, tilesContainer: container, pool: [],
      slotHeight: () => 1224, tileHeight: () => 1200, isPageless: () => false,
      visualYToDocY: (y) => ({ page: Math.floor(y / 1224) + 1, docY: y - Math.floor(y / 1224) * 1224 }),
      scheduleUpdate: () => {},
    };
    const controller = new PointerController(deps);
    controller.attach();
    editor.ensurePagePopulated(1);

    const block = editor.layout.pages[0]!.blocks[0]!;
    // Inside the line's vertical band, inside the float, past the word.
    const point = { x: editor.layout.anchoredObjects![0]!.x + 40, y: block.y + 5 };
    return {
      editor,
      point,
      clickAt: () => container.dispatchEvent(pointerEvent("pointerdown", point.x, point.y)),
      hoverAt: () => document.dispatchEvent(pointerEvent("pointermove", point.x, point.y)),
      cursor: () => container.style.cursor,
      cleanup: () => { controller.detach(); container.remove(); editor.destroy(); },
    };
  }

  it("the line claims the point for a caret, but no text is painted there", () => {
    const h = shortLineBesideFloat("behind");
    clean = h.cleanup;

    // Claimable: a click here would put the caret at the end of "short".
    expect(h.editor.charMap.posAtCoords(h.point.x, h.point.y, 1)).toBeGreaterThan(0);
    // Occupied: the word ended long ago.
    expect(h.editor.charMap.hasTextAt(h.point.x, h.point.y, 1)).toBe(false);
  });

  it("behind: the image in that empty space takes the click", () => {
    const h = shortLineBesideFloat("behind");
    clean = h.cleanup;

    h.clickAt();
    expect(h.editor.getState().selection).toBeInstanceOf(NodeSelection);
  });

  it("behind: hovering that empty space offers the image, not a text caret", () => {
    const h = shortLineBesideFloat("behind");
    clean = h.cleanup;

    h.hoverAt();
    expect(h.cursor()).toBe("move");
  });
});
