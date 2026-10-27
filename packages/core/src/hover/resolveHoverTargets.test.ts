import { describe, it, expect, vi, afterEach } from "vitest";
import { createTestEditor } from "../test-utils";
import { StarterKit } from "../extensions/StarterKit";
import { DefaultContent } from "../extensions/built-in/DefaultContent";
import { defaultPageConfig } from "../layout/PageLayout";
import type { PagePoint } from "../layout/pagePoint";
import type { Editor } from "../Editor";
import { PointerController, type PointerControllerDeps } from "../renderer/PointerController";
import type { HoverEvent } from "./types";

/**
 * Hover resolution against a real editor, real layout and a populated
 * character map: what is under a point, innermost first.
 */

const HREF = "https://example.com/docs";

function link(text: string) {
  return { type: "text", text, marks: [{ type: "link", attrs: { href: HREF } }] };
}

function content() {
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "see " }, link("the docs"), { type: "text", text: " here" }] },
      {
        type: "table",
        attrs: { layout: "fixed", grid: [200, 200] },
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableHeader", content: [{ type: "paragraph", content: [link("cell link")] }] },
              { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "plain" }] }] },
            ],
          },
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] },
              { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "b" }] }] },
            ],
          },
        ],
      },
      { type: "paragraph", content: [{ type: "text", text: "after" }] },
    ],
  };
}

function makeEditor(): Editor {
  const editor = createTestEditor({
    pageConfig: defaultPageConfig,
    extensions: [StarterKit.configure({ table: true }), DefaultContent.configure({ json: content() })],
  });
  editor.ensurePagePopulated(1);
  return editor;
}

/** Position of the first character of `text` in the document. */
function posOf(editor: Editor, text: string): number {
  let found = -1;
  editor.getState().doc.descendants((node, pos) => {
    if (found >= 0 || !node.isText) return;
    const i = node.text!.indexOf(text);
    if (i >= 0) found = pos + i;
  });
  if (found < 0) throw new Error(`text not found: ${text}`);
  return found;
}

/** A content point over the middle of the glyph at `pos`. */
function pointOver(editor: Editor, pos: number): PagePoint {
  const at = editor.charMap.coordsAtPos(pos)!;
  const next = editor.charMap.coordsAtPos(pos + 1)!;
  return { page: at.page, x: (at.x + next.x) / 2, y: at.y + at.height / 2, region: "content" };
}

function kinds(editor: Editor, point: PagePoint): string[] {
  return editor.resolveHoverTargets(point).map((t) => t.kind);
}

describe("Editor.resolveHoverTargets", () => {
  it("reports a link in body text, with its range and href", () => {
    const editor = makeEditor();
    const from = posOf(editor, "the docs");
    const targets = editor.resolveHoverTargets(pointOver(editor, from + 2));
    expect(targets).toEqual([
      { kind: "link", surfaceId: "body", pos: from, end: from + "the docs".length, payload: { href: HREF } },
    ]);
  });

  it("reports nothing over plain body text", () => {
    const editor = makeEditor();
    expect(kinds(editor, pointOver(editor, posOf(editor, "here")))).toEqual([]);
  });

  it("reports a link in a table cell as [link, table-cell, table]", () => {
    const editor = makeEditor();
    expect(kinds(editor, pointOver(editor, posOf(editor, "cell link") + 1))).toEqual([
      "link",
      "table-cell",
      "table",
    ]);
  });

  it("carries the table's shape on the table target", () => {
    const editor = makeEditor();
    const table = editor.resolveHoverTargets(pointOver(editor, posOf(editor, "plain"))).at(-1);
    expect(table?.kind).toBe("table");
    expect(table?.payload).toEqual({ rows: 2, columns: 2, headerRow: true });
  });

  it("does not snap: blank space past the end of a line hovers nothing", () => {
    const editor = makeEditor();
    const end = editor.charMap.coordsAtPos(posOf(editor, "here") + 4)!;
    const point: PagePoint = { page: 1, x: end.x + 200, y: end.y + end.height / 2, region: "content" };
    expect(editor.resolveHoverTargets(point)).toEqual([]);
    // Click still snaps there — posAtCoords is unchanged.
    expect(editor.charMap.posAtCoords(point.x, point.y, 1)).toBe(posOf(editor, "here") + 4);
  });

  it("reports nothing outside the content region", () => {
    const editor = makeEditor();
    const over = pointOver(editor, posOf(editor, "the docs") + 2);
    for (const region of ["margin", "header", "footer", "gap", "outside"] as const) {
      expect(editor.resolveHoverTargets({ ...over, region })).toEqual([]);
    }
  });
});

describe("PointerController hover events", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    cleanup?.();
    cleanup = null;
    vi.restoreAllMocks();
  });

  function setup() {
    const editor = makeEditor();
    const container = document.createElement("div");
    document.body.appendChild(container);
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 1200, width: 800, height: 1200, toJSON: () => ({}),
    });
    const queued: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      queued.push(cb);
      return queued.length;
    });
    const deps: PointerControllerDeps = {
      editor,
      tilesContainer: container,
      pool: [],
      slotHeight: () => defaultPageConfig.pageHeight + 24,
      tileHeight: () => defaultPageConfig.pageHeight,
      isPageless: () => false,
      scheduleUpdate: () => {},
    };
    const controller = new PointerController(deps);
    controller.attach();
    const events: HoverEvent[] = [];
    const off = editor.on("hover", (e) => events.push(e));
    cleanup = () => {
      off();
      controller.detach();
      container.remove();
      editor.destroy();
    };
    const move = (point: PagePoint, pointerType = "mouse") => {
      const Ctor = globalThis.PointerEvent ?? MouseEvent;
      container.dispatchEvent(
        new Ctor("pointermove", { clientX: point.x, clientY: point.y, pointerId: 1, pointerType, bubbles: true }),
      );
      queued.splice(0).forEach((cb) => cb(0));
    };
    return { editor, container, events, move };
  }

  it("emits once per change of stack, not once per move", () => {
    const { editor, events, move } = setup();
    const from = posOf(editor, "the docs");
    move(pointOver(editor, from + 1));
    move(pointOver(editor, from + 2));
    move(pointOver(editor, from + 3));
    expect(events).toHaveLength(1);
    expect(events[0]!.targets.map((t) => t.kind)).toEqual(["link"]);

    move(pointOver(editor, posOf(editor, "here")));
    expect(events).toHaveLength(2);
    expect(events[1]!.targets).toEqual([]);
    expect(editor.getHoverTargets()).toEqual([]);
  });

  it("never hovers for touch", () => {
    const { editor, events, move } = setup();
    move(pointOver(editor, posOf(editor, "the docs") + 1), "touch");
    expect(events).toEqual([]);
  });

  it("clears on keydown and on pointerleave", () => {
    const { editor, container, events, move } = setup();
    const over = pointOver(editor, posOf(editor, "the docs") + 1);

    move(over);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(events.at(-1)!.targets).toEqual([]);

    move(over);
    expect(events.at(-1)!.targets.map((t) => t.kind)).toEqual(["link"]);
    container.dispatchEvent(new Event("pointerleave"));
    expect(events.at(-1)).toEqual({ targets: [], point: null });
  });

  it("clears when a press begins", () => {
    const { editor, container, events, move } = setup();
    const over = pointOver(editor, posOf(editor, "the docs") + 1);
    move(over);
    const Ctor = globalThis.PointerEvent ?? MouseEvent;
    container.dispatchEvent(
      new Ctor("pointerdown", { clientX: over.x, clientY: over.y, pointerId: 1, bubbles: true, cancelable: true, detail: 1 }),
    );
    expect(events.at(-1)!.targets).toEqual([]);
  });
});
